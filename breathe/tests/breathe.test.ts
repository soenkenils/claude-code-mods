import type { EngineInterface, On, RenderInput } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

const SURFACES = ["terminal", "desktop"] as const;
type Surface = (typeof SURFACES)[number];

// Most tests are about the breath itself, so they start without the countdown, which has tests of its own.
const noCountdown = (options: Record<string, number | string> = {}) => ({ options: { countdownSeconds: 0, ...options } });

const DE = { in: "Einatmen", hold: "Halten", out: "Ausatmen" };
const EN = { in: "Breathe in", hold: "Hold", out: "Breathe out" };

// What sits beneath the plugin in a session: the engine's own answers. `below` is another
// mod's band, drawn beneath this one; by default nothing is.
function core(on: On, below?: ($: EngineInterface, e: RenderInput) => unknown) {
  const clock = mock.clock(on);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => (below ? below($, e) : { type: "engine", ref: 0 }) as never);
  return clock;
}

const start = ($: Engine) => $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });
const beginTurn = ($: Engine, agentId?: string) => $.turn.start({ text: "go", turnId: agentId ?? "main", ...(agentId ? { agentId } : {}) });
const endTurn = ($: Engine, agentId?: string, reason: "answer" | "aborted" = "answer") =>
  $.turn.complete({ answer: "", durationMs: 1, isAborted: reason === "aborted", turnId: agentId ?? "main", reason, ...(agentId ? { agentId } : {}) });
const slash = ($: Engine, args = "") =>
  $.command.run({ command: "breathe", args, origin: { kind: "composer" }, presentation: { isFullscreen: true, columns: 100 } });

type Props = { bodyColumns?: number; maxRows?: number; hasSurvey?: boolean };
function band($: Engine, surface: Surface, props: Props = {}) {
  return $.ui.mount({
    plugin: "breathe",
    surface,
    component: "AbovePrompt",
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: true,
      maxRows: props.maxRows ?? 10,
      bodyColumns: props.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  });
}

async function words($: Engine, surface: Surface, props?: Props) {
  const ui = await band($, surface, props);
  const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
  await ui.unmount();
  return texts;
}

const isEngine = async (ui: Awaited<ReturnType<typeof band>>) => expect(await ui.drawn()).toEqual({ type: "engine", ref: 0 });

for (const surface of SURFACES) {
  describe(`on ${surface}`, () => {
    test("shows nothing before a turn", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await isEngine(await band($, surface));
    });

    test("starts a turn by breathing in", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const shown = await words($, surface);
      expect(shown).toContain(DE.in);
      expect(shown).toContain("Box Breathing · 4-4-4-4");
    });

    test("goes through in, hold, out, hold and starts over while Claude works", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
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
      const ui = await band($, surface);
      const left = async () => (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
      const pattern = surface === "terminal" ? /  4/ : /4 s/;
      expect(await left()).toMatch(pattern);
      await clock.advance(1000);
      expect(await left()).toMatch(surface === "terminal" ? /  3/ : /3 s/);
      await clock.advance(2000);
      expect(await left()).toMatch(surface === "terminal" ? /  1/ : /1 s/);
      await ui.unmount();
    });

    test("finishes the breath in progress when Claude is done, and ends on the exhale", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(1000); // a second into breathing in
      await endTurn($);

      const ui = await band($, surface);
      expect(await words($, surface)).toContain(DE.in);
      await clock.advance(3000); // 4 s: holding
      expect(await words($, surface)).toContain(DE.hold);
      await clock.advance(4000); // 8 s: breathing out
      expect(await words($, surface)).toContain(DE.out);
      await clock.advance(3900); // 11.9 s: still breathing out
      expect(await words($, surface)).toContain(DE.out);
      await clock.advance(200); // 12.1 s: the exhale is over
      await isEngine(ui);
      await ui.unmount();
    });

    test("says that Claude is done while it finishes", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      expect(await words($, surface)).not.toContain("Claude ist fertig");
      await clock.advance(1000);
      await endTurn($);
      expect(await words($, surface)).toContain("Claude ist fertig · atme zu Ende aus");
    });

    test("ends at once when the turn ends in the hold after the exhale", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(13_000);
      await endTurn($);
      await clock.advance(200);
      await isEngine(await band($, surface));
    });

    test("finishes the exhale it is in", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(9000);
      await endTurn($);
      await clock.advance(2800);
      expect(await words($, surface)).toContain(DE.out);
      await clock.advance(400);
      await isEngine(await band($, surface));
    });

    test("finishes the breath after an interrupted turn too", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2000);
      await endTurn($, undefined, "aborted");
      await clock.advance(5000);
      expect(await words($, surface)).toContain(DE.hold);
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
      expect(await words($, surface)).toContain(DE.out);
      await clock.advance(4000); // 13 s: the new turn keeps it going
      expect(await words($, surface)).toContain(DE.hold);
      await endTurn($);
      await clock.advance(200);
      await isEngine(await band($, surface));
    });

    test("starts with a breath in again after a finished one", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(1000);
      await endTurn($);
      await clock.advance(12_000);
      await beginTurn($);
      expect(await words($, surface)).toContain(DE.in);
    });

    test("a mounted band draws each phase as the clock moves", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect(await ui.find({ type: "Text", text: new RegExp(DE.in) })).toBeDefined();
      await clock.advance(8000);
      expect(await ui.find({ type: "Text", text: new RegExp(DE.out) })).toBeDefined();
      expect(await ui.find({ type: "Text", text: new RegExp(DE.in) })).toBeUndefined();
      await ui.unmount();
    });

    test("ignores a subagent's turns", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($, "agent-1");
      await clock.advance(500);
      await isEngine(await band($, surface));

      await beginTurn($);
      await clock.advance(1000);
      await endTurn($, "agent-1");
      // The subagent ending did not end the main turn's breath.
      await clock.advance(14_000);
      expect(await words($, surface)).toContain(DE.hold);
    });

    test("yields to a survey", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      await isEngine(await band($, surface, { hasSurvey: true }));
    });

    test("can be turned off and on with /breathe", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);

      expect((await slash($, "off")).text).toContain("off");
      await isEngine(await band($, surface));
      await endTurn($);
      await beginTurn($);
      await clock.advance(1000);
      await isEngine(await band($, surface));
      expect((await slash($)).text).toContain("off");

      expect((await slash($, "on")).text).toContain("on");
      expect((await slash($)).text).toBe("Breathe is on.");
      await endTurn($);
      await beginTurn($);
      expect(await words($, surface)).toContain(DE.in);
    });

    test("explains a command it does not know", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      expect((await slash($, "sideways")).text).toBe("Usage: /breathe [on|off]");
    });

    describe("with settings", () => {
      test("takes the phase length from phaseSeconds", noCountdown({ phaseSeconds: 2 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(1500);
        expect(await words($, surface)).toContain(DE.in);
      });

      test("a shorter phase goes by sooner", noCountdown({ phaseSeconds: 2 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(2100);
        expect(await words($, surface)).toContain(DE.hold);
        expect(await words($, surface)).toContain("2-2-2-2");
      });

      test("speaks English when asked", noCountdown({ language: "en" }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        expect(await words($, surface)).toContain(EN.in);
        await clock.advance(8000);
        expect(await words($, surface)).toContain(EN.out);
      });

      test("waits startAfterSeconds before showing anything, then begins with a breath in", noCountdown({ startAfterSeconds: 3 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(2900);
        await isEngine(await band($, surface));
        await clock.advance(200);
        expect(await words($, surface)).toContain(DE.in);
        await clock.advance(4000);
        expect(await words($, surface)).toContain(DE.hold);
      });

      test("shows nothing for a turn that ends before the delay", noCountdown({ startAfterSeconds: 3 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(2000);
        await endTurn($);
        await clock.advance(20_000);
        await isEngine(await band($, surface));
      });
    });
  });
}

for (const surface of SURFACES) {
  describe(`next to another mod's band on ${surface}`, () => {
    test("keeps the band beneath it", noCountdown(), async ($, on) => {
      core(on, ($, e) => $.ui.resolve(e).Text({ children: "forecast band" }));
      await start($);
      await beginTurn($);
      const shown = await words($, surface);
      expect(shown).toContain(DE.in);
      expect(shown).toContain("forecast band");
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

// What the band shows for the countdown: the label and the number it counts, 3, 2, 1, 0.
const READY = { de: "Mach dich bereit", en: "Get ready" };
const numberIn = (texts: string[]) => texts.map((t) => /^\s*(\d+)(?: s)?$/.exec(t)?.[1]).find((n) => n !== undefined);

for (const surface of SURFACES) {
  describe(`the countdown on ${surface}`, () => {
    const look = async (ui: Awaited<ReturnType<typeof band>>) => {
      const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text);
      return { texts, text: texts.join("|"), number: numberIn(texts) };
    };

    test("counts 3, 2, 1, 0 before the first breath, a second for each", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
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

    test("changes number when the second is up, not before", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await clock.advance(900);
      expect((await look(ui)).number).toBe("3");
      await clock.advance(200);
      expect((await look(ui)).number).toBe("2");
      await ui.unmount();
    });

    test("starts from countdownSeconds", { options: { countdownSeconds: 2 } }, async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect((await look(ui)).number).toBe("2");
      await clock.advance(2000);
      expect((await look(ui)).number).toBe("0");
      await clock.advance(1000);
      expect((await look(ui)).text).toContain(DE.in);
      await ui.unmount();
    });

    test("is off with countdownSeconds 0: the first breath begins at once", { options: { countdownSeconds: 0 } }, async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const text = await words($, surface);
      expect(text).toContain(DE.in);
      expect(text).not.toContain(READY.de);
    });

    test("speaks English when asked", { options: { language: "en" } }, async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      expect(await words($, surface)).toContain(READY.en);
    });

    test("comes after startAfterSeconds, and then the breath", { options: { startAfterSeconds: 3 } }, async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await isEngine(await band($, surface));
      await clock.advance(3000);
      const ui = await band($, surface);
      const first = await look(ui);
      expect(first.text).toContain(READY.de);
      expect(first.number).toBe("3");
      await clock.advance(4000);
      expect((await look(ui)).text).toContain(DE.in);
      await ui.unmount();
    });

    test("is dropped, with no breath to finish, when the turn ends during it", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2000);
      expect(await words($, surface)).toContain(READY.de);
      await endTurn($);
      await isEngine(await band($, surface));
      await clock.advance(10_000);
      await isEngine(await band($, surface));
    });

    test("is not shown again when the next turn begins while the breath winds down", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(6000); // two seconds into the first breath
      await endTurn($);
      await clock.advance(1000);
      await beginTurn($);
      const text = await words($, surface);
      expect(text).toContain(DE.in);
      expect(text).not.toContain(READY.de);
    });

    test("is shown again for a turn that begins after the breath has ended", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(4000 + 3000); // three seconds into the breath
      await endTurn($);
      await clock.advance(20_000); // long past the end of its exhale
      await isEngine(await band($, surface));
      await beginTurn($);
      expect(await words($, surface)).toContain(READY.de);
    });
  });
}

describe("the countdown on the terminal", () => {
  test("is a line with an empty bar over the number", async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    expect(await ui.findAll({ type: "Raster" })).toEqual([]);
    expect(await ui.find({ type: "Text", text: /^─+$/ })).toBeDefined();
    expect((await ui.find({ type: "Text", text: new RegExp(`^${READY.de}$`) }))?.props.color).toBe("suggestion");
    await ui.unmount();
  });
});

describe("the countdown on the desktop", () => {
  test("shows the orb at rest, with the number in its alt text", async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const orb = async () => (await ui.findAll({ type: "Svg" }))[0];
    expect((await orb())?.props.alt).toBe("Mach dich bereit, 3");
    const resting = String((await orb())?.props.source);
    await clock.advance(4000);
    expect((await orb())?.props.alt).toBe("Einatmen, 4");
    expect(String((await orb())?.props.source)).not.toBe(resting);
    await ui.unmount();
  });
});

for (const surface of SURFACES) {
  describe(`the Hide button on ${surface}`, () => {
    const hide = (ui: Awaited<ReturnType<typeof band>>) => ui.find({ type: "Button", key: "hide" });

    test("is on the band while it breathes, and in the countdown", async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect((await hide(ui))?.props.label).toBe("Ausblenden");
      await ui.unmount();
    });

    test("says Hide in English", noCountdown({ language: "en" }), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect((await hide(ui))?.props.label).toBe("Hide");
      await ui.unmount();
    });

    test("takes the band away for the rest of the turn", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      expect(await words($, surface)).toContain(DE.in);
      await ui.press({ key: "hide" });
      await isEngine(ui);
      await clock.advance(10_000);
      await isEngine(ui);
      await endTurn($);
      await clock.advance(20_000);
      await isEngine(ui);
      await ui.unmount();
    });

    test("works in the countdown", async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(1000);
      const ui = await band($, surface);
      expect(await words($, surface)).toContain(READY.de);
      await ui.press({ key: "hide" });
      await isEngine(ui);
      await clock.advance(6000);
      await isEngine(ui);
      await ui.unmount();
    });

    test("works while the breath winds down after the turn", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2000);
      await endTurn($);
      const ui = await band($, surface);
      expect(await words($, surface)).toContain("Claude ist fertig");
      await ui.press({ key: "hide" });
      await isEngine(ui);
      await ui.unmount();
    });

    test("is only for this turn: the next one brings the band back", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await ui.press({ key: "hide" });
      await ui.unmount();
      await endTurn($);
      await clock.advance(1000);
      await beginTurn($);
      expect(await words($, surface)).toContain(DE.in);
    });

    test("does not mute it: /breathe still says it is on", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await ui.press({ key: "hide" });
      await ui.unmount();
      expect((await slash($)).text).toBe("Breathe is on.");
    });

    test("leaves another mod's band where it is", noCountdown(), async ($, on) => {
      core(on, ($, e) => $.ui.resolve(e).Text({ children: "forecast band" }));
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await ui.press({ key: "hide" });
      expect(JSON.stringify(await ui.drawn())).toContain("forecast band");
      expect(await hide(ui)).toBeUndefined();
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
      expect(await ui.find({ type: "Text", text: /^─+$|^━+─*$/ })).toBeDefined();
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
      const found = (await ui.findAll({ type: "Text" })).map((t) => t.text).find((t) => /^[━─]+$/.test(t)) ?? "";
      await ui.unmount();
      return found;
    };
    // Empty at the start of the breath, full when the lungs are, empty again after the exhale.
    expect(await bar()).toMatch(/^─+$/);
    await clock.advance(4000);
    expect(await bar()).toMatch(/^━+$/);
    await clock.advance(8000);
    expect(await bar()).toMatch(/^─+$/);
  });
});

describe("on the desktop", () => {
  test("draws the orb as a vector picture that changes with the breath", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const orb = async () => (await ui.findAll({ type: "Svg" }))[0];
    const empty = String((await orb())?.props.source);
    expect(empty).toContain("<svg");
    expect((await orb())?.props.alt).toBe("Einatmen, 4");
    await clock.advance(4000);
    const full = String((await orb())?.props.source);
    expect(full).not.toBe(empty);
    expect((await orb())?.props.alt).toBe("Halten, 4");
    await ui.unmount();
  });

  test("draws no raster, which only a terminal has", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    expect(await ui.findAll({ type: "Raster" })).toEqual([]);
    await ui.unmount();
  });

  test("leaves out the picture where the band is too narrow", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop", { bodyColumns: 30 });
    expect(await ui.findAll({ type: "Svg" })).toEqual([]);
    expect(await ui.find({ type: "Text", text: /Einatmen/ })).toBeDefined();
    await ui.unmount();
  });
});
