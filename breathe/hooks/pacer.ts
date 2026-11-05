// The breathing itself: which phase it is, how far the lungs are filled, and when a
// breath in progress can be finished. Pure, so it is tested without the engine.

export type Kind = "in" | "holdIn" | "out" | "holdOut";
export type Phase = { kind: Kind; ms: number };
export type Pattern = { id: string; phases: Phase[] };

export type Frame = {
  kind: Kind;
  // Which of the pattern's phases, counted from 0.
  index: number;
  // How far into the phase, 0 to 1.
  progress: number;
  // Whole seconds left in the phase, counting down to 1, never 0.
  secondsLeft: number;
  // How full the lungs are, 0 (empty) to 1 (full), eased the way a breath is.
  fill: number;
};

// Box breathing: in, hold, out, hold, each the same length. The Calm blog has it at 4.
export function box(phaseSeconds: number): Pattern {
  const ms = Math.max(1, Math.round(phaseSeconds * 1000));
  return {
    id: "box",
    phases: [
      { kind: "in", ms },
      { kind: "holdIn", ms },
      { kind: "out", ms },
      { kind: "holdOut", ms },
    ],
  };
}

export function cycleMs(pattern: Pattern) {
  return pattern.phases.reduce((sum, p) => sum + p.ms, 0);
}

// Slow at both ends, like a breath: the curve of the design's `cubic-bezier(.45, 0, .55, 1)`.
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

// The frame `elapsedMs` after the animation began; the pattern repeats.
export function frameAt(pattern: Pattern, elapsedMs: number): Frame {
  const total = cycleMs(pattern);
  const offset = ((elapsedMs % total) + total) % total;
  let start = 0;
  for (const [index, phase] of pattern.phases.entries()) {
    if (offset < start + phase.ms || index === pattern.phases.length - 1) {
      const progress = Math.min(1, (offset - start) / phase.ms);
      const secondsLeft = Math.max(1, Math.ceil((phase.ms - (offset - start)) / 1000));
      return { kind: phase.kind, index, progress, secondsLeft, fill: fillOf(phase.kind, progress) };
    }
    start += phase.ms;
  }
  throw new Error("a pattern has at least one phase");
}

function fillOf(kind: Kind, progress: number) {
  switch (kind) {
    case "in":
      return ease(progress);
    case "holdIn":
      return 1;
    case "out":
      return 1 - ease(progress);
    case "holdOut":
      return 0;
  }
}

// The countdown before the first breath: from `from` down to 0, a second for each number, so
// `from + 1` seconds in all. 0 (or less) means no countdown.
export function countdownMs(from: number) {
  return from > 0 ? (Math.round(from) + 1) * 1000 : 0;
}

// The number the countdown shows when the breath begins in `untilBreathMs`, for any time
// that is left in it (more than 0, at most `countdownMs(from)`).
export function countdownAt(untilBreathMs: number) {
  return Math.max(0, Math.ceil(untilBreathMs / 1000) - 1);
}

// The moment the breath in progress ends on an exhale. A turn that ends before then
// lets the animation run until it; one that ends in the hold that follows the last
// exhale is already there, so it ends at once (that last hold is left out).
export function restAt(pattern: Pattern, startedAt: number, now: number) {
  const total = cycleMs(pattern);
  const offset = (((now - startedAt) % total) + total) % total;
  let end = 0;
  let exhaled = 0;
  for (const phase of pattern.phases) {
    end += phase.ms;
    if (phase.kind === "out") exhaled = end;
  }
  return offset >= exhaled ? now : now - offset + exhaled;
}
