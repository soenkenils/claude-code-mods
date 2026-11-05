import { describe, expect, test } from "claude-code/testing";

import { scene, svg } from "../hooks/orb";

// The kit has no toBeCloseTo.
const close = (actual: number | undefined, expected: number, within = 1e-6) => expect(Math.abs((actual ?? NaN) - expected)).toBeLessThan(within);

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

  test("the blobs drift with time", () => {
    const a = scene(0.5, 0);
    const b = scene(0.5, 7);
    expect(Math.abs((b.blobs[0]?.x ?? 0) - (a.blobs[0]?.x ?? 0))).toBeGreaterThan(0.01);
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

  test("has no ground of its own, so the app's background shows through", () => {
    const source = svg(scene(0.5, 0), 112);
    expect(source).not.toMatch(/<rect|id="sky"/);
  });

  test("draws only the orb's own circles, no stars", () => {
    // The halo, the body, four blobs, the core, and the clip path's copy of the body.
    expect(svg(scene(0.5, 0), 112).match(/<circle /g)).toHaveLength(8);
  });
});
