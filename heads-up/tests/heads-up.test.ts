import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { apply, duration, isInside, isTestCommand, normalize, outsideSeverity, short, trim } from "../hooks/detect";
import type { HeadsUpAlert } from "../types";

const WINDOW = 200_000;
const MINUTE = 60_000;
const SURFACES = ["terminal", "desktop"] as const;

type Call = { tool: string; [argument: string]: unknown };
type Outcome = { text?: string; isError?: boolean; deny?: string; takes?: number };

// What sits beneath the plugin in a session: the engine's answers, and the tools themselves.
function core(on: On, script: (call: Call) => Outcome = () => ({}), where = { cwd: "/repo", root: "/repo" }) {
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/home/dev" });
  const toasts: string[] = [];
  const notices: string[] = [];
  const ran: string[] = [];

  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.cwd", () => ({ value: where.cwd }));
  on("session.root", () => ({ value: where.root }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("ui.toast", (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.notify", (_$, e) => {
    notices.push(`${e.title}: ${e.text}`);
    return { value: { isSent: true, channel: "test" } } as never;
  });
  on("ui.render", { component: "AbovePrompt" }, () => ({ type: "engine", ref: 0 }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("tool.call", async (_$, e) => {
    const call = e as unknown as Call;
    ran.push(`${call.tool} ${String(call.command ?? call.file_path ?? "")}`.trim());
    const outcome = script(call);
    if (outcome.takes !== undefined) await clock.sleep(outcome.takes);
    if (outcome.deny !== undefined) return { deny: outcome.deny } as never;
    const text = outcome.text ?? (outcome.isError ? "Exit code 1" : "ok");
    return (outcome.isError ? { isError: true, result: text, text } : { result: {}, text }) as never;
  });
  return { clock, toasts, notices, ran };
}

const start = ($: Engine) => $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
const bash = ($: Engine, command: string) => $.tool.call({ tool: "Bash", command });
const edit = ($: Engine, file_path: string) => $.tool.call({ tool: "Edit", file_path, old_string: "a", new_string: "b" });
const submit = ($: Engine, text = "go on") => $.prompt.submit({ text, wait: false, origin: { kind: "composer" } });
const slash = ($: Engine, args = "") =>
  $.command.run({ command: "heads-up", args, origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 100 } });
const beginTurn = ($: Engine) => $.turn.start({ text: "go", turnId: "t1" });
const endTurn = ($: Engine) => $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" });

function measure($: Engine, tokens: number) {
  return $.session.measure({
    context: { tokens, window: WINDOW, percent: Math.round((tokens / WINDOW) * 100) },
    rateLimits: [],
    changed: ["context"],
  });
}

function band($: Engine, props: { bodyColumns?: number; hasSurvey?: boolean; surface?: (typeof SURFACES)[number] } = {}) {
  return $.ui.mount({
    plugin: "heads-up",
    surface: props.surface ?? "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: props.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  });
}

async function shown($: Engine, props?: Parameters<typeof band>[1]) {
  const ui = await band($, props);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join("\n");
}

// One Dismiss button per alert showing: the way to count them, whatever their text.
async function showing($: Engine, props?: Parameters<typeof band>[1]) {
  const ui = await band($, props);
  const buttons = await ui.findAll({ type: "Button" });
  await ui.unmount();
  return buttons.map((b) => b.key).filter((key) => key?.startsWith("dismiss:"));
}

async function isQuiet($: Engine, props?: Parameters<typeof band>[1]) {
  const ui = await band($, props);
  const drawn = await ui.drawn();
  await ui.unmount();
  return JSON.stringify(drawn) === JSON.stringify({ type: "engine", ref: 0 });
}

const fail = (text = "Exit code 1") => ({ isError: true, text });
const alert = (over: Partial<HeadsUpAlert> = {}): HeadsUpAlert => ({
  id: "a",
  kind: "failures",
  severity: "warn",
  title: "title",
  detail: "detail",
  count: 1,
  status: "active",
  at: 0,
  ...over,
});

describe("detect", () => {
  for (const command of [
    "npm test",
    "npm run test -- --watch=false",
    "pnpm test",
    "bun test",
    "yarn test",
    "npx vitest run",
    "pytest -x tests/",
    "python -m pytest",
    "uv run pytest",
    "CI=1 jest --runInBand",
    "go test ./...",
    "cargo test --lib",
    "dotnet test",
    "make test",
    "claude plugin test heads-up",
    "cd app && npm test",
  ]) {
    test(`a test run: ${command}`, () => expect(isTestCommand(command)).toBe(true));
  }

  for (const command of ["npm install", "npm run build", "grep -r pytest .", "git commit -m 'fix test'", "echo jest", "ls tests/", "npm run lint"]) {
    test(`not a test run: ${command}`, () => expect(isTestCommand(command)).toBe(false));
  }

  test("paths are resolved before they are compared", () => {
    expect(normalize("src/../lib/./a.ts", "/repo")).toBe("/repo/lib/a.ts");
    expect(normalize("/repo/../etc//hosts", "/repo")).toBe("/etc/hosts");
    expect(normalize("C:\\Work\\app\\a.ts", "/repo")).toBe("c:/Work/app/a.ts");
    expect(isInside("/repo/src/a.ts", "/repo")).toBe(true);
    expect(isInside("/repo-other/a.ts", "/repo")).toBe(false);
    expect(isInside("/anything", "/")).toBe(true);
  });

  test("system and credential paths are danger, the rest a warning", () => {
    expect(outsideSeverity("/etc/hosts")).toBe("danger");
    expect(outsideSeverity("/home/dev/.ssh/config")).toBe("danger");
    expect(outsideSeverity("/home/dev/.zshrc")).toBe("danger");
    expect(outsideSeverity("/home/dev/other/a.ts")).toBe("warn");
  });

  test("durations and counts read short", () => {
    expect(duration(4_000)).toBe("4s");
    expect(duration(5 * MINUTE)).toBe("5m");
    expect(duration(65 * MINUTE)).toBe("1h 05m");
    expect(short(62_000)).toBe("62k");
    expect(short(1_500_000)).toBe("1.5M");
  });

  test("raising an alert twice updates it, and a dismissed one stays quiet", () => {
    const draft = { id: "a", kind: "failures", severity: "warn", title: "t", detail: "d" } as const;
    const opts = { repeat: false, now: 5, keep: 30 };
    const first = apply([], draft, opts);
    expect(first?.isLoud).toBe(true);
    expect(apply(first!.list, draft, opts)).toBe(null);
    const worse = apply(first!.list, { ...draft, severity: "danger" }, opts);
    expect(worse?.isLoud).toBe(true);
    expect(worse?.list).toHaveLength(1);
    expect(apply([alert({ status: "dismissed" })], draft, opts)).toBe(null);
    expect(apply([alert({ status: "resolved" })], draft, opts)?.list).toHaveLength(2);
  });

  test("trimming keeps what is showing", () => {
    const list = [alert({ id: "old", status: "active" }), alert({ id: "b", status: "resolved" }), alert({ id: "c", status: "resolved" })];
    expect(trim(list, 2).map((a) => a.id)).toEqual(["old", "c"]);
  });
});

describe("tool calls that fail in a row", () => {
  test("three in a row are shown, once, and the fourth only updates the count", async ($, on) => {
    const { toasts } = core(on, () => fail("Exit code 2"));
    await bash($, "npm run build");
    await bash($, "npm run lint");
    expect(await isQuiet($)).toBe(true);
    await bash($, "npm run typecheck");

    const text = await shown($);
    expect(text).toContain("⚠ 3 tool calls failed in a row");
    expect(text).toContain("Bash npm run typecheck · Exit code 2");
    expect(toasts).toEqual(["⚠ 3 tool calls failed in a row"]);

    await bash($, "npm run again");
    expect(await shown($)).toContain("4 tool calls failed in a row");
    expect(toasts).toHaveLength(1);
  });

  test("a success starts the count over and takes the alert down", async ($, on) => {
    core(on, (call) => (call.command === "ok" ? {} : fail()));
    await bash($, "a");
    await bash($, "b");
    await bash($, "ok");
    await bash($, "c");
    await bash($, "d");
    expect(await isQuiet($)).toBe(true);
    await bash($, "e");
    expect(await shown($)).toContain("3 tool calls failed");
    await bash($, "ok");
    expect(await isQuiet($)).toBe(true);
  });

  test("a refused call is not a failure", async ($, on) => {
    core(on, () => ({ deny: "not allowed" }));
    for (let i = 0; i < 4; i++) await bash($, `rm ${i}`);
    expect(await isQuiet($)).toBe(true);
  });

  test("a subagent has a count of its own", async ($, on) => {
    core(on, () => fail());
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: "Bash", command: `x${i}`, agentId: "a1" });
    expect(await shown($)).toContain("3 tool calls failed in a row (subagent)");
    await bash($, "main");
    await bash($, "main");
    expect(await showing($)).toEqual(["dismiss:failures:a1"]);
  });

  test("the threshold is the person's to set", { options: { failureStreak: 2 } }, async ($, on) => {
    core(on, () => fail());
    await bash($, "a");
    await bash($, "b");
    expect(await shown($)).toContain("2 tool calls failed in a row");
  });

  test("0 turns it off", { options: { failureStreak: 0 } }, async ($, on) => {
    core(on, () => fail());
    for (let i = 0; i < 6; i++) await bash($, `c${i}`);
    expect(await isQuiet($)).toBe(true);
  });

  test("a new prompt from the person starts the count over", async ($, on) => {
    core(on, () => fail());
    await bash($, "a");
    await bash($, "b");
    await bash($, "c");
    expect(await isQuiet($)).toBe(false);
    await submit($);
    expect(await isQuiet($)).toBe(true);
  });
});

describe("tests that fail in a row", () => {
  const script = (call: Call) => (call.tool === "Bash" && call.command === "npm test" ? fail("Exit code 1") : {});

  test("failing runs count across the edits between them", async ($, on) => {
    core(on, script);
    for (let i = 0; i < 2; i++) {
      await bash($, "npm test");
      await edit($, "/repo/src/a.ts");
    }
    expect(await isQuiet($)).toBe(true);
    await bash($, "npm test");

    const text = await shown($);
    expect(text).toContain("⚠ Tests failed 3× in a row");
    expect(text).toContain("npm test · Exit code 1");
    expect(text).not.toContain("tool calls failed");
  });

  test("a passing run takes the alert down", async ($, on) => {
    let passes = false;
    core(on, (call) => (passes ? {} : script(call)));
    for (let i = 0; i < 3; i++) await bash($, "npm test");
    expect(await isQuiet($)).toBe(false);
    passes = true;
    await bash($, "npm test");
    expect(await isQuiet($)).toBe(true);
  });

  test("other failing commands are not test runs", async ($, on) => {
    core(on, () => fail());
    for (let i = 0; i < 2; i++) await bash($, "npm run build");
    expect(await isQuiet($)).toBe(true);
  });
});

describe("edits outside the project", () => {
  test("a file elsewhere is a warning, told before the edit runs", async ($, on) => {
    const { toasts, ran } = core(on);
    await edit($, "/home/dev/other/notes.md");
    expect(await shown($)).toContain("⚠ Edit outside the project");
    expect(await shown($)).toContain("~/other/notes.md");
    expect(toasts).toEqual(["⚠ Edit outside the project"]);
    expect(ran).toEqual(["Edit /home/dev/other/notes.md"]);
  });

  test("a system or credential file is an alert", async ($, on) => {
    const { toasts } = core(on);
    await $.tool.call({ tool: "Write", file_path: "/home/dev/.ssh/config", content: "x" });
    expect(await shown($)).toContain("✖ Write outside the project");
    expect(toasts).toEqual(["✖ Write outside the project"]);
  });

  test("the project root counts, not only the folder the session is in", async ($, on) => {
    core(on, () => ({}), { cwd: "/repo/packages/app", root: "/repo" });
    await edit($, "/repo/shared/util.ts");
    expect(await isQuiet($)).toBe(true);
    await edit($, "/elsewhere/util.ts");
    expect(await isQuiet($)).toBe(false);
  });

  test("a notebook is watched too", async ($, on) => {
    core(on);
    await $.tool.call({ tool: "NotebookEdit", notebook_path: "/data/analysis.ipynb", new_source: "x" });
    expect(await shown($)).toContain("NotebookEdit outside the project");
  });

  for (const path of ["/repo/src/a.ts", "/repo/../repo/b.ts", "/tmp/scratch/x.txt", "/home/dev/.claude/memory/m.md"]) {
    test(`says nothing about ${path}`, async ($, on) => {
      core(on);
      await edit($, path);
      expect(await isQuiet($)).toBe(true);
    });
  }

  test("a path the person listed is fine, ~ and all", { options: { ignorePaths: "~/notes, /srv/shared" } }, async ($, on) => {
    core(on);
    await edit($, "/home/dev/notes/todo.md");
    await edit($, "/srv/shared/a.txt");
    expect(await isQuiet($)).toBe(true);
    await edit($, "/home/dev/other.md");
    expect(await isQuiet($)).toBe(false);
  });

  test("the same file again counts up instead of stacking", async ($, on) => {
    const { toasts } = core(on);
    await edit($, "/etc/hosts");
    await edit($, "/etc/hosts");
    expect(await shown($)).toContain("✖ Edit outside the project ×2");
    expect(await showing($)).toEqual(["dismiss:outside:/etc/hosts"]);
    expect(toasts).toHaveLength(1);
  });

  test("a refused edit changed nothing, so it is taken back", async ($, on) => {
    core(on, () => ({ deny: "no" }));
    await edit($, "/etc/hosts");
    expect(await isQuiet($)).toBe(true);
  });

  test("it can be switched off", { options: { watchEdits: false } }, async ($, on) => {
    core(on);
    await edit($, "/etc/hosts");
    expect(await isQuiet($)).toBe(true);
  });
});

describe("the context window", () => {
  test("the first reading is no jump", async ($, on) => {
    core(on);
    await measure($, 150_000 - 40_000);
    expect(await isQuiet($)).toBe(true);
  });

  test("a turn that adds a lot names the tools it ran", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await $.tool.call({ tool: "Read", file_path: "/repo/big.log" });
    await bash($, "cat dump.json");
    await measure($, 72_000);

    const text = await shown($);
    expect(text).toContain("⚠ Context grew by 52k in one turn");
    expect(text).toContain("Read, Bash · now 36% of 200k");
  });

  test("a climb past 80% says so once, 95% raises it, compaction resets it", async ($, on) => {
    const { toasts } = core(on);
    await measure($, 150_000);
    expect(await isQuiet($)).toBe(true);
    await measure($, 164_000);
    expect(await shown($)).toContain("⚠ Context is 82% full");
    await measure($, 170_000);
    expect(toasts).toEqual(["⚠ Context is 82% full"]);

    await measure($, 192_000);
    expect(await shown($)).toContain("✖ Context is 96% full");
    expect(toasts).toEqual(["⚠ Context is 82% full", "✖ Context is 96% full"]);

    await measure($, 30_000);
    expect(await isQuiet($)).toBe(true);
    await measure($, 170_000);
    expect(await shown($)).toContain("Context is 85% full");
  });

  test("a rate-limit-only measurement is ignored", async ($, on) => {
    core(on);
    await $.session.measure({ context: { tokens: 190_000, window: WINDOW, percent: 95 }, rateLimits: [], changed: ["rateLimits"] });
    expect(await isQuiet($)).toBe(true);
  });

  test("the limits are the person's to set", { options: { contextJumpTokens: 0, contextPercent: 50 } }, async ($, on) => {
    core(on);
    await measure($, 10_000);
    await measure($, 100_000);
    const text = await shown($);
    expect(text).toContain("Context is 50% full");
    expect(text).not.toContain("grew");
  });
});

describe("a run that stalls", () => {
  test("a call without a result is named, then taken down when it returns", async ($, on) => {
    const { clock, toasts } = core(on, () => ({ takes: 8 * MINUTE }));
    await start($);
    const call = bash($, "npm run e2e");
    await clock.settle();

    await clock.advance(4 * MINUTE);
    expect(await isQuiet($)).toBe(true);
    await clock.advance(MINUTE + 10_000);
    const text = await shown($);
    expect(text).toContain("⚠ Bash has no result after 5m");
    expect(text).toContain("npm run e2e");
    expect(toasts).toEqual(["⚠ Bash has no result after 5m"]);

    await clock.advance(MINUTE);
    expect(await shown($)).toContain("has no result after 6m");
    expect(toasts).toHaveLength(1);

    await clock.advance(2 * MINUTE);
    await call;
    expect(await isQuiet($)).toBe(true);
  });

  test("waiting on the person or a subagent is no stall", async ($, on) => {
    const { clock } = core(on, () => ({ takes: 20 * MINUTE }));
    await start($);
    const asked = $.tool.call({ tool: "AskUserQuestion", questions: [] } as never);
    const agent = $.tool.call({ tool: "Agent", description: "x", prompt: "y" } as never);
    await clock.advance(15 * MINUTE);
    expect(await isQuiet($)).toBe(true);
    await clock.advance(6 * MINUTE);
    await Promise.all([asked, agent]);
  });

  test("a turn with nothing happening is named, and activity or its end clears it", async ($, on) => {
    const { clock } = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(4 * MINUTE);
    await bash($, "ls");
    await clock.advance(4 * MINUTE);
    expect(await isQuiet($)).toBe(true);

    await clock.advance(MINUTE + 10_000);
    expect(await shown($)).toContain("⚠ No activity for 5m");
    await bash($, "ls -la");
    await clock.advance(10_000);
    expect(await isQuiet($)).toBe(true);

    await clock.advance(6 * MINUTE);
    expect(await isQuiet($)).toBe(false);
    await endTurn($);
    expect(await isQuiet($)).toBe(true);
  });

  test("an idle session between turns is quiet", async ($, on) => {
    const { clock } = core(on);
    await start($);
    await beginTurn($);
    await endTurn($);
    await clock.advance(30 * MINUTE);
    expect(await isQuiet($)).toBe(true);
  });

  test("the time is the person's to set", { options: { stallMinutes: 1 } }, async ($, on) => {
    const { clock } = core(on, () => ({ takes: 3 * MINUTE }));
    await start($);
    const call = bash($, "sleep 100");
    await clock.advance(MINUTE + 10_000);
    expect(await shown($)).toContain("Bash has no result after 1m");
    await clock.advance(2 * MINUTE);
    await call;
  });

  test("0 turns it off", { options: { stallMinutes: 0 } }, async ($, on) => {
    const { clock } = core(on, () => ({ takes: 30 * MINUTE }));
    await start($);
    await beginTurn($);
    const call = bash($, "sleep 1000");
    await clock.advance(20 * MINUTE);
    expect(await isQuiet($)).toBe(true);
    await clock.advance(11 * MINUTE);
    await call;
  });
});

describe("the same call and the same result", () => {
  test("three in a row are named, a different result starts over", async ($, on) => {
    core(on, () => ({ text: "On branch main\nnothing to commit" }));
    await bash($, "git status");
    await bash($, "git status");
    expect(await isQuiet($)).toBe(true);
    await bash($, "git status");
    expect(await shown($)).toContain("⚠ Same call, same result 3× in a row");
    expect(await shown($)).toContain("Bash git status");
  });

  test("a result that changes is progress, not a loop", async ($, on) => {
    let n = 0;
    core(on, () => ({ text: `attempt ${n++}` }));
    for (let i = 0; i < 5; i++) await bash($, "gh pr checks");
    expect(await isQuiet($)).toBe(true);
  });

  test("another call in between breaks the run", async ($, on) => {
    core(on, () => ({ text: "same" }));
    await bash($, "a");
    await bash($, "a");
    await bash($, "b");
    await bash($, "a");
    await bash($, "a");
    expect(await isQuiet($)).toBe(true);
  });

  test("a later different call takes the alert down", async ($, on) => {
    core(on, () => ({ text: "same" }));
    for (let i = 0; i < 3; i++) await bash($, "a");
    expect(await isQuiet($)).toBe(false);
    await bash($, "b");
    expect(await isQuiet($)).toBe(true);
  });

  test("polling is meant to repeat", async ($, on) => {
    core(on, () => ({ text: "pending" }));
    for (let i = 0; i < 4; i++) await $.tool.call({ tool: "TaskGet", taskId: "1" } as never);
    expect(await isQuiet($)).toBe(true);
  });
});

describe("the band", () => {
  for (const surface of SURFACES) {
    test(`${surface}: shows the worst first, and Dismiss takes one down`, async ($, on) => {
      core(on, (call) => (call.tool === "Bash" ? fail() : {}));
      await edit($, "/home/dev/other.md");
      await edit($, "/etc/hosts");

      const ui = await band($, { surface });
      const colors = (await ui.findAll({ type: "Text" })).map((t) => t.props.color);
      expect(colors.indexOf("error")).toBeGreaterThanOrEqual(0);
      expect(colors.indexOf("error")).toBeLessThan(colors.indexOf("warning"));
      expect(await ui.find({ type: "Button", key: "dismiss:outside:/etc/hosts" })).toBeDefined();

      await ui.press({ key: "dismiss:outside:/etc/hosts" });
      const after = (await ui.findAll({ type: "Text" })).map((t) => t.props.color);
      expect(after).not.toContain("error");
      expect(after).toContain("warning");
      await ui.unmount();
    });
  }

  test("a dismissed alert stays quiet while its cause goes on, and returns with a new one", async ($, on) => {
    let isFailing = true;
    const { toasts } = core(on, () => (isFailing ? fail() : {}));
    for (let i = 0; i < 3; i++) await bash($, `f${i}`);
    const ui = await band($);
    await ui.press({ key: "dismiss:failures:main" });
    await ui.unmount();
    expect(await isQuiet($)).toBe(true);

    await bash($, "f3");
    await bash($, "f4");
    expect(await isQuiet($)).toBe(true);
    expect(toasts).toHaveLength(1);

    isFailing = false;
    await bash($, "fine");
    isFailing = true;
    for (let i = 0; i < 3; i++) await bash($, `g${i}`);
    expect(await isQuiet($)).toBe(false);
    expect(toasts).toHaveLength(2);
  });

  test("more than three: the rest is counted, and Dismiss all takes them all down", async ($, on) => {
    core(on);
    for (const file of ["/a/1", "/a/2", "/a/3", "/a/4", "/a/5"]) await edit($, file);
    const ui = await band($);
    const text = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
    expect(text).toContain("… and 2 more · /heads-up lists them");
    await ui.press({ key: "dismiss-all" });
    await ui.unmount();
    expect(await isQuiet($)).toBe(true);
  });

  test("desktop draws emoji where the terminal draws single-cell glyphs", async ($, on) => {
    core(on);
    await edit($, "/etc/hosts");
    expect(await shown($, { surface: "terminal" })).toContain("✖ Edit outside the project");
    expect(await shown($, { surface: "desktop" })).toContain("⛔ Edit outside the project");
  });

  test("a narrow terminal keeps the title and drops the detail", async ($, on) => {
    core(on);
    await edit($, "/home/dev/other/notes.md");
    expect(await shown($, { bodyColumns: 59 })).not.toContain("notes.md");
    expect(await shown($, { bodyColumns: 60 })).toContain("notes.md");
  });

  test("yields to a survey", async ($, on) => {
    core(on);
    await edit($, "/etc/hosts");
    expect(await isQuiet($, { hasSurvey: true })).toBe(true);
  });

  test("is left to core while nothing is wrong", async ($, on) => {
    core(on);
    expect(await isQuiet($)).toBe(true);
  });

  test("a mounted band redraws when something new happens", async ($, on) => {
    core(on);
    const ui = await band($);
    expect(await ui.find({ type: "Text", text: /outside/ })).toBeUndefined();
    await edit($, "/etc/hosts");
    expect(await ui.find({ type: "Text", text: /outside/ })).toBeDefined();
    await ui.unmount();
  });
});

describe("/heads-up", () => {
  test("lists what happened, newest first, with its state", async ($, on) => {
    const { clock } = core(on, () => ({}));
    await start($);
    await edit($, "/home/dev/other.md");
    await clock.advance(3 * MINUTE);
    await edit($, "/etc/hosts");
    const ui = await band($);
    await ui.press({ key: "dismiss:outside:/home/dev/other.md" });
    await ui.unmount();

    const { text } = await slash($);
    expect(text).toContain("Heads-up: 1 active, 1 earlier");
    expect(text!.indexOf("✖ Edit outside the project · /etc/hosts")).toBeLessThan(text!.indexOf("⚠ Edit outside the project"));
    expect(text).toContain("(3m ago, dismissed)");
  });

  test("says so when there is nothing", async ($, on) => {
    core(on);
    await start($);
    expect((await slash($)).text).toContain("Nothing to report");
  });

  test("clear dismisses what is showing", async ($, on) => {
    core(on);
    await start($);
    await edit($, "/etc/hosts");
    await edit($, "/etc/passwd");
    expect((await slash($, "clear")).text).toBe("Cleared 2 heads-ups.");
    expect(await isQuiet($)).toBe(true);
    expect((await slash($, "clear")).text).toBe("No heads-ups to clear.");
  });

  test("off mutes for the session, on brings it back", async ($, on) => {
    const { toasts } = core(on);
    await start($);
    await slash($, "off");
    await edit($, "/etc/hosts");
    expect(await isQuiet($)).toBe(true);
    expect(toasts).toEqual([]);
    expect((await slash($)).text).toContain("Muted");

    await slash($, "on");
    await edit($, "/etc/passwd");
    expect(await isQuiet($)).toBe(false);
  });

  test("an unknown argument gets the usage", async ($, on) => {
    core(on);
    await start($);
    expect((await slash($, "wat")).text).toBe("Usage: /heads-up [clear|off|on]");
  });
});

describe("notifications", () => {
  test("off by default", async ($, on) => {
    const { notices } = core(on);
    await edit($, "/etc/hosts");
    expect(notices).toEqual([]);
  });

  test("when asked for, warnings reach the person away from the window", { options: { notify: true } }, async ($, on) => {
    const { notices } = core(on);
    await edit($, "/etc/hosts");
    expect(notices).toEqual(["Heads-up: Edit outside the project: /etc/hosts"]);
  });
});
