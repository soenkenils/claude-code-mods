// Heads-up: watches the running session and says so when something is off.
// What it watches: failing tool calls and test runs in a row, edits outside
// the project, a context spike or a nearly full window, calls that stall, and
// the same call returning the same result again and again.

import { atom, read, update } from "claude-code";
import type { EngineInterface, PluginOptions, Register } from "claude-code";

import type { HeadsUpAlert, HeadsUpSeverity } from "../types";
import {
  RANK,
  apply,
  describeCall,
  duration,
  errorLine,
  expandHome,
  inputOf,
  isInside,
  isTestCommand,
  normalize,
  outsideSeverity,
  short,
  signature,
  toolLabel,
} from "./detect";
import type { Draft } from "./detect";

const COMMAND = "heads-up";
const KEEP = 30;
const SHOWN = 3;
const TICK_MS = 5_000;
const CRITICAL_PERCENT = 95;
// One cell wide, for a terminal's grid; desktop draws proportional text and gets emoji.
const ICON: Record<HeadsUpSeverity, string> = { info: "●", warn: "⚠", danger: "✖" };
const EMOJI: Record<HeadsUpSeverity, string> = { info: "ℹ️", warn: "⚠️", danger: "⛔" };
const COLOR: Record<HeadsUpSeverity, string> = { info: "suggestion", warn: "warning", danger: "error" };
const FILE_ARG: Record<string, string> = { Edit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" };
// Waiting on the person, a subagent or a schedule is no stall.
const NEVER_STALLS = new Set(["Agent", "AskUserQuestion", "ExitPlanMode", "Monitor", "ScheduleWakeup"]);
// Polling asks the same thing again on purpose.
const POLLS = new Set(["Poll", "TaskGet", "TaskList", "Monitor", "ScheduleWakeup", "WaitForMcpServers"]);

const alerts = atom({ plugin: "heads-up", key: "alerts" } as const, [], { shape: "alerts-1" });
const isMuted = atom({ plugin: "heads-up", key: "isMuted" } as const, false);

function configFrom(options: PluginOptions) {
  const count = (key: string, fallback: number) => {
    const value = options[key];
    return typeof value === "number" && value >= 0 ? value : fallback;
  };
  return {
    failureStreak: count("failureStreak", 3),
    testFailures: count("testFailures", 3),
    contextJumpTokens: count("contextJumpTokens", 40_000),
    contextPercent: count("contextPercent", 80),
    stallMs: count("stallMinutes", 5) * 60_000,
    repeatCalls: count("repeatCalls", 3),
    watchEdits: options.watchEdits !== false,
    ignorePaths: typeof options.ignorePaths === "string" ? options.ignorePaths : "/tmp,/var/tmp,~/.claude",
    notify: options.notify === true,
  };
}
type Config = ReturnType<typeof configFrom>;
type Watch = { inFlight: Map<string, { tool: string; detail: string; since: number }>; isTurnActive: boolean; lastActivity: number };

export const register: Register = (on, options) => {
  const cfg = configFrom(options);

  // Held by this load of the module: a reload starts the counting over.
  const failures = new Map<string, number>();
  const lastCall = new Map<string, { sig: string; count: number }>();
  const watch: Watch = { inFlight: new Map(), isTurnActive: false, lastActivity: 0 };
  let testFailures = 0;
  let prevTokens: number | undefined;
  let contextLevel = 0;
  let toolsSinceMeasure: string[] = [];

  on("session.start", async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "List, clear or mute heads-ups", argumentHint: "[clear|off|on]" });
    // Stalls are the absence of events, so a timer has to look for them.
    $.clock.every(TICK_MS, async () => {
      try {
        await watchStalls($, cfg, watch);
      } catch {
        // The next tick tries again.
      }
    });
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    // The person is at the keyboard: what was counting up starts again.
    failures.clear();
    lastCall.clear();
    testFailures = 0;
    await resolve($, /^(failures|repeat):|^tests$/);
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    if (e.agentId === undefined) {
      watch.isTurnActive = true;
      watch.lastActivity = await $.clock.now();
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) {
      watch.isTurnActive = false;
      await resolve($, "quiet");
    }
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    const loop = e.agentId ?? "main";
    const input = inputOf(e);
    const detail = describeCall(e.tool, input);
    const label = toolLabel(e.tool);
    const callId = e.tool_use_id ?? `${loop}:${e.tool}:${detail}`;

    watch.lastActivity = await $.clock.now();
    toolsSinceMeasure.push(label);
    const outsideId = cfg.watchEdits ? await watchEdit($, cfg, e.tool, input) : undefined;

    watch.inFlight.set(callId, { tool: e.tool, detail, since: watch.lastActivity });
    let ran;
    try {
      ran = await next(e);
    } finally {
      watch.inFlight.delete(callId);
      await resolve($, `slow:${callId}`);
    }
    watch.lastActivity = await $.clock.now();

    // A refused call changed nothing, and an interrupted one is the person's doing.
    if (ran.deny !== undefined || next.signal.aborted) {
      if (outsideId !== undefined) await resolve($, outsideId);
      return ran;
    }

    const isError = ran.isError === true;
    if (isError && outsideId !== undefined) await resolve($, outsideId);
    const why = errorLine(ran.text);
    const what = detail === "" ? label : `${label} ${detail}`;
    const isTest = e.tool === "Bash" && isTestCommand(String(input.command ?? ""));

    if (isError && isTest) {
      testFailures += 1;
      if (cfg.testFailures > 0 && testFailures >= cfg.testFailures) {
        await raise($, cfg, {
          id: "tests",
          kind: "tests",
          severity: "warn",
          title: `Tests failed ${testFailures}× in a row`,
          detail: why === "" ? detail : `${detail} · ${why}`,
        });
      }
    } else if (isError) {
      const n = (failures.get(loop) ?? 0) + 1;
      failures.set(loop, n);
      if (cfg.failureStreak > 0 && n >= cfg.failureStreak) {
        await raise($, cfg, {
          id: `failures:${loop}`,
          kind: "failures",
          severity: "warn",
          title: `${n} tool calls failed in a row${loop === "main" ? "" : " (subagent)"}`,
          detail: why === "" ? what : `${what} · ${why}`,
        });
      }
    } else {
      failures.delete(loop);
      await resolve($, `failures:${loop}`);
      if (isTest) {
        testFailures = 0;
        await resolve($, "tests");
      }
    }

    if (cfg.repeatCalls > 0 && !POLLS.has(e.tool)) {
      const sig = signature(e.tool, input, ran.text ?? "");
      const before = lastCall.get(loop);
      const count = before?.sig === sig ? before.count + 1 : 1;
      lastCall.set(loop, { sig, count });
      if (count >= cfg.repeatCalls) {
        await raise($, cfg, {
          id: `repeat:${loop}`,
          kind: "repeat",
          severity: "warn",
          title: `Same call, same result ${count}× in a row${loop === "main" ? "" : " (subagent)"}`,
          detail: what,
        });
      } else if (count === 1) {
        await resolve($, `repeat:${loop}`);
      }
    }

    return ran;
  });

  on("session.measure", async ($, e, next) => {
    const { tokens, window, percent } = e.context;
    if (e.changed.includes("context") && tokens !== undefined) {
      const pct = percent ?? Math.round((tokens / window) * 100);
      const jump = prevTokens === undefined ? 0 : tokens - prevTokens;
      prevTokens = tokens;
      const used = [...new Set(toolsSinceMeasure)].slice(0, 3).join(", ");
      toolsSinceMeasure = [];

      if (cfg.contextJumpTokens > 0 && jump >= cfg.contextJumpTokens) {
        await raise(
          $,
          cfg,
          {
            id: "context-jump",
            kind: "context-jump",
            severity: "warn",
            title: `Context grew by ${short(jump)} in one turn`,
            detail: `${used === "" ? "" : `${used} · `}now ${pct}% of ${short(window)}`,
          },
          { repeat: true },
        );
      }

      if (cfg.contextPercent > 0) {
        const critical = Math.max(CRITICAL_PERCENT, cfg.contextPercent);
        const level = pct >= critical ? 2 : pct >= cfg.contextPercent ? 1 : 0;
        if (level > contextLevel) {
          contextLevel = level;
          await raise($, cfg, {
            id: "context-high",
            kind: "context-high",
            severity: level === 2 ? "danger" : "warn",
            title: `Context is ${pct}% full`,
            detail: `${short(tokens)} of ${short(window)} · ${level === 2 ? "compact now or start fresh" : "consider /compact or a fresh session"}`,
          });
        } else if (contextLevel > 0 && pct < cfg.contextPercent - 10) {
          // Compaction made room: the next climb is news again.
          contextLevel = 0;
          await resolve($, "context-high");
        }
      }
    }
    return next(e);
  });

  on("command.run", { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg === "off" || arg === "on") {
      await update($, isMuted, () => arg === "off");
      return { text: arg === "off" ? "Heads-up is muted for this session. /heads-up on turns it back on." : "Heads-up is on." };
    }
    if (arg === "clear") {
      const cleared = await dismissAll($);
      return { text: cleared === 0 ? "No heads-ups to clear." : `Cleared ${cleared} heads-up${cleared === 1 ? "" : "s"}.` };
    }
    if (arg !== "") return { text: "Usage: /heads-up [clear|off|on]" };
    return { text: await listing($) };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const active = (await read($, alerts)).filter((a) => a.status === "active");
    if (active.length === 0 || e.props.hasSurvey || (await read($, isMuted))) return next(e);

    const { Box, Text, Button } = $.ui.resolve(e);
    const isWide = e.props.bodyColumns >= 60;
    const icons = e.surface === "desktop" ? EMOJI : ICON;
    const ranked = [...active].sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.at - a.at);
    const rest = ranked.length - SHOWN;

    const rows = ranked.slice(0, SHOWN).map((a) => {
      const title = `${icons[a.severity]} ${a.title}${a.count > 1 ? ` ×${a.count}` : ""}`;
      const parts = [Text({ color: COLOR[a.severity], weight: "semibold", children: title })];
      if (isWide && a.detail !== "") parts.push(Text({ dimColor: true, mono: true, children: `  ${a.detail}` }));
      return Box({
        flexDirection: "row",
        gap: 1,
        children: [
          Box({ flexGrow: 1, flexShrink: 1, children: Text({ wrap: "truncate-end", children: parts }) }),
          Button({ key: `dismiss:${a.id}`, label: "Dismiss", plain: true, dimColor: true, onPress: () => dismiss($, a.id) }),
        ],
      });
    });
    if (rest > 0) {
      rows.push(
        Box({
          flexDirection: "row",
          gap: 2,
          children: [
            Text({ dimColor: true, children: `… and ${rest} more · /heads-up lists them` }),
            Button({ key: "dismiss-all", label: "Dismiss all", plain: true, dimColor: true, onPress: () => dismissAll($) }),
          ],
        }),
      );
    }
    return Box({ flexDirection: "column", paddingX: 1, children: rows });
  });
};

// Edits outside the project: told before the edit runs, so it can be seen while it happens.
async function watchEdit($: EngineInterface, cfg: Config, tool: string, input: Record<string, unknown>) {
  const raw = input[FILE_ARG[tool] ?? ""];
  if (typeof raw !== "string" || raw === "") return undefined;
  const [cwd, root, home, temp] = await Promise.all([
    $.session.cwd(),
    $.session.root(),
    $.env.get("HOME").then((value) => value ?? $.env.get("USERPROFILE")),
    $.env.get("TMPDIR"),
  ]);
  const path = normalize(expandHome(raw, home), cwd);
  const fine = [cwd, root, ...cfg.ignorePaths.split(","), ...(temp === undefined ? [] : [temp])]
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => normalize(expandHome(p, home), cwd));
  if (fine.some((base) => isInside(path, base))) return undefined;

  const id = `outside:${path}`;
  const at = home !== undefined && isInside(path, normalize(home, cwd)) ? `~${path.slice(normalize(home, cwd).length)}` : path;
  await raise($, cfg, { id, kind: "outside", severity: outsideSeverity(path), title: `${tool} outside the project`, detail: at }, { repeat: true });
  return id;
}

async function watchStalls($: EngineInterface, cfg: Config, watch: Watch) {
  if (cfg.stallMs <= 0) return;
  const now = await $.clock.now();

  for (const [callId, call] of watch.inFlight) {
    const waited = now - call.since;
    if (NEVER_STALLS.has(call.tool) || waited < cfg.stallMs) continue;
    await raise($, cfg, {
      id: `slow:${callId}`,
      kind: "slow",
      severity: "warn",
      title: `${toolLabel(call.tool)} has no result after ${duration(waited)}`,
      detail: call.detail === "" ? "still running, or waiting for your OK" : call.detail,
    });
  }

  const quiet = now - watch.lastActivity;
  if (watch.isTurnActive && watch.inFlight.size === 0 && quiet >= cfg.stallMs) {
    await raise($, cfg, {
      id: "quiet",
      kind: "quiet",
      severity: "warn",
      title: `No activity for ${duration(quiet)}`,
      detail: "the turn is still running",
    });
  } else {
    await resolve($, "quiet");
  }
}

// Raising the same cause again updates its alert instead of stacking a new one.
async function raise($: EngineInterface, cfg: Config, draft: Draft, { repeat = false } = {}) {
  if (await read($, isMuted)) return;
  const now = await $.clock.now();
  const options = { repeat, now, keep: KEEP };
  if (apply(await read($, alerts), draft, options) === null) return;

  let isLoud = false;
  await update($, alerts, (list) => {
    const raised = apply(list, draft, options);
    isLoud = raised?.isLoud ?? false;
    return raised?.list ?? list;
  });
  if (isLoud) announce($, cfg, draft);
}

// The band is easy to miss from another window, so warnings also toast.
function announce($: EngineInterface, cfg: Config, draft: Draft) {
  if (draft.severity === "info") return;
  $.ui.toast(`${ICON[draft.severity]} ${draft.title}`, { timeoutMs: draft.severity === "danger" ? 10_000 : 6_000 });
  if (cfg.notify) {
    const text = draft.detail === "" ? draft.title : `${draft.title}: ${draft.detail}`;
    $.ui.notify(text, { title: "Heads-up" }).catch(() => undefined);
  }
}

// The cause is gone: the alert leaves the band, and may come back if the cause does.
async function resolve($: EngineInterface, match: string | RegExp) {
  const isOpen = (a: HeadsUpAlert) => a.status !== "resolved" && (typeof match === "string" ? a.id === match : match.test(a.id));
  if (!(await read($, alerts)).some(isOpen)) return;
  await update($, alerts, (list) => list.map((a) => (isOpen(a) ? { ...a, status: "resolved" as const } : a)));
}

async function dismiss($: EngineInterface, id: string) {
  await update($, alerts, (list) => list.map((a) => (a.id === id && a.status === "active" ? { ...a, status: "dismissed" as const } : a)));
}

async function dismissAll($: EngineInterface) {
  let cleared = 0;
  await update($, alerts, (list) => {
    cleared = list.filter((a) => a.status === "active").length;
    return list.map((a) => (a.status === "active" ? { ...a, status: "dismissed" as const } : a));
  });
  return cleared;
}

async function listing($: EngineInterface) {
  const list = [...(await read($, alerts))].reverse();
  const now = await $.clock.now();
  const active = list.filter((a) => a.status === "active").length;
  const lines = list.slice(0, 15).map((a) => {
    const ago = `${duration(Math.max(0, now - a.at))} ago`;
    const state = a.status === "active" ? ago : `${ago}, ${a.status}`;
    const count = a.count > 1 ? ` ×${a.count}` : "";
    return `${ICON[a.severity]} ${a.title}${count}${a.detail === "" ? "" : ` · ${a.detail}`} (${state})`;
  });
  const muted = (await read($, isMuted)) ? " Muted: /heads-up on turns it back on." : "";
  if (lines.length === 0) return `Nothing to report so far.${muted}`;
  return [`Heads-up: ${active} active, ${list.length - active} earlier`, ...lines, `/heads-up clear dismisses what is showing.${muted}`].join("\n");
}
