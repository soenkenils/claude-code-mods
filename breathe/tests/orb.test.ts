import { describe, expect, test } from "claude-code/testing";

import { breathingSvg, scene } from "../hooks/orb";
import { box, patternOf } from "../hooks/pacer";

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
  const source = breathingSvg(box(4), 0, 112);
  // The body's resting radius and the radii it breathes through.
  const body = (svg: string) => {
    const m = /<circle [^>]*r="([\d.]+)" fill="url\(#body\)"><animate attributeName="r" values="([^"]+)"/.exec(svg);
    return { rest: Number(m?.[1]), values: (m?.[2] ?? "").split(";").map(Number) };
  };

  test("is a sized svg document", () => {
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(source.endsWith("</svg>")).toBe(true);
    expect(source).toContain('width="112" height="112"');
    expect(source.length).toBeLessThan(131_072);
  });

  test("draws no script and nothing it links to", () => {
    expect(source).not.toMatch(/<script|<image|href=|onload=|onbegin=|onend=/i);
  });

  test("uses every gradient it defines, and defines every gradient it uses", () => {
    const defined = [...source.matchAll(/<(?:radial|linear)Gradient id="(\w+)"/g)].map((m) => m[1]);
    const used = [...source.matchAll(/url\(#(\w+)\)/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual([...new Set(used)].filter((id) => defined.includes(id)).sort());
    for (const id of used) expect([...defined, "soft", "orb"]).toContain(id);
  });

  test("rests small and grows the orb as the lungs fill", () => {
    const { rest, values } = body(source);
    close(rest, 0.4 * 50, 0.01);
    // Box breathing: empty, full after breathing in, full after the hold, empty, empty.
    expect(values).toEqual([20, 50, 50, 20, 20]);
  });

  test("keeps step with the pattern: a key time at the end of each phase", () => {
    expect(source).toContain('keyTimes="0;0.25;0.5;0.75;1"');
    expect(source).toContain('dur="16s"');
    const calm = breathingSvg(patternOf("calm", 4), 0, 112);
    expect(calm).toContain('keyTimes="0;0.4;1"');
    expect(calm).toContain('dur="10s"');
    expect(body(calm).values).toEqual([20, 50, 20]);
  });

  test("gives every animation as many values as key times, and a spline between each", () => {
    for (const svg of [source, breathingSvg(patternOf("even", 3), 0, 112), breathingSvg(patternOf("calm", 5), 0, 112)]) {
      const found = [...svg.matchAll(/values="([^"]+)" keyTimes="([^"]+)" calcMode="spline" keySplines="([^"]+)"/g)];
      expect(found.length).toBeGreaterThan(0);
      for (const [, values, times, splines] of found) {
        expect((values ?? "").split(";").length).toBe((times ?? "").split(";").length);
        expect((splines ?? "").split(";").length).toBe((times ?? "").split(";").length - 1);
      }
    }
  });

  test("starts the breath where it is when first drawn, and waits through a countdown", () => {
    expect(breathingSvg(box(4), 5000, 112)).toContain('begin="-5s"');
    expect(breathingSvg(box(4), -4000, 112)).toContain('begin="4s"');
  });

  test("has no ground of its own, so the app's background shows through", () => {
    expect(source).not.toMatch(/<rect|id="sky"/);
  });

  test("draws only the orb's own circles, no stars", () => {
    // The halo, the body, four blobs, the core, and the clip path's copy of the body.
    expect(source.match(/<circle /g)).toHaveLength(8);
  });
});
