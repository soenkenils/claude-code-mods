// Breathe: a breathing exercise to look at while Claude works.
//
// While a turn runs, a band above the prompt breathes in time (box breathing by default: in,
// hold, out, hold), after a short countdown (3, 2, 1, 0). When the turn ends it does not
// vanish: it finishes the breath it is in and goes at the end of the exhale. A turn that ends
// during the countdown has no breath to finish, so the band goes at once. A Hide button takes
// the band away for the rest of the turn, for when you do not want to breathe along just now.
//
// One module, two drawings. Claude Desktop gets an aurora orb that expands and contracts, an
// SVG that animates itself, so the band sends the same picture on every redraw. The terminal
// gets one line: the phase in words and a bar that fills and empties with the breath.

import { atom, read, update } from "claude-code";
import type { EngineInterface, PluginOptions, Register, Timer } from "claude-code";

import { breathingSvg } from "./orb";
import { countdownAt, countdownMs, frameAt, isPatternId, patternOf, restAt, timing } from "./pacer";
import type { Kind } from "./pacer";

const COMMAND = "breathe";
const FRAME_MS = 100;
const ORB_PIXELS = 112; // The desktop's orb, in CSS pixels.

// Held by the host, so a reload of this file does not lose the breath in progress.
const run = atom({ plugin: "breathe", key: "run" } as const, null, { shape: "run-1" });
const isMuted = atom({ plugin: "breathe", key: "isMuted" } as const, false);

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
  const pattern = patternOf(isPatternId(options.pattern) ? options.pattern : "box", number("phaseSeconds", 4));
  const labels = options.language === "en" ? LABELS.en : LABELS.de;
  return {
    pattern,
    delayMs: number("startAfterSeconds", 0) * 1000,
    countdownMs: countdownMs(number("countdownSeconds", 3)),
    labels,
    hint: `${labels.names[isPatternId(pattern.id) ? pattern.id : "box"]} · ${timing(pattern)}`,
  };
}
type Config = ReturnType<typeof configFrom>;
type Ticker = { timer?: Timer };

export const register: Register = (on, options) => {
  const cfg = configFrom(options);

  // Held by this load of the module: a reload drops the timer with the old module.
  const ticker: Ticker = {};
  // The desktop's orb, one picture per breathing run: it animates itself, so every redraw
  // sends the same source and the surface can keep the picture it has. A reload draws it
  // afresh, in step with the breath.
  let orb: { startedAt: number; source: string } | undefined;

  on("session.start", async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "Turn the breathing animation on or off", argumentHint: "[on|off]" });
    // A reload in the middle of a turn: carry on with the breath in progress.
    if ((await read($, run)) !== null) startTicking($, ticker);
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
    if (arg !== "") return { text: "Usage: /breathe [on|off]" };
    return { text: (await read($, isMuted)) ? "Breathe is off. /breathe on turns it back on." : "Breathe is on." };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, run);
    if (current === null || e.props.hasSurvey || (await read($, isMuted))) return next(e);

    // The tick redraws the band (`$.ui.invalidate`), and each draw reads the time afresh.
    const now = await $.clock.now();
    // `elapsed` is negative before the first breath: the wait, then the countdown that ends at 0.
    const elapsed = now - current.startedAt;
    const isOver = current.finishAt !== null && now >= current.finishAt;
    if (elapsed < -cfg.countdownMs || isOver) return next(e);

    const isCounting = elapsed < 0;
    const frame = frameAt(cfg.pattern, Math.max(0, elapsed));
    const shown = isCounting
      ? { label: cfg.labels.ready, color: READY_COLOR, fill: 0, number: countdownAt(-elapsed) }
      : { label: cfg.labels[frame.kind], color: COLOR[frame.kind], fill: frame.fill, number: frame.secondsLeft };
    const hint = current.finishAt === null ? cfg.hint : cfg.labels.done;
    const { Box, Text, Button } = $.ui.resolve(e);
    const hideButton = <Button key="hide" label={cfg.labels.hide} plain dimColor onPress={() => dismiss($)} />;

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
    if (e.surface === "terminal" || e.props.bodyColumns < 36) {
      // The terminal gets words and a bar; so does a desktop band too narrow for the picture.
      mine = oneLine();
    } else {
      const { Svg } = $.ui.resolve(e);
      if (orb === undefined || orb.startedAt !== current.startedAt) {
        orb = { startedAt: current.startedAt, source: breathingSvg(cfg.pattern, elapsed, ORB_PIXELS) };
      }
      mine = (
        <Box flexDirection="row" alignItems="center" columnGap={3} paddingX={1}>
          {/* The words beside it change; the picture and its alt stay, so a redraw does not replace it. */}
          <Svg source={orb.source} alt={cfg.labels.orb} isInteractive />
          <Box flexDirection="column" flexGrow={1}>
            <Text size="title" weight="semibold">
              {shown.label}
            </Text>
            {isCounting ? (
              <Text color={shown.color} size="heading" weight="semibold" tabular>{`${shown.number}`}</Text>
            ) : (
              <Text color={shown.color} tabular>{`${shown.number} s`}</Text>
            )}
            <Text dimColor size="footnote">
              {hint}
            </Text>
          </Box>
          {hideButton}
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

// The Hide button: the breath is dropped, so the band goes and the timer stops with the next
// tick. The next turn begins a new one; /breathe off is for good.
async function dismiss($: EngineInterface) {
  await update($, run, () => null);
}

// A turn begins: the wait (if set), the countdown, then the first breath. A breath that is
// still winding down from the last one carries on, with no countdown.
async function begin($: EngineInterface, ticker: Ticker, cfg: Config) {
  if (await read($, isMuted)) return;
  const now = await $.clock.now();
  await update($, run, (current) =>
    current !== null && (current.finishAt === null || current.finishAt > now)
      ? { startedAt: current.startedAt, finishAt: null }
      : { startedAt: now + cfg.delayMs + cfg.countdownMs, finishAt: null },
  );
  startTicking($, ticker);
}

// A turn is over (answered, interrupted or failed alike). Let the breath in progress run on
// to the end of its exhale; one that has not begun (still waiting or counting down) is dropped.
async function finish($: EngineInterface, cfg: Config) {
  const now = await $.clock.now();
  await update($, run, (current) => {
    if (current === null || current.finishAt !== null) return current;
    if (now < current.startedAt) return null;
    const finishAt = restAt(cfg.pattern, current.startedAt, now);
    return finishAt <= now ? null : { startedAt: current.startedAt, finishAt };
  });
}

function startTicking($: EngineInterface, ticker: Ticker) {
  if (ticker.timer !== undefined) return;
  ticker.timer = $.clock.every(FRAME_MS, () => tick($, ticker));
}

// A frame: ask for a redraw, which reads the new time. At the end of a breath the animation
// goes, and the timer with it.
async function tick($: EngineInterface, ticker: Ticker) {
  try {
    const now = await $.clock.now();
    let current = await read($, run);
    if (current !== null && current.finishAt !== null && now >= current.finishAt) {
      current = await update($, run, (value) => (value !== null && value.finishAt !== null && value.finishAt <= now ? null : value));
    }
    if (current === null) {
      ticker.timer?.cancel();
      ticker.timer = undefined;
      // A turn may have begun while this one ended.
      if ((await read($, run)) !== null) startTicking($, ticker);
      return;
    }
    $.ui.invalidate("ui.render");
  } catch {
    // The next tick tries again.
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
