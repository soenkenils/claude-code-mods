// Breathe: a breathing exercise to look at while Claude works.
//
// While a turn runs, a band above the prompt breathes in box breathing time (in, hold, out,
// hold). When the turn ends it does not vanish: it finishes the breath it is in and goes at
// the end of the exhale.
//
// One module, two drawings. Claude Desktop gets an aurora orb that expands and contracts, an
// SVG redrawn for every frame. The terminal gets one line: the phase in words and a bar that
// fills and empties with the breath.

import { atom, read, update } from "claude-code";
import type { EngineInterface, PluginOptions, Register, Timer } from "claude-code";

import { scene, svg } from "./orb";
import { box, frameAt, restAt } from "./pacer";
import type { Kind } from "./pacer";

const COMMAND = "breathe";
const FRAME_MS = 100;
const ORB_PIXELS = 112; // The desktop's orb, in CSS pixels.

// Held by the host, so a reload of this file does not lose the breath in progress.
const run = atom({ plugin: "breathe", key: "run" } as const, null, { shape: "run-1" });
const clock = atom({ plugin: "breathe", key: "now" } as const, 0);
const isMuted = atom({ plugin: "breathe", key: "isMuted" } as const, false);

// The words next to the animation. The design is in German.
const LABELS = {
  de: { in: "Einatmen", holdIn: "Halten", out: "Ausatmen", holdOut: "Halten", done: "Claude ist fertig · atme zu Ende aus" },
  en: { in: "Breathe in", holdIn: "Hold", out: "Breathe out", holdOut: "Hold", done: "Claude is done · finish your exhale" },
} as const;

// Theme keys, so the text follows the person's theme: green in, clay out, blue for the holds.
const COLOR: Record<Kind, string> = { in: "success", holdIn: "suggestion", out: "claude", holdOut: "suggestion" };

function configFrom(options: PluginOptions) {
  // The manifest's min and max are enforced before this runs; a value that is no number is not.
  const number = (key: string, fallback: number) => {
    const value = options[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  const phaseSeconds = number("phaseSeconds", 4);
  return {
    pattern: box(phaseSeconds),
    phaseSeconds,
    delayMs: number("startAfterSeconds", 0) * 1000,
    labels: options.language === "en" ? LABELS.en : LABELS.de,
  };
}
type Config = ReturnType<typeof configFrom>;
type Ticker = { timer?: Timer };

export const register: Register = (on, options) => {
  const cfg = configFrom(options);

  // Held by this load of the module: a reload drops the timer with the old module.
  const ticker: Ticker = {};

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

    // Reading the time is what redraws the band at every tick.
    const now = await read($, clock);
    const elapsed = now - current.startedAt;
    const isOver = current.finishAt !== null && now >= current.finishAt;
    if (elapsed < 0 || isOver) return next(e);

    const frame = frameAt(cfg.pattern, elapsed);
    const label = cfg.labels[frame.kind];
    const hint = current.finishAt === null ? `Box Breathing · ${Array(4).fill(cfg.phaseSeconds).join("-")}` : cfg.labels.done;
    const { Box, Text } = $.ui.resolve(e);

    // The one-line version: the phase, a bar that fills and empties with the breath, the seconds left.
    const columns = e.props.bodyColumns - 2; // the Box's paddingX
    const oneLine = () => (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text color={COLOR[frame.kind]} weight="semibold">
            {label}
          </Text>
          {"  "}
          <Text color={COLOR[frame.kind]}>{bar(frame.fill, Math.max(4, Math.min(16, columns - label.length - 10)))}</Text>
          <Text dimColor tabular>{`  ${frame.secondsLeft}`}</Text>
          {columns >= 60 ? <Text dimColor>{`  ${hint}`}</Text> : null}
        </Text>
      </Box>
    );

    let mine: JSX.Element;
    if (e.surface === "terminal" || e.props.bodyColumns < 36) {
      // The terminal gets words and a bar; so does a desktop band too narrow for the picture.
      mine = oneLine();
    } else {
      const { Svg } = $.ui.resolve(e);
      const draw = scene(frame.fill, elapsed / 1000);
      mine = (
        <Box flexDirection="row" alignItems="center" columnGap={3} paddingX={1}>
          <Svg source={svg(draw, ORB_PIXELS)} alt={`${label}, ${frame.secondsLeft}`} />
          <Box flexDirection="column">
            <Text size="title" weight="semibold">
              {label}
            </Text>
            <Text color={COLOR[frame.kind]} tabular>{`${frame.secondsLeft} s`}</Text>
            <Text dimColor size="footnote">
              {hint}
            </Text>
          </Box>
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

// A turn begins. A breath that is still winding down from the last one carries on.
async function begin($: EngineInterface, ticker: Ticker, cfg: Config) {
  if (await read($, isMuted)) return;
  const now = await $.clock.now();
  await update($, run, (current) =>
    current !== null && (current.finishAt === null || current.finishAt > now)
      ? { startedAt: current.startedAt, finishAt: null }
      : { startedAt: now + cfg.delayMs, finishAt: null },
  );
  await update($, clock, () => now);
  startTicking($, ticker);
}

// A turn is over (answered, interrupted or failed alike). Let the breath in progress run on
// to the end of its exhale; one that never came on screen is dropped.
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

// A frame: the new time is what draws it. At the end of a breath the animation goes, and the
// timer with it.
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
    await update($, clock, () => now);
  } catch {
    // The next tick tries again.
  }
}

// `━━━━────`: how much of it is filled. A little shows for any breath at all.
function bar(share: number, width: number) {
  const filled = share <= 0 ? 0 : Math.min(width, Math.max(1, Math.round(share * width)));
  return "━".repeat(filled) + "─".repeat(width - filled);
}
