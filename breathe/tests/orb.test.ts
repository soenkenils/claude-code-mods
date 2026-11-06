import { describe, expect, test } from "claude-code/testing";

import { breathingSvg, scene } from "../hooks/orb";
import type { Picture, Words } from "../hooks/orb";
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

const WORDS: Words = { ready: "Mach dich bereit", in: "Einatmen", holdIn: "Halten", out: "Ausatmen", holdOut: "Halten" };

const picture = (changes: Partial<Picture> = {}): Picture => ({
  pattern: box(4),
  words: WORDS,
  elapsedMs: 0,
  countdownFrom: 0,
  shown: 84,
  ...changes,
});

// The words in the picture, in the order drawn, with what animates each one's opacity.
type Word = { text: string; base: string | undefined; animations: string[] };
function wordsIn(svg: string): Word[] {
  return [...svg.matchAll(/<text ([^>]*)>([^<]*)((?:<animate [^>]*\/>)*)<\/text>/g)].map((m) => ({
    text: m[2] ?? "",
    base: /opacity="([^"]+)"/.exec(m[1] ?? "")?.[1],
    animations: [...(m[3] ?? "").matchAll(/<animate [^>]*\/>/g)].map((a) => a[0]),
  }));
}
const attribute = (tag: string | undefined, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag ?? "")?.[1];
const numbers = (list: string | undefined) => (list ?? "").split(";").map(Number);

describe("the desktop's svg", () => {
  const source = breathingSvg(picture());
  // The body's resting radius and the radii it breathes through.
  const body = (svg: string) => {
    const m = /<circle [^>]*r="([\d.]+)" fill="url\(#body\)"><animate attributeName="r" values="([^"]+)"/.exec(svg);
    return { rest: Number(m?.[1]), values: (m?.[2] ?? "").split(";").map(Number) };
  };

  test("is a sized svg document, as wide as its words need", () => {
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(source.endsWith("</svg>")).toBe(true);
    expect(source).toContain('height="84"');
    expect(source.length).toBeLessThan(131_072);
    const wide = (svg: string) => Number(/ width="([\d.]+)"/.exec(svg)?.[1]);
    const viewBox = (svg: string) => numbers(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)?.slice(1).join(";"));
    const [boxWidth, boxHeight] = viewBox(source);
    expect(boxHeight).toBe(160);
    // Its shape is the viewBox's, at the height asked for.
    close(wide(source) / 84, (boxWidth ?? 0) / 160, 0.01);
    // Longer words, a wider picture.
    const english = breathingSvg(picture({ words: { ready: "Get ready", in: "Breathe in", holdIn: "Hold", out: "Breathe out", holdOut: "Hold" } }));
    expect(wide(english)).toBeGreaterThan(wide(source));
    expect(wide(breathingSvg(picture({ shown: 168 })))).toBeGreaterThan(wide(source) * 1.9);
  });

  test("draws no script and nothing it links to", () => {
    expect(source).not.toMatch(/<script|<image|href=|onload=|onbegin=|onend=/i);
  });

  test("defines everything it uses, and uses every gradient it defines", () => {
    const gradients = [...source.matchAll(/<(?:radial|linear)Gradient id="([\w-]+)"/g)].map((m) => m[1]);
    const defined = [...source.matchAll(/ id="([\w-]+)"/g)].map((m) => m[1]);
    const used = [...source.matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1]);
    for (const id of used) expect(defined).toContain(id);
    for (const id of gradients) expect(used).toContain(id);
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
    const calm = breathingSvg(picture({ pattern: patternOf("calm", 4) }));
    expect(calm).toContain('keyTimes="0;0.4;1"');
    expect(calm).toContain('dur="10s"');
    expect(body(calm).values).toEqual([20, 50, 20]);
  });

  test("gives every animation as many values as key times, and a spline between each", () => {
    for (const pattern of [box(4), patternOf("even", 3), patternOf("calm", 5)]) {
      const svg = breathingSvg(picture({ pattern, countdownFrom: 3, elapsedMs: -4000 }));
      const found = [...svg.matchAll(/values="([^"]+)" keyTimes="([^"]+)"(?: calcMode="spline" keySplines="([^"]+)")?/g)];
      expect(found.length).toBeGreaterThan(0);
      for (const [, values, times, splines] of found) {
        expect((values ?? "").split(";").length).toBe((times ?? "").split(";").length);
        if (splines !== undefined) expect(splines.split(";").length).toBe((times ?? "").split(";").length - 1);
      }
    }
  });

  test("starts the breath where it is when first drawn, and waits through a countdown", () => {
    const begins = (svg: string) => /dur="16s" begin="([^"]+)" repeatCount/.exec(svg)?.[1];
    expect(begins(breathingSvg(picture({ elapsedMs: 5000 })))).toBe("-5s");
    expect(begins(breathingSvg(picture({ elapsedMs: -4000 })))).toBe("4s");
  });

  test("has no ground of its own, so the app's background shows through", () => {
    expect(source).not.toMatch(/<rect|id="sky"/);
  });

  test("draws only the orb's own circles, no stars", () => {
    // The breathing orb: the halo, the body, four blobs, the core and the clip path's copy of the
    // body. And two still orbs of the same layers, for a person who wants less motion.
    expect(source.match(/<circle /g)).toHaveLength(8 + 8 + 8);
  });
});

describe("the words in the svg", () => {
  test("are one for each phase, and none shows until its animation lights it", () => {
    const list = wordsIn(breathingSvg(picture()));
    expect(list.map((w) => w.text)).toEqual(["Einatmen", "Halten", "Ausatmen", "Halten"]);
    for (const word of list) {
      expect(word.base).toBe("0");
      expect(word.animations.length).toBeGreaterThan(0);
    }
  });

  test("light up in their own phase and are out in the others", () => {
    const list = wordsIn(breathingSvg(picture()));
    const level = (word: Word, share: number) => {
      const tag = word.animations.find((a) => a.includes("keyTimes="));
      const times = numbers(attribute(tag, "keyTimes"));
      const values = numbers(attribute(tag, "values"));
      const at = times.findIndex((t) => t >= share);
      const [t0, t1] = [times[at - 1] ?? 0, times[at] ?? 1];
      const [v0, v1] = [values[at - 1] ?? 0, values[at] ?? 0];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (share - t0)) / (t1 - t0);
    };
    // The middle of each of the four phases of a 16 s cycle.
    const middles = [0.125, 0.375, 0.625, 0.875];
    list.forEach((word, i) => {
      middles.forEach((share, j) => close(level(word, share), i === j ? 1 : 0, 1e-3));
    });
  });

  test("cross-fade: wherever one fades out, the next fades in, and the levels add up to 1", () => {
    for (const pattern of [box(4), patternOf("even", 4), patternOf("calm", 4)]) {
      const list = wordsIn(breathingSvg(picture({ pattern })));
      const rows = list.map((w) => numbers(attribute(w.animations.find((a) => a.includes("keyTimes=")), "values")));
      const size = rows[0]?.length ?? 0;
      expect(size).toBeGreaterThan(pattern.phases.length);
      for (let k = 0; k < size; k++) {
        const sum = rows.reduce((total, row) => total + (row[k] ?? NaN), 0);
        close(sum, 1, 1e-2);
      }
      // A cycle ends as it began, so the repeat has no jump.
      for (const row of rows) expect(row[0]).toBe(row[size - 1]);
    }
  });

  test("use the pattern's own words", () => {
    const calm = wordsIn(breathingSvg(picture({ pattern: patternOf("calm", 4), words: { ...WORDS, in: "Breathe in", out: "Breathe out" } })));
    expect(calm.map((w) => w.text)).toEqual(["Breathe in", "Breathe out"]);
  });

  test("are escaped, so a label cannot break the picture", () => {
    const svg = breathingSvg(picture({ words: { ...WORDS, in: "A & <B>" } }));
    expect(svg).toContain(">A &amp; &lt;B><");
    expect(svg).not.toContain("<B>");
  });

  test("are in a sans-serif font and a grey that reads on a dark ground and on a light one", () => {
    const svg = breathingSvg(picture());
    expect(svg).toContain('font-family="system-ui');
    expect(svg).toContain('fill="#8A8985"');
    expect(svg).not.toContain("currentColor");
  });
});

describe("the countdown in the svg", () => {
  const FOUR = -4000; // a countdown from 3 takes 4 s: 3, 2, 1, 0 and then the first breath
  const counted = (svg: string) => wordsIn(svg).filter((w) => w.text.startsWith(WORDS.ready));
  const starts = (svg: string) => counted(svg).map((w) => Number(attribute(w.animations[0], "begin")?.replace("s", "")));

  test("has a number for each second, from 3 down to 0", () => {
    const svg = breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR }));
    expect(counted(svg).map((w) => w.text.replace(/\s+/g, " "))).toEqual(["Mach dich bereit 3", "Mach dich bereit 2", "Mach dich bereit 1", "Mach dich bereit 0"]);
    for (const word of counted(svg)) expect(word.base).toBe("0");
  });

  test("lights each number for its second, the cross-fade centred on the second's edges", () => {
    const svg = breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR }));
    // 3 shows from 0 to 1 s, 2 from 1 to 2 s, 1 from 2 to 3 s, 0 from 3 to 4 s, each from 0.15 s before.
    expect(starts(svg)).toEqual([-0.15, 0.85, 1.85, 2.85]);
    const first = counted(svg)[0]?.animations[0];
    expect(attribute(first, "dur")).toBe("1.3s");
    expect(attribute(first, "values")).toBe("0;1;1;0");
    // The window is 0.3 s of fade, 1 s of full, 0.3 s of fade, so the full part sits inside the second.
    expect(numbers(attribute(first, "keyTimes")).map((t) => Math.round(t * 1300))).toEqual([0, 300, 1000, 1300]);
  });

  test("ends with the 0 as the first breath begins", () => {
    const svg = breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR }));
    const last = starts(svg).at(-1) ?? NaN;
    close(last + 1.3 - 0.15, 4, 1e-6); // the window less its closing fade is the breath's start
    expect(/dur="16s" begin="4s"/.test(svg)).toBe(true);
  });

  test("has the first word rise to its cross-fade level before the breath begins, so there is no dip", () => {
    const svg = breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR }));
    const first = wordsIn(svg).find((w) => w.text === "Einatmen");
    const lead = first?.animations[0];
    expect(attribute(lead, "from")).toBe("0");
    expect(attribute(lead, "to")).toBe("0.5");
    expect(attribute(lead, "dur")).toBe("0.15s");
    expect(attribute(lead, "begin")).toBe("3.85s");
    // Only the first word, and only while the breath is still to come.
    expect(wordsIn(svg).filter((w) => w.animations.some((a) => a.includes('from="0"'))).map((w) => w.text)).toEqual(["Einatmen"]);
    expect(wordsIn(breathingSvg(picture({ elapsedMs: 1000 })))[0]?.animations).toHaveLength(1);
  });

  test("follows the countdown that is under way when the picture is first drawn", () => {
    // Drawn 1.5 s into it: the 3 and 2 are past, the 1 has 0.5 s left.
    const svg = breathingSvg(picture({ countdownFrom: 3, elapsedMs: -2500 }));
    expect(starts(svg)).toEqual([-1.65, -0.65, 0.35, 1.35]);
    expect(/dur="16s" begin="2.5s"/.test(svg)).toBe(true);
  });

  test("is left out with countdownFrom 0", () => {
    const svg = breathingSvg(picture({ countdownFrom: 0 }));
    expect(svg).not.toContain(WORDS.ready);
    expect(wordsIn(svg)).toHaveLength(4);
  });

  test("makes room for a label longer than the breath's words", () => {
    const wide = (svg: string) => Number(/ width="([\d.]+)"/.exec(svg)?.[1]);
    const long = { ...WORDS, ready: "Mach dich bereit für eine ganz ruhige Runde" };
    expect(wide(breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR, words: long })))).toBeGreaterThan(wide(breathingSvg(picture({ countdownFrom: 3, elapsedMs: FOUR }))));
  });
});

describe("the fades in the svg", () => {
  const fades = (svg: string) => [...svg.matchAll(/<animate [^>]*fill="freeze"[^>]*\/>/g)].map((m) => m[0]);

  test("has none unless asked", () => {
    expect(fades(breathingSvg(picture()))).toEqual([]);
  });

  test("fades in over the time asked, from the moment it is drawn", () => {
    const [fade, ...rest] = fades(breathingSvg(picture({ fadeInMs: 800 })));
    expect(rest).toEqual([]);
    expect(attribute(fade, "from")).toBe("0");
    expect(attribute(fade, "to")).toBe("1");
    expect(attribute(fade, "dur")).toBe("0.8s");
    expect(attribute(fade, "begin")).toBe("0s");
  });

  test("fades out after the time given, and stays out", () => {
    const [fade, ...rest] = fades(breathingSvg(picture({ fadeOut: { inMs: 2500, ms: 800 } })));
    expect(rest).toEqual([]);
    expect(attribute(fade, "attributeName")).toBe("opacity");
    expect(attribute(fade, "from")).toBe("1");
    expect(attribute(fade, "to")).toBe("0");
    expect(attribute(fade, "dur")).toBe("0.8s");
    expect(attribute(fade, "begin")).toBe("2.5s");
  });

  test("keeps the two apart: the fade out is on the outer group, so it does not fight the fade in", () => {
    const svg = breathingSvg(picture({ fadeInMs: 800, fadeOut: { inMs: 2500, ms: 800 } }));
    const [out, into] = fades(svg);
    expect(attribute(out, "from")).toBe("1");
    expect(attribute(into, "from")).toBe("0");
    expect(svg.indexOf(out ?? "")).toBeLessThan(svg.indexOf(into ?? ""));
    // Each in a group of its own.
    expect(svg).toMatch(/<g><animate [^>]*to="0"[^>]*\/><g><animate [^>]*to="1"[^>]*\/>/);
  });
});

describe("for a person who wants less motion", () => {
  const svg = breathingSvg(picture());

  test("asks the surface to hide the breathing orb and show two still ones", () => {
    expect(svg).toContain("@media (prefers-reduced-motion: reduce)");
    expect(svg).toContain(".move{display:none}");
    expect(svg).toContain(".still{display:inline}");
    expect(svg).toContain('<g class="move">');
  });

  test("hides the still orbs by attribute too, for a surface that drops the style block", () => {
    expect(svg).toContain('<g class="still" display="none">');
  });

  test("makes the two still orbs fade into each other, at the pace of the breath", () => {
    const still = svg.slice(svg.indexOf('<g class="still"'));
    expect(still).toContain('id="orb-rest"');
    expect(still).toContain('id="orb-open"');
    // The open one is invisible until its opacity animation, which follows the breath's key times.
    expect(still).toMatch(/<g opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.25;0.5;0.75;1"/);
  });

  test("keeps the words, which only fade", () => {
    expect(wordsIn(svg)).toHaveLength(4);
    // The words are outside the groups that the style hides.
    expect(svg.indexOf("<text ")).toBeGreaterThan(svg.indexOf('class="still"'));
  });
});
