import type { EngineInterface, On, RenderInput } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

const SURFACES = ["terminal", "desktop"] as const;
type Surface = (typeof SURFACES)[number];

// The band waits `startAfterSeconds` (3 by default) and then counts down before the breath. Most
// tests are about the breath itself, so they skip both; the wait and the countdown have tests of their own.
const noWait = (options: Record<string, number | string> = {}) => ({ options: { startAfterSeconds: 0, ...options } });
const noCountdown = (options: Record<string, number | string> = {}) => noWait({ countdownSeconds: 0, ...options });

const DE = { in: "Einatmen", hold: "Halten", out: "Ausatmen" };
const EN = { in: "Breathe in", hold: "Hold", out: "Breathe out" };
const DONE = "Claude ist fertig · atme zu Ende aus";

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
type Band = Awaited<ReturnType<typeof band>>;

// The host's own text. On the desktop the phase's word is in the picture, not here.
async function words($: Engine, surface: Surface, props?: Props) {
  const ui = await band($, surface, props);
  const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text).join("|");
  await ui.unmount();
  return texts;
}

const ENGINE = { type: "engine", ref: 0 };
const isEngine = async (ui: Band) => expect(await ui.drawn()).toEqual(ENGINE);
const isShown = async (ui: Band) => expect(await ui.drawn()).not.toEqual(ENGINE);
const hide = (ui: Band) => ui.find({ type: "Button", key: "hide" });

// The desktop's picture, as the surface gets it.
const pictureOf = async (ui: Band) => (await ui.findAll({ type: "Svg" }))[0];
const sourceOf = async (ui: Band) => String((await pictureOf(ui))?.props.source);
const sourceNow = async ($: Engine) => {
  const ui = await band($, "desktop");
  const source = await sourceOf(ui);
  await ui.unmount();
  return source;
};
// When the picture's first breath begins, in seconds from when it was drawn.
const breathBegin = (source: string) => /dur="[\d.]+s" begin="(-?[\d.]+)s" repeatCount="indefinite"/.exec(source)?.[1];
// The picture's fades: [from, to, dur, begin].
const fadesOf = (source: string) =>
  [...source.matchAll(/<animate attributeName="opacity" from="(\d)" to="(\d)" dur="([\d.]+)s" begin="([\d.]+)s" fill="freeze"\/>/g)].map((m) => m.slice(1, 5));

for (const surface of SURFACES) {
  describe(`the band on ${surface}`, () => {
    test("shows nothing before a turn", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await isEngine(await band($, surface));
    });

    test("shows the band once a turn has begun, with a Hide button", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await isShown(ui);
      expect(await hide(ui)).toBeDefined();
      await ui.unmount();
    });

    test("finishes the breath in progress when Claude is done, and ends on the exhale", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(1000); // a second into breathing in
      await endTurn($);

      const ui = await band($, surface);
      await isShown(ui);
      await clock.advance(3000); // 4 s: holding
      await isShown(ui);
      await clock.advance(4000); // 8 s: breathing out
      await isShown(ui);
      await clock.advance(3900); // 11.9 s: still breathing out
      await isShown(ui);
      await clock.advance(200); // 12.1 s: the exhale is over
      await isEngine(ui);
      await ui.unmount();
    });

    test("says that Claude is done while it finishes", noCountdown(), async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      expect(await words($, surface)).not.toContain(DONE);
      await clock.advance(1000);
      await endTurn($);
      expect(await words($, surface)).toContain(DONE);
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
      await isShown(await band($, surface));
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
      await isShown(await band($, surface));
      await clock.advance(5100);
      await isEngine(await band($, surface));
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
      await isShown(await band($, surface));
      expect(await words($, surface)).not.toContain(DONE);
      await clock.advance(4000); // 13 s: the new turn keeps it going
      await isShown(await band($, surface));
      await endTurn($);
      await clock.advance(200);
      await isEngine(await band($, surface));
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
      await isShown(await band($, surface));
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
      await isShown(await band($, surface));
    });

    test("explains a command it does not know", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      expect((await slash($, "sideways")).text).toBe("Usage: /breathe [on|off]");
    });

    describe("with settings", () => {
      test("a shorter phase goes by sooner, and the whole breath ends sooner", noCountdown({ phaseSeconds: 2 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(500);
        await endTurn($);
        await clock.advance(5400); // 5.9 s: the exhale (4 to 6 s) goes on
        await isShown(await band($, surface));
        await clock.advance(200); // 6.1 s
        await isEngine(await band($, surface));
      });

      test("finishes a calm breath at the end of its long exhale", noCountdown({ pattern: "calm" }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(1000);
        await endTurn($);
        await clock.advance(8900); // 9.9 s
        await isShown(await band($, surface));
        await clock.advance(200); // 10.1 s
        await isEngine(await band($, surface));
      });

      test("waits startAfterSeconds before showing anything", noCountdown({ startAfterSeconds: 5 }), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(4900);
        await isEngine(await band($, surface));
        await clock.advance(200);
        await isShown(await band($, surface));
      });
    });
  });
}

describe("the wait before the band appears", () => {
  for (const surface of SURFACES) {
    test(`is 3 seconds by default, and then the countdown begins, on ${surface}`, async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2900);
      await isEngine(await band($, surface));
      await clock.advance(200);
      const ui = await band($, surface);
      await isShown(ui);
      if (surface === "terminal") expect(await words($, surface)).toContain("Mach dich bereit");
      else expect(await sourceOf(ui)).toContain("Mach dich bereit");
      await ui.unmount();
    });

    test(`shows nothing for a turn that ends within it, on ${surface}`, async ($, on) => {
      const clock = core(on);
      await start($);
      await beginTurn($);
      await clock.advance(2000);
      await endTurn($);
      await clock.advance(20_000);
      await isEngine(await band($, surface));
    });

    test(`is off with startAfterSeconds 0, on ${surface}`, noCountdown(), async ($, on) => {
      core(on);
      await start($);
      await beginTurn($);
      await isShown(await band($, surface));
    });
  }

  test("is the first of three: the wait, then the countdown, then the breath", async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(3100);
    expect(await words($, "terminal")).toContain("Mach dich bereit");
    await clock.advance(4000); // 7.1 s
    expect(await words($, "terminal")).toContain(DE.in);
  });
});

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
const READY = { de: "Mach dich bereit", en: "Get ready" };
const numberIn = (texts: string[]) => texts.map((t) => /^\s*(\d+)$/.exec(t)?.[1]).find((n) => n !== undefined);

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

describe("the countdown on the desktop", () => {
  const countNumbers = (source: string) => [...source.matchAll(/>Mach dich bereit {2}(\d)</g)].map((m) => m[1]);

  test("is in the picture, with the orb at rest until the breath begins", noWait(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(countNumbers(source)).toEqual(["3", "2", "1", "0"]);
    // The countdown from 3 takes 4 s, so the picture's breath waits that long.
    expect(breathBegin(source)).toBe("4");
  });

  test("is not in the host's text, which has no seconds to count", noWait(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await words($, "desktop")).toBe("");
  });

  test("starts from countdownSeconds", noWait({ countdownSeconds: 2 }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(countNumbers(source)).toEqual(["2", "1", "0"]);
    expect(breathBegin(source)).toBe("3");
  });

  test("is off with countdownSeconds 0: the first breath begins at once", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).not.toContain(READY.de);
    expect(breathBegin(source)).toBe("0");
  });

  test("speaks English when asked", noWait({ language: "en" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).toContain(`${READY.en}  3`);
    expect(source).toContain(EN.in);
  });

  test("is joined by the picture of a run that is under way, in step with the clock", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1500);
    // 1.5 s in, the 3 is past and the 2 is half over: the breath is 2.5 s off.
    expect(breathBegin(await sourceNow($))).toBe("2.5");
  });

  test("is not shown again when the next turn begins while the breath winds down", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(6000); // two seconds into the first breath
    await endTurn($);
    await clock.advance(1000);
    await beginTurn($);
    // The breath carries on from where it is: 3 s in.
    expect(breathBegin(await sourceNow($))).toBe("-3");
  });
});

describe("the Hide button", () => {
  for (const surface of SURFACES) {
    describe(`on ${surface}`, () => {
      test("is a native close control, named by its label", noCountdown(), async ($, on) => {
        core(on);
        await start($);
        await beginTurn($);
        const ui = await band($, surface);
        const button = await hide(ui);
        expect(button?.props.label).toBe("Ausblenden");
        expect(button?.props.role).toBe("dismiss");
        await ui.unmount();
      });

      test("is there in the countdown too", noWait(), async ($, on) => {
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
        await isShown(ui);
        await ui.press({ key: "hide" });
        await clock.advance(500); // past the picture's fade
        await isEngine(ui);
        await clock.advance(10_000);
        await isEngine(ui);
        await endTurn($);
        await clock.advance(20_000);
        await isEngine(ui);
        await ui.unmount();
      });

      test("works in the countdown", noWait(), async ($, on) => {
        const clock = core(on);
        await start($);
        await beginTurn($);
        await clock.advance(1000);
        const ui = await band($, surface);
        await isShown(ui);
        await ui.press({ key: "hide" });
        await clock.advance(500);
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
        expect(await words($, surface)).toContain(DONE);
        await ui.press({ key: "hide" });
        await clock.advance(500);
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
        const next = await band($, surface);
        await isShown(next);
        expect(await hide(next)).toBeDefined();
        await next.unmount();
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
        const clock = core(on, ($, e) => $.ui.resolve(e).Text({ children: "forecast band" }));
        await start($);
        await beginTurn($);
        const ui = await band($, surface);
        await ui.press({ key: "hide" });
        await clock.advance(500);
        expect(JSON.stringify(await ui.drawn())).toContain("forecast band");
        expect(await hide(ui)).toBeUndefined();
        await ui.unmount();
      });
    });
  }

  test("takes the terminal's line away at once, which has nothing to fade", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    await ui.press({ key: "hide" });
    await isEngine(ui);
    await ui.unmount();
  });

  test("takes the line of a desktop band too narrow for the picture away at once", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop", { bodyColumns: 30 });
    await ui.press({ key: "hide" });
    await isEngine(ui);
    await ui.unmount();
  });

  test("lets the desktop's picture fade out first, quickly, and then goes", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    await ui.press({ key: "hide" });
    await isShown(ui);
    // A fade out that starts now and takes 0.4 s.
    expect(fadesOf(await sourceOf(ui))).toContainEqual(["1", "0", "0.4", "0"]);
    await clock.advance(300);
    await isShown(ui);
    await clock.advance(200);
    await isEngine(ui);
    await ui.unmount();
  });

  test("takes the desktop's note that Claude is done away with the picture's fade", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(2000);
    await endTurn($);
    const ui = await band($, "desktop");
    expect(await words($, "desktop")).toContain(DONE);
    await ui.press({ key: "hide" });
    await clock.advance(100);
    await isShown(ui);
    expect((await ui.findAll({ type: "Text" })).map((t) => t.text)).not.toContain(DONE);
    await ui.unmount();
  });

  test("does not come back on the next turn's start while the picture is still fading", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    await ui.press({ key: "hide" });
    await endTurn($); // the fade goes on; the end of the turn does not change it
    await isShown(ui);
    await clock.advance(100);
    await beginTurn($); // a new turn, a new breath: not the hiding one over again
    await clock.advance(500); // past when the old fade would have ended
    await isShown(ui);
    const source = await sourceOf(ui);
    expect(fadesOf(source).map(([from]) => from)).not.toContain("1");
    await ui.unmount();
  });
});

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

describe("on the desktop", () => {
  test("draws the orb and the word as one picture that animates itself, so a redraw sends the same one", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const first = await pictureOf(ui);
    expect(String(first?.props.source)).toContain("<animate ");
    expect(first?.props.isInteractive).toBe(true);
    expect(first?.props.alt).toBe("Atemkugel");
    await clock.advance(4000);
    expect((await pictureOf(ui))?.props).toEqual(first?.props);
    await clock.advance(30_000);
    expect((await pictureOf(ui))?.props).toEqual(first?.props);
    await ui.unmount();
  });

  test("leaves the words to the picture: no text beside it while Claude works", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    expect(await ui.findAll({ type: "Text" })).toEqual([]);
    expect(String((await pictureOf(ui))?.props.source)).toContain(">Einatmen<");
    await ui.unmount();
  });

  test("is compact: the picture is 84 px high, with no seconds and no pattern hint", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).toContain('height="84"');
    expect(await words($, "desktop")).not.toMatch(/Box Breathing|4-4-4-4| s\b/);
  });

  test("draws a new run's picture at the point of the breath it first shows in", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    expect(breathBegin(await sourceNow($))).toBe("0");
    await clock.advance(1000);
    await endTurn($);
    await clock.advance(20_000); // long past the end of its exhale
    await beginTurn($);
    await clock.advance(1500);
    expect(breathBegin(await sourceNow($))).toBe("-1.5");
  });

  test("fades in when it first shows", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(fadesOf(await sourceNow($))).toEqual([["0", "1", "0.8", "0"]]);
  });

  test("fades out ending as the last exhale does, and does not fade in again", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    expect(fadesOf(await sourceNow($))).toEqual([["0", "1", "0.8", "0"]]);
    await clock.advance(1000);
    await endTurn($); // the exhale ends at 12 s: 11 s from now
    // 0.8 s of fade, which starts 10.2 s from now.
    expect(fadesOf(await sourceNow($))).toEqual([["1", "0", "0.8", "10.2"]]);
  });

  test("fades out in what is left when the last exhale is nearly over", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await sourceNow($);
    await clock.advance(11_500);
    await endTurn($); // 0.5 s to go
    expect(fadesOf(await sourceNow($))).toEqual([["1", "0", "0.5", "0"]]);
  });

  test("is drawn anew when the turn ends, in step with the breath, and does not fade in again", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await sourceNow($);
    await clock.advance(3000);
    await endTurn($);
    const source = await sourceNow($);
    expect(breathBegin(source)).toBe("-3");
    expect(fadesOf(source).map(([from]) => from)).toEqual(["1"]);
  });

  test("shows the note that Claude is done only while it finishes", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const note = async () => (await ui.findAll({ type: "Text" })).map((t) => t.text);
    expect(await note()).toEqual([]);
    await clock.advance(1000);
    await endTurn($);
    expect(await note()).toEqual([DONE]);
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
