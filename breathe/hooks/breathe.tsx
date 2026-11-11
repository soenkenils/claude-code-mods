// Breathe: a breathing exercise to look at while Claude works.
//
// While a turn runs, a band above the prompt breathes in time (box breathing by default: in,
// hold, out, hold), after a short countdown (3, 2, 1, 0). When the turn ends it does not
// vanish: it finishes the breath it is in and goes at the end of the exhale. A turn that ends
// during the countdown has no breath to finish, so the band goes at once. A Hide button takes
// the band away for the rest of the turn, for when you do not want to breathe along just now.
//
// One module, two drawings, each one line high. Claude Desktop gets a small aurora orb that
// expands and contracts with the phase in words beside it, one SVG that animates itself, so the
// band sends the same picture on every redraw. The terminal gets the phase in words and a bar
// that fills and empties with the breath.
//
// The band does not appear the moment a turn begins: a quick answer should not call up a
// breathing exercise it then takes away. It waits `startAfterSeconds` (3 by default). It steps
// aside while Claude asks a question (AskUserQuestion) and is drawn afresh, in step with the
// breath, when the question is answered. `/breathe box|even|calm` picks the pattern for the
// session; `speak` says each phase aloud with the system voice.

import { atom, read, update } from "claude-code";
import type { EngineInterface, PluginOptions, Register, Timer } from "claude-code";

import { breathingSvg, pictureSize } from "./orb";
import type { Motion, Theme } from "./orb";
import { countdownAt, countdownMs, cycleMs, frameAt, isPatternId, patternOf, restAt, timing } from "./pacer";
import type { Kind, Pattern, PatternId } from "./pacer";
import type { BreatheRun } from "../types/index";

const COMMAND = "breathe";
const FRAME_MS = 100;
// The desktop's picture is this high, in CSS pixels: the orb and one line of text.
//
// It was meant to be 84 and then 60, and came out 99 in a band 170 high. Claude Desktop draws an
// animated (`isInteractive`) Svg in a frame of its own, and, measured on a screenshot of the app
// (2026-11-11), a frame that is given no size is 300 by 150 px whatever size the markup says,
// with the picture fitted into it. So the Svg element is given the picture's size as its own.
const ORB_PIXELS = 24;
const FADE_IN_MS = 800; // The desktop's picture fades in when it first shows,
const END_FADE_MS = 800; // fades out ending as the last exhale does,
const HIDE_FADE_MS = 400; // and quickly when the Hide button is pressed.
// The timer ticks every FRAME_MS, but only a band of text needs a redraw that often: the
// desktop's picture animates itself. Once it has been drawn and no line of text has been for
// LINE_FRESH_MS, a redraw goes out every QUIET_EVERY ticks, which also finds a line if one is
// there again (a narrow window, a terminal that attached), and at the moment the band is due.
const LINE_FRESH_MS = 1500;
const QUIET_EVERY = 10;
// A picture not drawn for this long was not on screen (the band stepped aside, or the window was
// away): it is drawn afresh, since its animation starts when the surface draws it.
const STALE_MS = 3000;

// Held by the host, so a reload of this file does not lose the breath in progress.
const run = atom({ plugin: "breathe", key: "run" } as const, null, { shape: "run-3" });
const isMuted = atom({ plugin: "breathe", key: "isMuted" } as const, false);
const isAsked = atom({ plugin: "breathe", key: "isAsked" } as const, false);
const chosen = atom({ plugin: "breathe", key: "pattern" } as const, null);

// The words next to the animation. The design is in German.
const LABELS = {
  de: {
    hide: "Ausblenden", ready: "Mach dich bereit", in: "Einatmen", holdIn: "Halten", out: "Ausatmen", holdOut: "Halten",
    done: "Claude ist fertig · atme zu Ende aus", orb: "Atemkugel",
    names: { box: "Box Breathing", even: "Gleichmäßiges Atmen", calm: "Ruhiges Atmen" },
  },
  en: {
    hide: "Hide", ready: "Get ready", in: "Breathe in", holdIn: "Hold", out: "Breathe out", holdOut: "Hold",
    done: "Claude is done · finish your exhale", orb: "Breathing orb",
    names: { box: "Box Breathing", even: "Even Breathing", calm: "Calm Breathing" },
  },
} as const;

// Theme keys, so the text follows the person's theme: green in, clay out, blue for the holds.
const COLOR: Record<Kind, string> = { in: "success", holdIn: "suggestion", out: "claude", holdOut: "suggestion" };
const READY_COLOR = "suggestion"; // the countdown

function configFrom(options: PluginOptions) {
  // The manifest's min and max are enforced before this runs; a value that is no number is not.
  const number = (key: string, fallback: number) => {
    const value = options[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  const choice = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = options[key];
    return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  const labels = options.language === "en" ? LABELS.en : LABELS.de;
  return {
    patternId: (isPatternId(options.pattern) ? options.pattern : "box") as PatternId,
    seconds: number("phaseSeconds", 4),
    delayMs: number("startAfterSeconds", 3) * 1000,
    countdownFrom: Math.max(0, Math.round(number("countdownSeconds", 3))),
    countdownMs: countdownMs(number("countdownSeconds", 3)),
    labels,
    words: { ready: labels.ready, in: labels.in, holdIn: labels.holdIn, out: labels.out, holdOut: labels.holdOut },
    motion: choice<Motion>("motion", ["auto", "reduced"], "auto"),
    theme: choice<Theme>("theme", ["auto", "dark", "light"], "auto"),
    isSpoken: options.speak === true,
  };
}
type Config = ReturnType<typeof configFrom>;

// The pattern a run was begun with (an id from the run, which a reload or an old value may leave
// unknown: then the setting's), and how it reads in a hint: `Box Breathing · 4-4-4-4`.
const patternFor = (cfg: Config, id: string): Pattern => patternOf(isPatternId(id) ? id : cfg.patternId, cfg.seconds);
const hintFor = (cfg: Config, pattern: Pattern) => `${cfg.labels.names[isPatternId(pattern.id) ? pattern.id : "box"]} · ${timing(pattern)}`;

type Ticker = {
  timer?: Timer;
  count: number;
  // When the last tick was, to tell that the band has come due since.
  lastNow?: number;
  // When a render last drew the picture, and when it last drew a line of text.
  seenPicture?: number;
  seenLine?: number;
  // The phase last spoken: run, cycle and phase.
  spoken?: string;
};

export const register: Register = (on, options) => {
  const cfg = configFrom(options);

  // Held by this load of the module: a reload drops the timer with the old module.
  const ticker: Ticker = { count: 0 };
  // The desktop's picture, one per breathing run: it animates itself, so every redraw sends the
  // same source and the surface can keep the picture it has. It is drawn again only when the
  // run changes in a way the picture must know (the turn ended, or Hide was pressed), and a
  // reload draws it afresh, in step with the breath.
  let orb: { startedAt: number; key: string; source: string; width: number; height: number; drawnAt: number } | undefined;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Turn the breathing animation on or off, or pick its pattern",
      argumentHint: "[on|off|box|even|calm]",
    });
    // A reload in the middle of a turn: carry on with the breath in progress.
    if ((await read($, run)) !== null) startTicking($, ticker, cfg);
    return next(e);
  });

  // Only the main conversation's turns: a subagent works inside one of them.
  on("turn.start", async ($, e, next) => {
    if (e.agentId === undefined) await begin($, ticker, cfg);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) await finish($, cfg);
    return next(e);
  });

  // Claude's question to you: the band steps aside while it waits (the tool's call is the wait),
  // and the breath carries on behind it. A subagent's question is not asked here.
  on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    await update($, isAsked, () => true);
    try {
      return await next(e);
    } finally {
      await update($, isAsked, () => false);
    }
  });

  on("command.run", { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg === "off") {
      await update($, isMuted, () => true);
      await update($, run, () => null);
      return { text: "Breathe is off for this session. /breathe on turns it back on." };
    }
    if (arg === "on") {
      await update($, isMuted, () => false);
      return { text: "Breathe is on. It starts with the next turn." };
    }
    if (isPatternId(arg)) {
      await update($, chosen, () => arg);
      const off = (await read($, isMuted)) ? " Breathe is still off." : "";
      return { text: `Pattern: ${hintFor(cfg, patternFor(cfg, arg))}. It applies from the next turn.${off}` };
    }
    if (arg !== "") return { text: "Usage: /breathe [on|off|box|even|calm]" };
    const pattern = patternFor(cfg, (await read($, chosen)) ?? cfg.patternId);
    const state = (await read($, isMuted)) ? "Breathe is off. /breathe on turns it back on." : "Breathe is on.";
    return { text: `${state} Pattern: ${hintFor(cfg, pattern)}.` };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, run);
    // Nothing to show, or the band steps aside. The picture is drawn afresh when it is back: its
    // animation starts when the surface draws it, so a kept one would be out of step.
    if (current === null || e.props.hasSurvey || (await read($, isMuted)) || (await read($, isAsked))) {
      orb = undefined;
      return next(e);
    }

    // The tick redraws the band (`$.ui.invalidate`), and each draw reads the time afresh.
    const now = await $.clock.now();
    // `elapsed` is negative before the first breath: the wait, then the countdown that ends at 0.
    const elapsed = now - current.startedAt;
    const isOver = current.finishAt !== null && now >= current.finishAt;
    if (elapsed < -cfg.countdownMs || isOver) {
      orb = undefined;
      return next(e);
    }
    const hasPicture = e.surface !== "terminal" && e.props.bodyColumns >= 36;
    // The tick asks what the band needs: a line of text a redraw ten times a second, a picture none.
    if (hasPicture) ticker.seenPicture = now;
    else ticker.seenLine = now;
    // Only the picture can fade; a line of text has nothing to fade, so it goes at once.
    if (current.isHiding && !hasPicture) return next(e);
    const pattern = patternFor(cfg, current.pattern);

    const isCounting = elapsed < 0;
    const frame = frameAt(pattern, Math.max(0, elapsed));
    const shown = isCounting
      ? { label: cfg.labels.ready, color: READY_COLOR, fill: 0, number: countdownAt(-elapsed) }
      : { label: cfg.labels[frame.kind], color: COLOR[frame.kind], fill: frame.fill, number: frame.secondsLeft };
    const hint = current.finishAt === null ? hintFor(cfg, pattern) : cfg.labels.done;
    const { Box, Text, Button } = $.ui.resolve(e);
    // `role="dismiss"` is for the app's own close control, named by the label.
    const hideButton = <Button key="hide" label={cfg.labels.hide} plain dimColor role="dismiss" onPress={() => dismiss($, hasPicture)} />;
    // Beside the picture it is a cross: a desktop app that has no close control of its own draws
    // what the button holds (the app in the screenshot drew the word), and the label still names it.
    const closeButton = (
      <Button key="hide" label={cfg.labels.hide} plain dimColor role="dismiss" onPress={() => dismiss($, hasPicture)}>
        ✕
      </Button>
    );

    // The one-line version: the phase, a bar that fills and empties with the breath, the seconds left
    // (during the countdown: the number, over an empty bar).
    const columns = e.props.bodyColumns - 2 - cfg.labels.hide.length - 1; // the Box's paddingX, the button and its gap
    const oneLine = () => (
      <Box flexDirection="row" gap={1} paddingX={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={shown.color} weight="semibold">
              {shown.label}
            </Text>
            {"  "}
            <Text color={shown.color}>{bar(shown.fill, Math.max(4, Math.min(16, columns - shown.label.length - 10)))}</Text>
            <Text dimColor tabular>{`  ${shown.number}`}</Text>
            {columns >= 56 ? <Text dimColor>{`  ${hint}`}</Text> : null}
          </Text>
        </Box>
        {hideButton}
      </Box>
    );

    let mine: JSX.Element;
    if (!hasPicture) {
      // The terminal gets words and a bar; so does a desktop band too narrow for the picture.
      mine = oneLine();
    } else {
      const { Svg } = $.ui.resolve(e);
      const key = `${current.startedAt}:${current.finishAt}:${current.isHiding}`;
      if (orb !== undefined && now - orb.drawnAt > STALE_MS) orb = undefined;
      if (orb === undefined || orb.key !== key) {
        // It fades in the first time a run shows it, not again when it is drawn anew.
        const isFirst = orb === undefined || orb.startedAt !== current.startedAt;
        let fadeOut: { inMs: number; ms: number } | undefined;
        if (current.finishAt !== null) {
          const left = Math.max(1, current.finishAt - now);
          const ms = Math.min(current.isHiding ? HIDE_FADE_MS : END_FADE_MS, left);
          fadeOut = { inMs: left - ms, ms };
        }
        const sized = { pattern, words: cfg.words, countdownFrom: cfg.countdownFrom, shown: ORB_PIXELS };
        const size = pictureSize(sized);
        const source = breathingSvg({
          ...sized,
          elapsedMs: elapsed,
          motion: cfg.motion,
          theme: cfg.theme,
          fadeInMs: isFirst ? FADE_IN_MS : 0,
          ...(fadeOut ? { fadeOut } : {}),
        });
        orb = { startedAt: current.startedAt, key, source, ...size, drawnAt: now };
      }
      orb.drawnAt = now;
      const isFinishing = current.finishAt !== null && !current.isHiding;
      mine = (
        <Box flexDirection="row" alignItems="center" columnGap={2} paddingX={1}>
          {/* The orb and the phase's word are one picture that moves by itself; a redraw leaves it be. */}
          <Svg source={orb.source} alt={cfg.labels.orb} width={orb.width} height={orb.height} isInteractive />
          {/* What is left of the row, so the close control sits at the band's far end. */}
          <Box flexGrow={1}>
            {isFinishing ? (
              <Text dimColor size="footnote">
                {cfg.labels.done}
              </Text>
            ) : null}
          </Box>
          {closeButton}
        </Box>
      );
    }

    // Another mod's band (the forecast, a heads-up) stays, under the orb. The engine draws
    // nothing of its own here, so its node is left out.
    const below = await next(e);
    return (
      <Box flexDirection="column">
        {mine}
        {below.type === "engine" ? null : below}
      </Box>
    );
  });
};

// The Hide button: the breath is dropped and the band goes, the timer stopping with the next
// tick. A picture fades out first (the run lasts a moment more, `isHiding`); a line of text goes
// at once. The next turn begins a new breath; /breathe off is for good.
async function dismiss($: EngineInterface, hasPicture: boolean) {
  const now = await $.clock.now();
  await update($, run, (current) => {
    if (current === null || !hasPicture) return null;
    return current.isHiding ? current : { startedAt: current.startedAt, finishAt: now + HIDE_FADE_MS, isHiding: true, pattern: current.pattern };
  });
}

// A turn begins: the wait (if set), the countdown, then the first breath. A breath that is
// still winding down from the last one carries on, with no countdown.
async function begin($: EngineInterface, ticker: Ticker, cfg: Config) {
  if (await read($, isMuted)) return;
  // A question that never reported its answer (its hook was skipped) must not hold the band for good.
  await update($, isAsked, () => false);
  const now = await $.clock.now();
  const id = (await read($, chosen)) ?? cfg.patternId;
  await update($, run, (current) =>
    current !== null && !current.isHiding && (current.finishAt === null || current.finishAt > now)
      ? { startedAt: current.startedAt, finishAt: null, isHiding: false, pattern: current.pattern }
      : { startedAt: now + cfg.delayMs + cfg.countdownMs, finishAt: null, isHiding: false, pattern: id },
  );
  startTicking($, ticker, cfg);
}

// A turn is over (answered, interrupted or failed alike). Let the breath in progress run on
// to the end of its exhale; one that has not begun (still waiting or counting down) is dropped.
async function finish($: EngineInterface, cfg: Config) {
  const now = await $.clock.now();
  await update($, run, (current) => {
    if (current === null || current.finishAt !== null) return current;
    if (now < current.startedAt) return null;
    const finishAt = restAt(patternFor(cfg, current.pattern), current.startedAt, now);
    return finishAt <= now ? null : { startedAt: current.startedAt, finishAt, isHiding: false, pattern: current.pattern };
  });
}

function startTicking($: EngineInterface, ticker: Ticker, cfg: Config) {
  if (ticker.timer !== undefined) return;
  ticker.timer = $.clock.every(FRAME_MS, () => tick($, ticker, cfg));
}

// A frame: ask for a redraw, which reads the new time, and say the phase if it is to be said.
// At the end of a breath the animation goes, and the timer with it.
async function tick($: EngineInterface, ticker: Ticker, cfg: Config) {
  try {
    const now = await $.clock.now();
    const before = ticker.lastNow;
    ticker.lastNow = now;
    ticker.count += 1;
    let current = await read($, run);
    if (current !== null && current.finishAt !== null && now >= current.finishAt) {
      current = await update($, run, (value) => (value !== null && value.finishAt !== null && value.finishAt <= now ? null : value));
    }
    if (current === null) {
      ticker.timer?.cancel();
      ticker.timer = undefined;
      // A turn may have begun while this one ended.
      if ((await read($, run)) !== null) startTicking($, ticker, cfg);
      return;
    }
    // The band is due the moment the wait is over and its countdown begins.
    const appearsAt = current.startedAt - cfg.countdownMs;
    const isDue = before !== undefined && before < appearsAt && appearsAt <= now;
    const isQuiet = ticker.seenPicture !== undefined && (ticker.seenLine === undefined || now - ticker.seenLine > LINE_FRESH_MS);
    if (!isQuiet || isDue || ticker.count % QUIET_EVERY === 0) $.ui.invalidate("ui.render");
    if (cfg.isSpoken) await speak($, ticker, cfg, current, now);
  } catch {
    // The next tick tries again.
  }
}

// Says the phase the breath has just entered, once, with the system voice. It speaks nothing
// before the first breath, after Hide, or while a question waits, and a surface with no voice
// (anything but macOS) refuses and is let be.
async function speak($: EngineInterface, ticker: Ticker, cfg: Config, current: BreatheRun, now: number) {
  const elapsed = now - current.startedAt;
  if (elapsed < 0 || current.isHiding || (await read($, isAsked)) || (await read($, isMuted))) return;
  const pattern = patternFor(cfg, current.pattern);
  const frame = frameAt(pattern, elapsed);
  const key = `${current.startedAt}:${Math.floor(elapsed / cycleMs(pattern))}:${frame.index}`;
  if (ticker.spoken === key) return;
  ticker.spoken = key;
  try {
    await $.audio.speak(cfg.labels[frame.kind]);
  } catch {
    // No voice here.
  }
}

// The left part of a cell, in eighths, so the bar moves in steps finer than a cell.
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

// `████▌───`: how much of it is filled, to an eighth of a cell. A little shows for any breath at all.
function bar(share: number, width: number) {
  if (share <= 0) return "─".repeat(width);
  const eighths = Math.min(width * 8, Math.max(1, Math.round(share * width * 8)));
  const full = Math.floor(eighths / 8);
  const part = EIGHTHS[eighths % 8] ?? "";
  return "█".repeat(full) + part + "─".repeat(width - full - (part ? 1 : 0));
}
