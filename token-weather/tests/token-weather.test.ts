import type { On } from "claude-code";
import { describe, expect, test, type Engine } from "claude-code/testing";

const WINDOW = 200_000;
const SURFACES = ["terminal", "desktop"] as const;
type Surface = (typeof SURFACES)[number];

// The terminal's weather is one-cell glyphs; the desktop's is emoji.
const HEAD = {
  terminal: { clear: "☀  Clear", showers: "☂  Showers", icon: /^[☀☁☂☇↯]  / },
  desktop: { clear: "☀️ Clear", showers: "🌧️ Showers", icon: /^(☀️|☁️|🌧️|⛈️|🌪️) / },
} as const;

// What sits beneath the plugin in a session: core answers both events.
function core(on: On) {
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("ui.render", { component: "AbovePrompt" }, () => ({ type: "engine", ref: 0 }));
}

function measure($: Engine, tokens: number | undefined, more: { percent?: number; window?: number; changed?: ("context" | "rateLimits" | "cost")[] } = {}) {
  const window = more.window ?? WINDOW;
  const percent = "percent" in more ? more.percent : tokens === undefined ? undefined : Math.round((tokens / window) * 100);
  return $.session.measure({
    context: { tokens, window, percent },
    rateLimits: [],
    changed: more.changed ?? ["context"],
  });
}

function band($: Engine, surface: Surface, props: { bodyColumns?: number; hasSurvey?: boolean } = {}) {
  return $.ui.mount({
    plugin: "token-weather",
    surface,
    component: "AbovePrompt",
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: props.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  });
}

async function text($: Engine, surface: Surface, props?: Parameters<typeof band>[2]) {
  const ui = await band($, surface, props);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  // Nested Texts (the terminal's gauge) show up inside their parent as well.
  return texts.map((t) => t.text).join("|");
}

for (const surface of SURFACES) {
  describe(`on ${surface}`, () => {
    describe("before any reading", () => {
      test("yields the band to core", async ($, on) => {
        core(on);
        const ui = await band($, surface);
        expect(await ui.drawn()).toEqual({ type: "engine", ref: 0 });
      });

      test("ignores a measurement with no token count yet", async ($, on) => {
        core(on);
        await measure($, undefined);
        expect(await (await band($, surface)).drawn()).toEqual({ type: "engine", ref: 0 });
      });

      test("ignores a measurement where only rate limits moved", async ($, on) => {
        core(on);
        await measure($, 20_000, { changed: ["rateLimits"] });
        expect(await (await band($, surface)).drawn()).toEqual({ type: "engine", ref: 0 });
      });
    });

    describe("the forecast", () => {
      test("shows icon, word, percent and tokens", async ($, on) => {
        core(on);
        await measure($, 20_000);
        const shown = await text($, surface);
        expect(shown).toContain(HEAD[surface].clear);
        expect(shown).toContain("10%");
        expect(shown).toContain("20k / 200k");
      });

      test("spells out what the percent is of when there is room", async ($, on) => {
        core(on);
        await measure($, 20_000);
        expect(await text($, surface, { bodyColumns: 120 })).toContain("10% of context");
        expect(await text($, surface, { bodyColumns: 80 })).not.toContain("of context");
      });

      for (const [tokens, word] of [
        [60_000, "Cloudy"],
        [120_000, "Showers"],
        [170_000, "Storm"],
        [190_000, "Compact soon"],
      ] as const) {
        test(`${(tokens / WINDOW) * 100}% reads as ${word}`, async ($, on) => {
          core(on);
          await measure($, tokens);
          expect(await text($, surface)).toContain(word);
        });
      }

      test("colors by theme key so the text follows the person's theme", async ($, on) => {
        core(on);
        for (const [tokens, color] of [
          [20_000, "success"],
          [60_000, "suggestion"],
          [120_000, "warning"],
          [170_000, "claude"],
          [190_000, "error"],
        ] as const) {
          await measure($, tokens);
          const ui = await band($, surface);
          expect((await ui.find({ type: "Text", text: HEAD[surface].icon }))?.props.color).toBe(color);
          await ui.unmount();
        }
      });

      test("works out the percent when the engine leaves it out", async ($, on) => {
        core(on);
        await measure($, 50_000, { percent: undefined });
        expect(await text($, surface)).toContain("25%");
      });

      test("abbreviates millions and leaves small counts whole", async ($, on) => {
        core(on);
        await measure($, 500, { window: 1_000_000 });
        expect(await text($, surface)).toContain("500 / 1M");
      });

      test("yields to a survey", async ($, on) => {
        core(on);
        await measure($, 20_000);
        expect(await (await band($, surface, { hasSurvey: true })).drawn()).toEqual({ type: "engine", ref: 0 });
      });

      test("suggests compacting only when the window is nearly full", async ($, on) => {
        core(on);
        await measure($, 170_000);
        expect(await text($, surface)).not.toContain("/compact");
        await measure($, 185_000);
        expect(await text($, surface)).toContain("try /compact");
      });
    });

    describe("the history", () => {
      test("draws no trend after one turn", async ($, on) => {
        core(on);
        await measure($, 20_000);
        const shown = await text($, surface);
        expect(shown).not.toContain("last turn");
        expect(shown).not.toContain("steady");
      });

      test("shows growth since the last turn", async ($, on) => {
        core(on);
        await measure($, 20_000);
        await measure($, 32_500);
        expect(await text($, surface)).toContain("▲ +12.5k last turn");
      });

      test("shows a drop, as after compaction, in the success color", async ($, on) => {
        core(on);
        await measure($, 150_000);
        await measure($, 30_000);
        const ui = await band($, surface);
        const drop = await ui.find({ type: "Text", text: /▼/ });
        expect(drop?.text).toBe("▼ 120k last turn");
        expect(drop?.props.color).toBe("success");
        await ui.unmount();
      });

      test("calls an unchanged count steady", async ($, on) => {
        core(on);
        await measure($, 40_000);
        await measure($, 40_000, { changed: ["context", "cost"] });
        expect(await text($, surface)).toContain("steady");
      });

      test("hides the sparkline and trend on a narrow band, keeping the forecast", async ($, on) => {
        core(on);
        await measure($, 20_000);
        await measure($, 30_000);
        const ui = await band($, surface, { bodyColumns: 45 });
        const shown = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
        expect(shown).toContain(HEAD[surface].clear);
        expect(shown).toContain("15%");
        expect(shown).not.toContain("last turn");
        expect((await ui.findAll({ type: "Svg" })).filter((s) => String(s.props.alt).includes("over the last"))).toEqual([]);
        await ui.unmount();
      });

      test("on a very narrow band only the headline and percent stay", async ($, on) => {
        core(on);
        await measure($, 190_000);
        await measure($, 195_000);
        const shown = await text($, surface, { bodyColumns: 24 });
        expect(shown).toContain("Compact soon");
        expect(shown).toContain("98%");
        expect(shown).not.toContain("/ 200k");
        expect(shown).not.toContain("compact");
      });

      test("a mounted band redraws on the next reading", async ($, on) => {
        core(on);
        await measure($, 36_100);
        const ui = await band($, surface);
        expect((await ui.find({ type: "Text", text: /Clear/ }))?.text).toBe(HEAD[surface].clear);
        await measure($, 134_400);
        expect((await ui.find({ type: "Text", text: /Showers/ }))?.text).toBe(HEAD[surface].showers);
        expect((await ui.find({ type: "Text", text: /▲/ }))?.text).toBe("▲ +98.3k last turn");
        await ui.unmount();
      });
    });
  });
}

describe("on the terminal", () => {
  test("draws the gauge in box-drawing cells that fill with the context", async ($, on) => {
    core(on);
    await measure($, 80_000); // 40%
    const ui = await band($, "terminal"); // 98 usable columns: a 16-cell gauge
    expect((await ui.find({ type: "Text", text: /^━{6}$/ }))?.props.color).toBe("suggestion");
    expect((await ui.find({ type: "Text", text: /^─{10}$/ }))?.props.dimColor).toBe(true);
    await ui.unmount();
  });

  test("shows a sliver of the gauge for any use, and all of it when full", async ($, on) => {
    core(on);
    await measure($, 1_000); // under half a cell
    const ui = await band($, "terminal");
    expect(await ui.find({ type: "Text", text: /^━$/ })).toBeDefined();
    await measure($, 200_000);
    expect(await ui.find({ type: "Text", text: /^━{16}$/ })).toBeDefined();
    await ui.unmount();
  });

  test("makes the gauge wider on a wider terminal", async ($, on) => {
    core(on);
    await measure($, 200_000);
    const ui = await band($, "terminal", { bodyColumns: 200 });
    expect(await ui.find({ type: "Text", text: /^━{24}$/ })).toBeDefined();
    await ui.unmount();
  });

  test("draws a block sparkline of the last turns", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 40_000);
    const ui = await band($, "terminal");
    expect((await ui.find({ type: "Text", text: /^[▁▂▃▄▅▆▇█]+$/ }))?.text).toBe("▄█");
    await ui.unmount();
  });

  test("keeps the last 12 readings", async ($, on) => {
    core(on);
    for (let i = 1; i <= 15; i++) await measure($, i * 10_000);
    const ui = await band($, "terminal");
    const spark = await ui.find({ type: "Text", text: /^[▁▂▃▄▅▆▇█]+$/ });
    expect(spark?.text.length).toBe(12);
    await ui.unmount();
  });

  test("draws no vector graphics", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 40_000);
    const ui = await band($, "terminal");
    expect(await ui.findAll({ type: "Svg" })).toEqual([]);
    await ui.unmount();
  });
});

describe("on the desktop", () => {
  test("draws the gauge as a vector bar in the forecast's color", async ($, on) => {
    core(on);
    await measure($, 80_000); // 40%
    const ui = await band($, "desktop");
    const gauge = (await ui.findAll({ type: "Svg" })).find((s) => String(s.props.alt).startsWith("Context 40%"));
    expect(gauge?.props.alt).toBe("Context 40% full");
    expect(String(gauge?.props.source)).toContain('width="48"'); // 40% of 120
    expect(String(gauge?.props.source)).toContain("#5b8def");
    await ui.unmount();
  });

  test("draws the history as one vector bar per turn", async ($, on) => {
    core(on);
    for (const tokens of [20_000, 40_000, 80_000]) await measure($, tokens);
    const ui = await band($, "desktop");
    const spark = (await ui.findAll({ type: "Svg" })).find((s) => String(s.props.alt).includes("last 3 turns"));
    // Three bars, the tallest as high as the box.
    expect(String(spark?.props.source).match(/<rect /g)).toHaveLength(3);
    expect(String(spark?.props.source)).toContain('height="20"');
    await ui.unmount();
  });

  test("draws no block-glyph sparkline, which a proportional face cannot line up", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 40_000);
    const ui = await band($, "desktop");
    expect(await ui.find({ type: "Text", text: /^[▁▂▃▄▅▆▇█]+$/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /^[━─]+$/ })).toBeUndefined();
    await ui.unmount();
  });

  test("drops the vector graphics before the forecast when room is short", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 40_000);
    const ui = await band($, "desktop", { bodyColumns: 20 });
    expect(await ui.findAll({ type: "Svg" })).toEqual([]);
    expect(await ui.find({ type: "Text", text: /Clear/ })).toBeDefined();
    await ui.unmount();
  });
});
