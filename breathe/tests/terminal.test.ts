import { describe, expect, test } from "claude-code/testing";

import { SURFACES, noWait, noCountdown, DE, EN, core, start, beginTurn, endTurn, band, words, isEngine, isShown, hide, READY, numberIn } from "./helpers";
import type { Band } from "./helpers";

describe("the breath on the terminal", () => {
  test("starts a turn by breathing in, with the pattern named", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const shown = await words($, "terminal");
    expect(shown).toContain(DE.in);
    expect(shown).toContain("Box Breathing · 4-4-4-4");
  });

  test("goes through in, hold, out, hold and starts over while Claude works", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    const phase = async () => (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");

    expect(await phase()).toContain(DE.in);
    await clock.advance(4000);
    expect(await phase()).toContain(DE.hold);
    await clock.advance(4000);
    expect(await phase()).toContain(DE.out);
    await clock.advance(4000);
    expect(await phase()).toContain(DE.hold);
    await clock.advance(4000);
    expect(await phase()).toContain(DE.in);
    await clock.advance(16_000 * 3 + 4000);
    expect(await phase()).toContain(DE.hold);
    await ui.unmount();
  });

  test("counts the seconds down", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    const left = async () => (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
    expect(await left()).toMatch(/ {2}4/);
    await clock.advance(1000);
    expect(await left()).toMatch(/ {2}3/);
    await clock.advance(2000);
    expect(await left()).toMatch(/ {2}1/);
    await ui.unmount();
  });

  test("names the phases it winds down through, and ends on the exhale", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await endTurn($);
    expect(await words($, "terminal")).toContain(DE.in);
    await clock.advance(3000); // 4 s: holding
    expect(await words($, "terminal")).toContain(DE.hold);
    await clock.advance(4000); // 8 s: breathing out
    expect(await words($, "terminal")).toContain(DE.out);
    await clock.advance(3900); // 11.9 s: still breathing out
    expect(await words($, "terminal")).toContain(DE.out);
  });

  test("finishes the exhale it is in", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(9000);
    await endTurn($);
    await clock.advance(2800);
    expect(await words($, "terminal")).toContain(DE.out);
  });

  test("finishes the breath after an interrupted turn too", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(2000);
    await endTurn($, undefined, "aborted");
    await clock.advance(5000);
    expect(await words($, "terminal")).toContain(DE.hold);
  });

  test("carries on, without starting over, when the next turn begins during the wind-down", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await endTurn($);
    await clock.advance(4000); // 5 s: holding
    await beginTurn($);
    await clock.advance(4000); // 9 s: it would have ended at 12 s
    expect(await words($, "terminal")).toContain(DE.out);
    await clock.advance(4000); // 13 s: the new turn keeps it going
    expect(await words($, "terminal")).toContain(DE.hold);
  });

  test("starts with a breath in again after a finished one", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await endTurn($);
    await clock.advance(12_000);
    await beginTurn($);
    expect(await words($, "terminal")).toContain(DE.in);
  });

  test("a mounted band draws each phase as the clock moves", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    expect(await ui.find({ type: "Text", text: new RegExp(DE.in) })).toBeDefined();
    await clock.advance(8000);
    expect(await ui.find({ type: "Text", text: new RegExp(DE.out) })).toBeDefined();
    expect(await ui.find({ type: "Text", text: new RegExp(DE.in) })).toBeUndefined();
    await ui.unmount();
  });

  test("keeps its phase through a subagent's turns", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await beginTurn($, "agent-1");
    await endTurn($, "agent-1");
    await clock.advance(14_000);
    expect(await words($, "terminal")).toContain(DE.hold);
  });

  describe("with settings", () => {
    test("takes the phase length from phaseSeconds", noCountdown({ phaseSeconds: 2 }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(1500);
      expect(await words($, "terminal")).toContain(DE.in);
      await clock.advance(600);
      expect(await words($, "terminal")).toContain(DE.hold);
      expect(await words($, "terminal")).toContain("2-2-2-2");
    });

    test("speaks English when asked", noCountdown({ language: "en" }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      expect(await words($, "terminal")).toContain(EN.in);
      await clock.advance(8000);
      expect(await words($, "terminal")).toContain(EN.out);
    });

    test("breathes in and out with no holds in the even pattern", noCountdown({ pattern: "even" }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      expect(await words($, "terminal")).toContain("Gleichmäßiges Atmen · 4-4");
      await clock.advance(4000);
      expect(await words($, "terminal")).toContain(DE.out);
      expect(await words($, "terminal")).not.toContain(DE.hold);
      await clock.advance(4000);
      expect(await words($, "terminal")).toContain(DE.in);
    });

    test("lets the breath out take 1.5 times as long in the calm pattern", noCountdown({ pattern: "calm", language: "en" }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      expect(await words($, "terminal")).toContain("Calm Breathing · 4-6");
      await clock.advance(4000);
      expect(await words($, "terminal")).toContain(EN.out);
      await clock.advance(5900); // 9.9 s
      expect(await words($, "terminal")).toContain(EN.out);
      await clock.advance(200); // 10.1 s
      expect(await words($, "terminal")).toContain(EN.in);
    });

    test("shows the breath in after startAfterSeconds", noCountdown({ startAfterSeconds: 3 }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(3100);
      expect(await words($, "terminal")).toContain(DE.in);
      await clock.advance(4000);
      expect(await words($, "terminal")).toContain(DE.hold);
    });
  });
});

for (const surface of SURFACES) {
  describe(`next to another mod's band on ${surface}`, () => {
    test("keeps the band beneath it", noCountdown(), async ($, on) => {
      core(on, ($, e) => $.ui.resolve(e).Text({ children: "forecast band" }));
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect(await hide(ui)).toBeDefined();
      expect((await ui.findAll({ type: "Text" })).map((t) => t.text)).toContain("forecast band");
      await ui.unmount();
    });

    test("leaves the engine's own node out, which draws nothing here", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect(JSON.stringify(await ui.drawn())).not.toContain('"engine"');
      await ui.unmount();
    });

    test("leaves the other band as it is when there is no breath to show", noCountdown(), async ($, on) => {
      core(on, ($, e) => $.ui.resolve(e).Text({ children: "forecast band" }));
      await start($);
      const ui = await band($, surface);
      expect(JSON.stringify(await ui.drawn())).toContain("forecast band");
      expect(await words($, surface)).toBe("forecast band");
      await ui.unmount();
    });
  });
}

// What the terminal shows for the countdown: the label and the number it counts, 3, 2, 1, 0.

describe("the countdown on the terminal", () => {
  const look = async (ui: Band) => {
    const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text);
    return { texts, text: texts.join("|"), number: numberIn(texts) };
  };

  test("counts 3, 2, 1, 0 before the first breath, a second for each", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    for (const n of ["3", "2", "1", "0"]) {
      const now = await look(ui);
      expect(now.text).toContain(READY.de);
      expect(now.text).not.toContain(DE.in);
      expect(now.number).toBe(n);
      await clock.advance(1000);
    }
    // The first breath begins when the countdown has shown 0 for its second.
    const now = await look(ui);
    expect(now.text).toContain(DE.in);
    expect(now.text).not.toContain(READY.de);
    expect(now.number).toBe("4");
    await clock.advance(4000);
    expect((await look(ui)).text).toContain(DE.hold);
    await ui.unmount();
  });

  test("changes number when the second is up, not before", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    await clock.advance(900);
    expect((await look(ui)).number).toBe("3");
    await clock.advance(200);
    expect((await look(ui)).number).toBe("2");
    await ui.unmount();
  });

  test("starts from countdownSeconds", noWait({ countdownSeconds: 2 }), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    expect((await look(ui)).number).toBe("2");
    await clock.advance(2000);
    expect((await look(ui)).number).toBe("0");
    await clock.advance(1000);
    expect((await look(ui)).text).toContain(DE.in);
    await ui.unmount();
  });

  test("is off with countdownSeconds 0: the first breath begins at once", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const text = await words($, "terminal");
    expect(text).toContain(DE.in);
    expect(text).not.toContain(READY.de);
  });

  test("speaks English when asked", noWait({ language: "en" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await words($, "terminal")).toContain(READY.en);
  });

  test("is a line with an empty bar over the number", noWait(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    expect(await ui.findAll({ type: "Raster" })).toEqual([]);
    expect(await ui.find({ type: "Text", text: /^─+$/ })).toBeDefined();
    expect((await ui.find({ type: "Text", text: new RegExp(`^${READY.de}$`) }))?.props.color).toBe("suggestion");
    await ui.unmount();
  });

  test("is not shown again when the next turn begins while the breath winds down", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(6000); // two seconds into the first breath
    await endTurn($);
    await clock.advance(1000);
    await beginTurn($);
    const text = await words($, "terminal");
    expect(text).toContain(DE.in);
    expect(text).not.toContain(READY.de);
  });

  test("is shown again for a turn that begins after the breath has ended", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(4000 + 3000); // three seconds into the breath
    await endTurn($);
    await clock.advance(20_000); // long past the end of its exhale
    await isEngine(await band($, "terminal"));
    await beginTurn($);
    expect(await words($, "terminal")).toContain(READY.de);
  });
});

for (const surface of SURFACES) {
  describe(`the countdown on ${surface}`, () => {
    test("is dropped, with no breath to finish, when the turn ends during it", noWait(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2000);
      await isShown(await band($, surface));
      await endTurn($);
      await isEngine(await band($, surface));
      await clock.advance(10_000);
      await isEngine(await band($, surface));
    });

    test("comes after startAfterSeconds, and then the breath", noWait({ startAfterSeconds: 3 }), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await isEngine(await band($, surface));
      await clock.advance(3000);
      const ui = await band($, surface);
      await isShown(ui);
      await clock.advance(4000);
      await isShown(ui);
      await ui.unmount();
    });
  });
}

describe("on the terminal", () => {
  test("draws words and a bar, and no picture", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    // Whatever the room: the default band, a short one, a narrow one.
    for (const props of [{}, { maxRows: 3 }, { bodyColumns: 40 }]) {
      const ui = await band($, "terminal", props);
      expect(await ui.findAll({ type: "Raster" })).toEqual([]);
      expect(await ui.findAll({ type: "Svg" })).toEqual([]);
      expect(await ui.find({ type: "Text", text: /Einatmen/ })).toBeDefined();
      expect(await ui.find({ type: "Text", text: /^─+$|^█*[▏▎▍▌▋▊▉]?─*$/ })).toBeDefined();
      await ui.unmount();
    }
  });

  test("colors the phase by theme key so the text follows the person's theme", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    const color = async (word: string) => (await ui.find({ type: "Text", text: new RegExp(`^${word}$`) }))?.props.color;
    expect(await color(DE.in)).toBe("success");
    await clock.advance(4000);
    expect(await color(DE.hold)).toBe("suggestion");
    await clock.advance(4000);
    expect(await color(DE.out)).toBe("claude");
    await ui.unmount();
  });

  test("fills the bar as the lungs fill and empties it as they empty", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const bar = async () => {
      const ui = await band($, "terminal");
      const found = (await ui.findAll({ type: "Text" })).map((t) => t.text).find((t) => /^[█▏▎▍▌▋▊▉─]+$/.test(t)) ?? "";
      await ui.unmount();
      return found;
    };
    // Empty at the start of the breath, full when the lungs are, empty again after the exhale.
    expect(await bar()).toMatch(/^─+$/);
    await clock.advance(4000);
    expect(await bar()).toMatch(/^█+$/);
    await clock.advance(8000);
    expect(await bar()).toMatch(/^─+$/);
  });

  test("moves the bar in eighths of a cell", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    // A second into breathing in the lungs are 15% full: 19 of the 16-cell bar's 128 eighths.
    await clock.advance(1000);
    const ui = await band($, "terminal");
    expect(await ui.find({ type: "Text", text: /^[█▏▎▍▌▋▊▉─]+$/ })).toMatchObject({ text: "██▍" + "─".repeat(13) });
    await ui.unmount();
  });
});
