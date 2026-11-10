// The orb from the design (an aurora ball with a halo), drawn as an SVG for Claude Desktop
// from a description of the scene. It has no ground of its own, so the app's background shows
// through. Pure, so it is tested and can be rendered to a picture. (The terminal has no orb:
// it gets words and a bar, in breathe.tsx.)
//
// Everything is measured in units of the orb's largest radius, with the origin at its
// centre and y pointing down. The sizes and opacities follow the design's keyframes:
// the halo goes .55 to 1.25 times its size, the body .4 to 1, the core .5 to 1.15.

import { cycleMs } from "./pacer";
import type { Pattern } from "./pacer";

export const EXTENT = 1.6; // The picture shows this far out from the centre, each way.

type Rgb = readonly [number, number, number];

// The design's "Polarlicht" colours.
const GREEN = rgb("#7FB069");
const AQUA = rgb("#4FB3B0");
const CLAY = rgb("#D97757");
const VIOLET = rgb("#8A6FC0");
const CREAM = rgb("#FAF9F5");
const SAND = rgb("#E3DACC");

// [position, colour, opacity]: a CSS gradient's stops.
type Stop = readonly [number, Rgb, number];
const HALO: Stop[] = [[0, GREEN, 0.3], [0.38, AQUA, 0.2], [0.58, VIOLET, 0.1], [0.74, VIOLET, 0]];
// Violet on top, then aqua, green, and a fringe of clay at the bottom.
const BODY: Stop[] = [[0, VIOLET, 0.9], [0.36, AQUA, 0.92], [0.64, GREEN, 0.95], [1, CLAY, 0.88]];
const CORE: Stop[] = [[0, CREAM, 0.9], [0.24, SAND, 0.55], [0.5, GREEN, 0.35], [0.72, GREEN, 0]];

// Aurora blobs drifting around inside the orb, one revolution in `period` seconds
// (negative: the other way). `orbit` and `size` are shares of the body's radius.
const BLOBS = [
  { color: GREEN, opacity: 0.85, orbit: 0.35, size: 0.85, period: 20, phase: 0 },
  { color: AQUA, opacity: 0.8, orbit: 0.3, size: 0.7, period: -30, phase: 2.1 },
  { color: CLAY, opacity: 0.62, orbit: 0.4, size: 0.75, period: 45, phase: 4.2 },
  { color: VIOLET, opacity: 0.7, orbit: 0.25, size: 0.65, period: -70, phase: 5.3 },
] as const;

// A blob is brightest in the middle and gone at its edge.
const BLOB_RAMPS: Stop[][] = BLOBS.map((b) => [[0, b.color, b.opacity], [0.55, b.color, b.opacity * 0.45], [1, b.color, 0]]);

const HALO_SIZE = 230 / 130;
const CORE_SIZE = 75 / 130;
const TAU = Math.PI * 2;

export type Blob = { x: number; y: number; r: number };
export type Scene = {
  halo: { r: number; opacity: number };
  body: { r: number; opacity: number };
  core: { r: number };
  blobs: Blob[];
};

// `fill` is how full the lungs are, 0 to 1; `seconds` is the time since the animation began.
export function scene(fill: number, seconds: number): Scene {
  const lerp = (a: number, b: number) => a + (b - a) * fill;
  const bodyR = lerp(0.4, 1);
  return {
    halo: { r: lerp(0.55, 1.25) * HALO_SIZE, opacity: lerp(0.45, 1) },
    body: { r: bodyR, opacity: lerp(0.7, 1) },
    core: { r: lerp(0.5, 1.15) * CORE_SIZE },
    blobs: BLOBS.map((b) => {
      const angle = b.phase + (TAU * seconds) / b.period;
      return { x: bodyR * b.orbit * Math.cos(angle), y: bodyR * b.orbit * Math.sin(angle), r: bodyR * b.size };
    }),
  };
}

// ---- Desktop --------------------------------------------------------------------------

const SIZE = 160; // The drawing's own units; the picture is shown at `shown` pixels.
const MID = SIZE / 2;
const SCALE = SIZE / (2 * EXTENT);

// Gradients that never change, so a frame only moves circles. Opacity of a layer is the
// circle's own; a gradient's alphas are the design's.
const DEFS = [
  `<radialGradient id="halo">${stops(HALO)}</radialGradient>`,
  `<linearGradient id="body" x1="0" y1="0" x2="0" y2="1">${stops(BODY)}</linearGradient>`,
  `<radialGradient id="core">${stops(CORE)}</radialGradient>`,
  ...BLOB_RAMPS.map((list, i) => `<radialGradient id="blob${i}">${stops(list)}</radialGradient>`),
  `<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>`,
].join("");

// The pacer's ease as a SMIL spline: slow at both ends, like a breath.
const SPLINE = "0.45 0 0.55 1";

const num = (n: number, digits: number) => +n.toFixed(digits);
const len = (n: number) => num(n * SCALE, 2);
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// The words sit to the right of the orb, in the same picture, so they change in step with it.
const TEXT_X = SIZE + 12; // where they start, in drawing units
const FONT = 42; // their size in drawing units: about 22 px when the picture is 84 px high
const CHAR = 0.6; // an average character's width, in em, to size the picture
// What colour is right is not known in here: the picture cannot see the app's theme, and the
// OS's setting is not always the app's. By default a grey that reads on a dark ground (about
// 4.4 to 1) and on a light one (about 3.3 to 1), which is enough for large type. A person who
// says which theme the app has gets a colour made for it (about 10 to 1 and 8 to 1).
export type Theme = "auto" | "dark" | "light";
export const WORD_FILLS: Record<Theme, string> = { auto: "#8A8985", dark: "#DAD8D2", light: "#4A4944" };
const CROSS = 150; // ms: a word fades out and the next in across this long, each side of a change

export type Motion = "auto" | "reduced";

export type Words = { ready: string; in: string; holdIn: string; out: string; holdOut: string };

export type Picture = {
  pattern: Pattern;
  words: Words;
  // How far into the breathing the picture is when it first shows: negative during the
  // countdown, when the breath waits that long at rest.
  elapsedMs: number;
  // The countdown's first number: 3 shows 3, 2, 1, 0, a second each, before the breath. 0: none.
  countdownFrom: number;
  // Its height on screen, in pixels; the width follows the words.
  shown: number;
  // The picture fades in over this long when it first shows. 0 or absent: it is there at once.
  fadeInMs?: number;
  // `reduced` draws no motion at all: two still orbs cross-fade, as for a person whose system
  // asks for less. `auto` (the default) moves the orb and leaves it to the system's setting.
  motion?: Motion;
  // Which theme the app has, for the words' colour; `auto` (the default) is a grey for either.
  theme?: Theme;
  // And fades out over `ms`, starting `inMs` after it first shows.
  fadeOut?: { inMs: number; ms: number };
};

// A word's opacity over one cycle, as keyframes. It is 1 in its own phase and 0 in the others,
// and across `CROSS` either side of a change it fades out as the next fades in.
function wordLevels(pattern: Pattern, index: number) {
  const total = cycleMs(pattern);
  const spans: Array<{ start: number; length: number }> = [];
  let at = 0;
  for (const phase of pattern.phases) {
    spans.push({ start: at, length: phase.ms });
    at += phase.ms;
  }
  const ramp = (x: number) => Math.min(1, Math.max(0, x / (2 * CROSS) + 0.5));
  const span = spans[index]!;
  const level = (t: number) => {
    const since = (((t - span.start) % total) + total) % total;
    const offset = since >= total - CROSS ? since - total : since; // the fade in just before the start counts
    return Math.min(ramp(offset), 1 - ramp(offset - span.length));
  };
  const marks = new Set<number>([0, total]);
  for (const s of spans) for (const edge of [s.start, s.start + s.length]) for (const d of [-CROSS, CROSS]) marks.add((((edge + d) % total) + total) % total);
  const times = [...marks].sort((a, b) => a - b);
  return {
    keyTimes: times.map((t) => num(t / total, 5)).join(";"),
    values: times.map((t) => num(level(t === total ? 0 : t), 3)).join(";"),
  };
}

// A still orb, for the one that does not move: the same layers as the breathing one, at one size.
function stillOrb(s: Scene, clipId: string, attrs = "", inner = "") {
  const at = (n: number) => num(MID + n * SCALE, 2);
  const circle = (x: number, y: number, r: number, a: string) => `<circle cx="${at(x)}" cy="${at(y)}" r="${len(r)}" ${a}/>`;
  return [
    `<g ${attrs}>${inner}`,
    circle(0, 0, s.halo.r, `fill="url(#halo)" opacity="${num(s.halo.opacity, 2)}"`),
    `<g filter="url(#soft)" opacity="${num(s.body.opacity, 2)}">`,
    circle(0, 0, s.body.r, `fill="url(#body)"`),
    `<clipPath id="${clipId}">${circle(0, 0, s.body.r, "")}</clipPath>`,
    `<g clip-path="url(#${clipId})">${s.blobs.map((b, i) => circle(b.x, b.y, b.r, `fill="url(#blob${i})"`)).join("")}</g>`,
    `</g>`,
    circle(0, 0, s.core.r, `fill="url(#core)"`),
    `</g>`,
  ].join("");
}

// The orb that breathes by itself, with the words beside it. SMIL animations inside the
// picture move it through the pattern, so the surface animates it smoothly and the band sends
// the same picture on every redraw instead of a new one per frame. It needs a surface that runs
// SMIL (the desktop's interactive Svg frame). On no ground at all: the picture is transparent,
// so the app's own background shows through (the halo is a faint glow on any theme).
//
// For a person who asks their system for less motion (or says so in the settings: `reduced`),
// the orb does not grow and shrink: two still orbs, a small and a large, fade into each other at
// the same pace.
export function breathingSvg(o: Picture): string {
  const { pattern, words, elapsedMs } = o;
  const total = cycleMs(pattern);
  const begin = num(-elapsedMs / 1000, 3); // when the first breath begins, in seconds from now
  // The lungs at each phase's end: full after breathing in and the hold that follows, empty
  // after breathing out and the hold after that.
  const points: Array<[number, number]> = [[0, 0]];
  let end = 0;
  for (const phase of pattern.phases) {
    end += phase.ms;
    points.push([end, phase.kind === "in" || phase.kind === "holdIn" ? 1 : 0]);
  }
  const timing =
    `keyTimes="${points.map(([ms]) => num(ms / total, 4)).join(";")}" calcMode="spline" ` +
    `keySplines="${points.slice(1).map(() => SPLINE).join(";")}" ` +
    `dur="${num(total / 1000, 3)}s" begin="${begin}s" repeatCount="indefinite"`;
  // What goes from its value with empty lungs to its value with full ones, and back.
  const values = (empty: number, full: number, digits: number) =>
    points.map(([, fill]) => num(empty + (full - empty) * fill, digits)).join(";");
  const breathe = (attribute: string, empty: number, full: number, digits = 2) =>
    `<animate attributeName="${attribute}" values="${values(empty, full, digits)}" ${timing}/>`;

  const rest = scene(0, 0);
  const open = scene(1, 0);
  const circle = (r: number, attrs: string, inner = "") => `<circle cx="${MID}" cy="${MID}" r="${len(r)}" ${attrs}>${inner}</circle>`;
  const radius = (empty: number, full: number) => breathe("r", len(empty), len(full));

  // Each blob circles the centre at its own pace, its orbit and size growing with the body.
  const angle = (b: (typeof BLOBS)[number]) => ((b.phase + (TAU * elapsedMs) / 1000 / b.period) * 180) / Math.PI;
  const blobs = BLOBS.map((b, i) => {
    const from = num(angle(b), 1);
    const to = num(from + (b.period > 0 ? 360 : -360), 1);
    return (
      `<g transform="rotate(${from})">` +
      `<animateTransform attributeName="transform" type="rotate" from="${from}" to="${to}" dur="${Math.abs(b.period)}s" repeatCount="indefinite"/>` +
      `<circle cx="${len(b.orbit)}" cy="0" r="${len(b.size)}" fill="url(#blob${i})"/></g>`
    );
  }).join("");

  const moving = [
    `<g class="move">`,
    `<defs><clipPath id="orb">${circle(rest.body.r, "", radius(rest.body.r, open.body.r))}</clipPath></defs>`,
    circle(
      rest.halo.r,
      `fill="url(#halo)" opacity="${num(rest.halo.opacity, 2)}"`,
      radius(rest.halo.r, open.halo.r) + breathe("opacity", rest.halo.opacity, open.halo.opacity),
    ),
    `<g filter="url(#soft)" opacity="${num(rest.body.opacity, 2)}">`,
    breathe("opacity", rest.body.opacity, open.body.opacity),
    circle(rest.body.r, `fill="url(#body)"`, radius(rest.body.r, open.body.r)),
    `<g clip-path="url(#orb)"><g transform="translate(${MID} ${MID})">`,
    `<g transform="scale(${num(rest.body.r, 3)})">`,
    `<animateTransform attributeName="transform" type="scale" values="${values(rest.body.r, open.body.r, 3)}" ${timing}/>`,
    blobs,
    `</g></g></g>`,
    `</g>`,
    circle(rest.core.r, `fill="url(#core)"`, radius(rest.core.r, open.core.r)),
    `</g>`,
  ].join("");

  const isReduced = o.motion === "reduced";
  const still = [
    // `display` is also an attribute here, so a surface that drops the style block still hides them.
    `<g class="still"${isReduced ? "" : ' display="none"'}>`,
    stillOrb(rest, "orb-rest"),
    stillOrb(open, "orb-open", `opacity="0"`, breathe("opacity", 0, 1)),
    `</g>`,
  ].join("");

  // The words: one for each phase, each lit in its own phase; and the countdown's numbers, each
  // lit for its second, ending as the first breath begins.
  const text = (content: string, animation: string) =>
    `<text x="${TEXT_X}" y="${num(MID + FONT * 0.35, 1)}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" ` +
    `font-size="${FONT}" font-weight="600" letter-spacing="-0.4" fill="${WORD_FILLS[o.theme ?? "auto"]}" opacity="0">${esc(content)}${animation}</text>`;
  const phaseWords = pattern.phases.map((phase, i) => {
    const { keyTimes, values: levels } = wordLevels(pattern, i);
    // Before the first breath an animation has not begun, so its word would sit at 0 and then jump
    // to the middle of the cross-fade. The first word rises to that point across the fade before it.
    const first = Number(levels.split(";")[0]);
    const leadIn =
      i === 0 && begin > 0
        ? `<animate attributeName="opacity" from="0" to="${first}" dur="${num(CROSS / 1000, 3)}s" begin="${num(begin - CROSS / 1000, 3)}s"/>`
        : "";
    return text(
      words[phase.kind],
      leadIn +
        `<animate attributeName="opacity" values="${levels}" keyTimes="${keyTimes}" dur="${num(total / 1000, 3)}s" begin="${begin}s" repeatCount="indefinite"/>`,
    );
  });
  const from = Math.max(0, Math.round(o.countdownFrom));
  const countdownWords: string[] = [];
  const countdownTexts: string[] = [];
  if (o.countdownFrom > 0) {
    const window = 1000 + 2 * CROSS;
    const fade = num((2 * CROSS) / window, 4);
    for (let n = from; n >= 0; n--) {
      const content = `${words.ready}  ${n}`;
      countdownTexts.push(content);
      countdownWords.push(
        text(
          content,
          `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;${fade};${num(1 - fade, 4)};1" dur="${num(window / 1000, 3)}s" ` +
            `begin="${num(-elapsedMs / 1000 - (n + 1) - CROSS / 1000, 3)}s"/>`,
        ),
      );
    }
  }
  const chars = Math.max(...pattern.phases.map((p) => words[p.kind].length), ...countdownTexts.map((t) => t.length));
  const width = TEXT_X + Math.ceil(chars * FONT * CHAR) + 8;
  const scale = o.shown / SIZE;

  const fadeIn = o.fadeInMs ? `<animate attributeName="opacity" from="0" to="1" dur="${num(o.fadeInMs / 1000, 3)}s" begin="0s" fill="freeze"/>` : "";
  const fadeOut = o.fadeOut
    ? `<animate attributeName="opacity" from="1" to="0" dur="${num(o.fadeOut.ms / 1000, 3)}s" begin="${num(o.fadeOut.inMs / 1000, 3)}s" fill="freeze"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${SIZE}" width="${num(width * scale, 1)}" height="${o.shown}">`,
    isReduced ? "" : `<style>@media (prefers-reduced-motion: reduce){.move{display:none}.still{display:inline}}</style>`,
    `<defs>${DEFS}</defs>`,
    `<g>${fadeOut}<g>${fadeIn}${isReduced ? "" : moving}${still}${phaseWords.join("")}${countdownWords.join("")}</g></g>`,
    `</svg>`,
  ].join("");
}

// ---- Colour ---------------------------------------------------------------------------

function rgb(hexColor: string): Rgb {
  const n = parseInt(hexColor.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(c: Rgb) {
  return `#${pack(c).toString(16).padStart(6, "0")}`;
}

function stops(list: Stop[]) {
  return list.map(([at, c, o]) => `<stop offset="${at}" stop-color="${hex(c)}" stop-opacity="${o}"/>`).join("");
}

function pack([r, g, b]: Rgb) {
  const byte = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
