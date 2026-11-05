// The orb from the design (an aurora ball with a halo), drawn two ways from one description
// of the scene: as a grid of half-block cells for the terminal, which gets the design's dark
// ground (a cell cannot be transparent), and as an SVG for Claude Desktop, which gets none.
// Pure, so it is tested and can be rendered to a picture.
//
// Everything is measured in units of the orb's largest radius, with the origin at its
// centre and y pointing down. The sizes and opacities follow the design's keyframes:
// the halo goes .55 to 1.25 times its size, the body .4 to 1, the core .5 to 1.15.

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
// The terminal's ground: a cell cannot be see-through, and the orb is made for a dark one.
const SKY: Stop[] = [[0, rgb("#30302E"), 1], [0.4, rgb("#1F1E1D"), 1], [0.75, rgb("#141413"), 1]];
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

const SOFT = 0.13; // How far the body's edge fades, as the design's blur does.
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

// ---- Terminal -------------------------------------------------------------------------

// One colour per pixel as 0xRRGGBB, `width` by `height`, row by row. The scene is fitted to
// the smaller side, and a pixel is taken to be square.
export function pixels(s: Scene, width: number, height: number): number[] {
  const unit = Math.min(width, height) / (2 * EXTENT);
  const sky = Math.hypot(width * 0.5, height * 0.58);
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ux = (x + 0.5 - width / 2) / unit;
      const uy = (y + 0.5 - height / 2) / unit;
      const dist = Math.hypot(ux, uy);

      let [r, g, b] = ramp(SKY, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height * 0.42) / sky).color;

      const halo = ramp(HALO, dist / s.halo.r);
      [r, g, b] = over([r, g, b], halo.color, halo.opacity * s.halo.opacity);

      const coverage = clamp((s.body.r - dist) / SOFT + 0.5);
      if (coverage > 0) {
        const down = clamp((uy + s.body.r) / (2 * s.body.r));
        const body = ramp(BODY, down);
        let color = body.color;
        for (const [i, blob] of s.blobs.entries()) {
          const lamp = ramp(BLOB_RAMPS[i]!, Math.hypot(ux - blob.x, uy - blob.y) / blob.r);
          color = screen(color, lamp.color, lamp.opacity);
        }
        [r, g, b] = over([r, g, b], color, body.opacity * coverage * s.body.opacity);
      }

      const core = ramp(CORE, dist / s.core.r);
      [r, g, b] = over([r, g, b], core.color, core.opacity);
      out.push(pack([r, g, b]));
    }
  }
  return out;
}

// The grid for a terminal `Raster`: each cell is an upper half block whose foreground is the
// pixel above and background the pixel below, so a cell holds two square pixels. `pixels` is
// `columns` wide and `2 * rows` tall.
export function cells(pixels: number[], columns: number, rows: number): string {
  const bytes = new Uint8Array(columns * rows * 12);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      view.setUint32(at, 0x2580, true);
      view.setUint32(at + 4, pixels[2 * row * columns + col] ?? 0, true);
      view.setUint32(at + 8, pixels[(2 * row + 1) * columns + col] ?? 0, true);
      at += 12;
    }
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

// The orb on no ground at all: the picture is transparent, so the app's own background shows
// through (the halo is a faint glow on any theme). `shown` is its size on screen, in pixels.
export function svg(s: Scene, shown: number): string {
  const at = (n: number) => +(MID + n * SCALE).toFixed(1);
  const len = (n: number) => +(n * SCALE).toFixed(1);
  const circle = (x: number, y: number, r: number, attrs: string) => `<circle cx="${at(x)}" cy="${at(y)}" r="${len(r)}" ${attrs}/>`;

  const blobs = s.blobs.map((b, i) => circle(b.x, b.y, b.r, `fill="url(#blob${i})"`));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${shown}" height="${shown}">`,
    `<defs>${DEFS}<clipPath id="orb">${circle(0, 0, s.body.r, "")}</clipPath></defs>`,
    circle(0, 0, s.halo.r, `fill="url(#halo)" opacity="${+s.halo.opacity.toFixed(2)}"`),
    `<g filter="url(#soft)" opacity="${+s.body.opacity.toFixed(2)}">`,
    circle(0, 0, s.body.r, `fill="url(#body)"`),
    `<g clip-path="url(#orb)">${blobs.join("")}</g>`,
    `</g>`,
    circle(0, 0, s.core.r, `fill="url(#core)"`),
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

function clamp(n: number) {
  return Math.min(1, Math.max(0, n));
}

function pack([r, g, b]: Rgb) {
  const byte = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

// The colour and opacity of a gradient at `at`; before the first stop and past the last
// it holds the end stop's.
function ramp(list: Stop[], at: number): { color: Rgb; opacity: number } {
  const first = list[0]!;
  const last = list[list.length - 1]!;
  if (at <= first[0]) return { color: first[1], opacity: first[2] };
  if (at >= last[0]) return { color: last[1], opacity: last[2] };
  for (let i = 1; i < list.length; i++) {
    const [to, toColor, toOpacity] = list[i]!;
    const [from, fromColor, fromOpacity] = list[i - 1]!;
    if (at <= to) {
      const t = (at - from) / (to - from);
      return {
        color: [
          fromColor[0] + (toColor[0] - fromColor[0]) * t,
          fromColor[1] + (toColor[1] - fromColor[1]) * t,
          fromColor[2] + (toColor[2] - fromColor[2]) * t,
        ],
        opacity: fromOpacity + (toOpacity - fromOpacity) * t,
      };
    }
  }
  return { color: last[1], opacity: last[2] };
}

// `top` laid over `under` at `opacity`.
function over(under: Rgb, top: Rgb, opacity: number): Rgb {
  const a = clamp(opacity);
  return [under[0] + (top[0] - under[0]) * a, under[1] + (top[1] - under[1]) * a, under[2] + (top[2] - under[2]) * a];
}

// Screen blending: light colours add up without ever passing white.
function screen(under: Rgb, top: Rgb, opacity: number): Rgb {
  const a = clamp(opacity);
  const one = (u: number, t: number) => 255 - ((255 - u) * (255 - t * a)) / 255;
  return [one(under[0], top[0]), one(under[1], top[1]), one(under[2], top[2])];
}
