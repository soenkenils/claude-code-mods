import { describe, expect, test } from "claude-code/testing";

import { EXTENT, WORD_FILLS, breathingSvg, pictureSize, scene } from "../hooks/orb";
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
  shown: 24,
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

  const wide = (svg: string) => Number(/ width="([\d.]+)"/.exec(svg)?.[1]);
  const viewBox = (svg: string) => numbers(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)?.slice(1).join(";"));

  test("is a sized svg document, as wide as its words need", () => {
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(source.endsWith("</svg>")).toBe(true);
    expect(source).toContain('height="24"');
    expect(source.length).toBeLessThan(131_072);
    // A unit of the picture is a pixel: the viewBox is its size.
    expect(viewBox(source)).toEqual([wide(source), 24]);
    // Longer words, a wider picture.
    const english = breathingSvg(picture({ words: { ready: "Get ready", in: "Breathe in", holdIn: "Hold", out: "Breathe out", holdOut: "Hold" } }));
    expect(wide(english)).toBeGreaterThan(wide(source));
    expect(wide(breathingSvg(picture({ shown: 48 })))).toBeGreaterThan(wide(source) * 1.9);
  });

  test("is one line high: far wider than high, the words at the size of the app's own text", () => {
    expect(wide(source) / 24).toBeGreaterThan(4);
    const sizes = [...source.matchAll(/<text [^>]*font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBe(4);
    for (const size of sizes) expect(size).toBe(14);
    // They start to the right of the orb's square, and sit on the middle line.
    for (const [, x, y] of source.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) {
      expect(Number(x)).toBeGreaterThan(24);
      close(Number(y), 12 + 14 * 0.35, 0.01);
    }
  });

  test("says its size, the same as the document's", () => {
    for (const changes of [{}, { shown: 32 }, { countdownFrom: 3, elapsedMs: -4000 }, { pattern: patternOf("calm", 4) }]) {
      const o = picture(changes);
      const svg = breathingSvg(o);
      expect(pictureSize(o)).toEqual({ width: wide(svg), height: o.shown });
      expect(svg).toContain(`height="${o.shown}"`);
    }
  });

  test("draws the orb in a square as high as the picture", () => {
    // The orb's own drawing is 160 units square, scaled to the height.
    expect(source).toContain('<g transform="scale(0.15)">');
    expect(breathingSvg(picture({ shown: 32 }))).toContain('<g transform="scale(0.2)">');
  });

  test("keeps the glow inside the square, so it is not cut off at the band's edge", () => {
    const unit = 80 / EXTENT; // the body's largest radius, in the orb's units
    const halo = /<circle [^>]*r="([\d.]+)" fill="url\(#halo\)"[^>]*><animate attributeName="r" values="([^"]+)"/.exec(source);
    const radii = [Number(halo?.[1]), ...numbers(halo?.[2])];
    expect(radii.length).toBeGreaterThan(1);
    // The halo's gradient is out at 0.74 of its radius.
    for (const r of radii) expect(r * 0.74).toBeLessThan(80 + 0.01);
    close(Math.max(...radii) * 0.74, 80, 0.05);
    // And the body at its largest leaves a rim for it.
    expect(Math.max(...body(source).values)).toBe(unit);
    expect(unit).toBeLessThan(80);
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
    close(rest, 0.4 * 64, 0.01);
    // Box breathing: empty, full after breathing in, full after the hold, empty, empty.
    expect(values).toEqual([25.6, 64, 64, 25.6, 25.6]);
  });

  test("keeps step with the pattern: a key time at the end of each phase", () => {
    expect(source).toContain('keyTimes="0;0.25;0.5;0.75;1"');
    expect(source).toContain('dur="16s"');
    const calm = breathingSvg(picture({ pattern: patternOf("calm", 4) }));
    expect(calm).toContain('keyTimes="0;0.4;1"');
    expect(calm).toContain('dur="10s"');
    expect(body(calm).values).toEqual([25.6, 64, 25.6]);
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

describe("motion and theme", () => {
  test("reduced motion draws the two still orbs and no moving one", () => {
    const svg = breathingSvg(picture({ motion: "reduced" }));
    expect(svg).not.toContain('class="move"');
    expect(svg).not.toContain("<animateTransform");
    expect(svg).not.toContain("<style>");
    expect(svg).toContain('<g class="still">');
    expect(svg).not.toContain("display=\"none\"");
    // The two orbs, drawn one over the other, the open one fading in with the breath.
    expect(svg).toContain('id="orb-rest"');
    expect(svg).toMatch(/<g opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.25;0.5;0.75;1"/);
    expect(svg.match(/<circle /g)).toHaveLength(8 + 8); // two orbs of the same eight circles each
    expect(svg.length).toBeLessThan(breathingSvg(picture()).length);
  });

  test("reduced motion keeps the words, the countdown and the fades", () => {
    const svg = breathingSvg(picture({ motion: "reduced", countdownFrom: 3, elapsedMs: -4000, fadeInMs: 800, fadeOut: { inMs: 5000, ms: 800 } }));
    expect(wordsIn(svg).map((w) => w.text.replace(/\s+/g, " "))).toEqual([
      "Einatmen", "Halten", "Ausatmen", "Halten", "Mach dich bereit 3", "Mach dich bereit 2", "Mach dich bereit 1", "Mach dich bereit 0",
    ]);
    expect(svg.match(/fill="freeze"/g)).toHaveLength(2);
  });

  test("auto leaves it to the system: the moving orb, and the still ones hidden", () => {
    for (const motion of [undefined, "auto" as const]) {
      const svg = breathingSvg(picture(motion ? { motion } : {}));
      expect(svg).toContain('class="move"');
      expect(svg).toContain('class="still" display="none"');
      expect(svg).toContain("prefers-reduced-motion");
    }
  });

  // WCAG's contrast ratio of two colors.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  const DARK_GROUND = "#262624";
  const LIGHT_GROUND = "#FAF9F5";

  test("a theme gives the words a color that reads on its ground", () => {
    expect(contrast(WORD_FILLS.dark, DARK_GROUND)).toBeGreaterThan(7);
    expect(contrast(WORD_FILLS.light, LIGHT_GROUND)).toBeGreaterThan(7);
    expect(breathingSvg(picture({ theme: "dark" }))).toContain(`fill="${WORD_FILLS.dark}"`);
    expect(breathingSvg(picture({ theme: "light" }))).toContain(`fill="${WORD_FILLS.light}"`);
  });

  test("auto is a grey that reads, if dimly, on either", () => {
    expect(contrast(WORD_FILLS.auto, DARK_GROUND)).toBeGreaterThan(4);
    expect(contrast(WORD_FILLS.auto, LIGHT_GROUND)).toBeGreaterThan(3);
    expect(breathingSvg(picture())).toContain(`fill="${WORD_FILLS.auto}"`);
  });
});
