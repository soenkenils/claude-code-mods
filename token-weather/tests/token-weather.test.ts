import type { On } from "claude-code";
import { describe, expect, test, type Engine } from "claude-code/testing";

const WINDOW = 200_000;

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

function band($: Engine, props: { bodyColumns?: number; hasSurvey?: boolean } = {}) {
  return $.ui.mount({
    plugin: "token-weather",
    surface: "terminal",
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

async function text($: Engine, props?: Parameters<typeof band>[1]) {
  const ui = await band($, props);
  const texts = await ui.findAll({ type: "Text" });
  await ui.unmount();
  return texts.map((t) => t.text).join("");
}

describe("before any reading", () => {
  test("yields the band to core", async ($, on) => {
    core(on);
    const ui = await band($);
    expect(await ui.drawn()).toEqual({ type: "engine", ref: 0 });
  });

  test("ignores a measurement with no token count yet", async ($, on) => {
    core(on);
    await measure($, undefined);
    expect(await (await band($)).drawn()).toEqual({ type: "engine", ref: 0 });
  });

  test("ignores a measurement where only rate limits moved", async ($, on) => {
    core(on);
    await measure($, 20_000, { changed: ["rateLimits"] });
    expect(await (await band($)).drawn()).toEqual({ type: "engine", ref: 0 });
  });
});

describe("the forecast", () => {
  test("shows icon, word, percent and tokens", async ($, on) => {
    core(on);
    await measure($, 20_000);
    const shown = await text($);
    expect(shown).toContain("☀  Clear");
    expect(shown).toContain("10% of context");
    expect(shown).toContain("20k / 200k");
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
      expect(await text($)).toContain(word);
    });
  }

  test("works out the percent when the engine leaves it out", async ($, on) => {
    core(on);
    await measure($, 50_000, { percent: undefined });
    expect(await text($)).toContain("25% of context");
  });

  test("abbreviates millions and leaves small counts whole", async ($, on) => {
    core(on);
    await measure($, 500, { window: 1_000_000 });
    expect(await text($)).toContain("500 / 1M");
  });

  test("yields to a survey", async ($, on) => {
    core(on);
    await measure($, 20_000);
    expect(await (await band($, { hasSurvey: true })).drawn()).toEqual({ type: "engine", ref: 0 });
  });
});

describe("the history", () => {
  test("draws a sparkline but no trend after one turn", async ($, on) => {
    core(on);
    await measure($, 20_000);
    const shown = await text($);
    expect(shown).toContain("last turns █");
    expect(shown).not.toContain("last turn ");
    expect(shown).not.toContain("steady");
  });

  test("shows growth since the last turn", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 32_500);
    expect(await text($)).toContain("▲ +12.5k last turn");
  });

  test("shows a drop, as after compaction", async ($, on) => {
    core(on);
    await measure($, 150_000);
    await measure($, 30_000);
    expect(await text($)).toContain("▼ 120k last turn");
  });

  test("calls an unchanged count steady", async ($, on) => {
    core(on);
    await measure($, 40_000);
    await measure($, 40_000, { changed: ["context", "cost"] });
    expect(await text($)).toContain("steady");
  });

  test("keeps the last 12 readings", async ($, on) => {
    core(on);
    for (let i = 1; i <= 15; i++) await measure($, i * 10_000);
    const ui = await band($);
    const spark = await ui.find({ type: "Text", text: /^[▁▂▃▄▅▆▇█]+$/ });
    expect(spark?.text.length).toBe(12);
  });

  test("hides the sparkline and trend on a narrow terminal", async ($, on) => {
    core(on);
    await measure($, 20_000);
    await measure($, 30_000);
    const shown = await text($, { bodyColumns: 59 });
    expect(shown).toContain("15% of context");
    expect(shown).not.toContain("last turn");
  });

  test("a mounted band redraws on the next reading", async ($, on) => {
    core(on);
    await measure($, 36_100);
    const ui = await band($);
    expect((await ui.find({ type: "Text", text: /Clear/ }))?.text).toBe("☀  Clear");
    await measure($, 134_400);
    expect((await ui.find({ type: "Text", text: /Showers/ }))?.text).toBe("☂  Showers");
    expect((await ui.find({ type: "Text", text: /▲/ }))?.text).toBe("  ▲ +98.3k last turn");
    await ui.unmount();
  });
});
