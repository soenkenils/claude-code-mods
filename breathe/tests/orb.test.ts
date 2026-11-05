import { describe, expect, test } from "claude-code/testing";

import { EXTENT, cells, pixels, scene, svg } from "../hooks/orb";

const SIZE = 16;

// The kit has no toBeCloseTo.
const close = (actual: number | undefined, expected: number, within = 1e-6) => expect(Math.abs((actual ?? NaN) - expected)).toBeLessThan(within);

function decode(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new DataView(bytes.buffer);
}

const channels = (color: number) => [(color >> 16) & 255, (color >> 8) & 255, color & 255] as const;
const brightness = (color: number) => channels(color).reduce((sum, c) => sum + c, 0);
const at = (grid: number[], x: number, y: number) => grid[y * SIZE + x] ?? -1;

describe("the scene", () => {
  test("the orb grows and brightens as the lungs fill", () => {
    const empty = scene(0, 0);
    const full = scene(1, 0);
    close(empty.body.r, 0.4);
    close(full.body.r, 1);
    close(empty.halo.opacity, 0.45);
    close(full.halo.opacity, 1);
    close(full.halo.r / empty.halo.r, 1.25 / 0.55);
    close(full.core.r / empty.core.r, 1.15 / 0.5);
  });

  test("the blobs drift and the stars twinkle with time", () => {
    const a = scene(0.5, 0);
    const b = scene(0.5, 7);
    expect(Math.abs((b.blobs[0]?.x ?? 0) - (a.blobs[0]?.x ?? 0))).toBeGreaterThan(0.01);
    expect(Math.abs((b.stars[0]?.opacity ?? 0) - (a.stars[0]?.opacity ?? 0))).toBeGreaterThan(0.01);
    for (const { opacity } of [...a.stars, ...b.stars]) {
      expect(opacity).toBeGreaterThanOrEqual(0.15 - 1e-9);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  test("keeps every star inside the picture", () => {
    for (const { star } of scene(0, 0).stars) {
      expect(Math.abs(star.x)).toBeLessThanOrEqual(EXTENT);
      expect(Math.abs(star.y)).toBeLessThanOrEqual(EXTENT);
    }
  });
});

describe("the terminal's pixels", () => {
  test("are one colour for each", () => {
    const grid = pixels(scene(0.5, 0), SIZE, SIZE);
    expect(grid).toHaveLength(SIZE * SIZE);
    for (const color of grid) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  test("are dark at the edge and bright where the orb is", () => {
    const grid = pixels(scene(1, 0), SIZE, SIZE);
    expect(brightness(at(grid, 0, 0))).toBeLessThan(150);
    expect(brightness(at(grid, 8, 8))).toBeGreaterThan(brightness(at(grid, 0, 0)) + 200);
  });

  test("cover more of the picture with a full orb than an empty one", () => {
    const lit = (fill: number) => {
      const grid = pixels(scene(fill, 0), SIZE, SIZE);
      const sky = pixels({ ...scene(fill, 0), halo: { r: 0.001, opacity: 0 }, body: { r: 0.001, opacity: 0 }, core: { r: 0.001 }, blobs: [] }, SIZE, SIZE);
      return grid.filter((color, i) => brightness(color) > brightness(sky[i] ?? 0) + 60).length;
    };
    expect(lit(1)).toBeGreaterThan(lit(0) * 2);
  });

  test("are the same for the same moment", () => {
    expect(pixels(scene(0.3, 4.2), SIZE, SIZE)).toEqual(pixels(scene(0.3, 4.2), SIZE, SIZE));
  });
});

describe("the terminal's cells", () => {
  test("are one upper half block each, with the pixel above in front and the pixel below behind", () => {
    const grid = pixels(scene(0.6, 1), SIZE, SIZE);
    const columns = SIZE;
    const rows = SIZE / 2;
    const view = decode(cells(grid, columns, rows));
    expect(view.byteLength).toBe(columns * rows * 12);
    for (const [row, col] of [[0, 0], [3, 5], [7, 15]] as const) {
      const at = (row * columns + col) * 12;
      expect(view.getUint32(at, true)).toBe(0x2580);
      expect(view.getUint32(at + 4, true)).toBe(grid[2 * row * columns + col]);
      expect(view.getUint32(at + 8, true)).toBe(grid[(2 * row + 1) * columns + col]);
    }
  });

  test("stay within the colours a terminal's raster paints at once", () => {
    const grid = pixels(scene(1, 0), SIZE, SIZE);
    const view = decode(cells(grid, SIZE, SIZE / 2));
    const pairs = new Set<string>();
    for (let at = 0; at < view.byteLength; at += 12) pairs.add(`${view.getUint32(at + 4, true)}:${view.getUint32(at + 8, true)}`);
    expect(pairs.size).toBeLessThanOrEqual(1024);
  });
});

describe("the desktop's svg", () => {
  const body = (source: string) => Number(/<circle [^>]*r="([\d.]+)" fill="url\(#body\)"/.exec(source)?.[1]);

  test("is a sized svg document", () => {
    const source = svg(scene(0.5, 3), 112);
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(source.endsWith("</svg>")).toBe(true);
    expect(source).toContain('width="112" height="112"');
    expect(source.length).toBeLessThan(131_072);
  });

  test("draws no script and nothing it links to", () => {
    const source = svg(scene(0.5, 3), 112);
    expect(source).not.toMatch(/<script|<image|href=|onload=/i);
  });

  test("uses every gradient it defines, and defines every gradient it uses", () => {
    const source = svg(scene(0.5, 3), 112);
    const defined = [...source.matchAll(/<(?:radial|linear)Gradient id="(\w+)"/g)].map((m) => m[1]);
    const used = [...source.matchAll(/url\(#(\w+)\)/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual([...new Set(used)].filter((id) => defined.includes(id)).sort());
    for (const id of used) expect([...defined, "soft", "orb"]).toContain(id);
  });

  test("grows the orb as the lungs fill", () => {
    const small = body(svg(scene(0, 0), 112));
    const large = body(svg(scene(1, 0), 112));
    close(small, 0.4 * 50, 0.1);
    close(large, 50, 0.1);
  });

  test("draws a star for each star in the sky", () => {
    expect(svg(scene(0.5, 0), 112).match(/<circle [^>]*fill="#[0-9a-f]{6}" opacity=/g)).toHaveLength(14);
  });
});
