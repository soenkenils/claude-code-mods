import type { On } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { SURFACES, noWait, noCountdown, DE, DONE, core, start, beginTurn, endTurn, slash, band, words, ENGINE, isEngine, isShown, hide, sourceOf, fadesOf } from "./helpers";

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
      expect((await slash($)).text).toContain("Breathe is on.");
      await endTurn($);
      await beginTurn($);
      await isShown(await band($, surface));
    });

    test("explains a command it does not know", noCountdown(), async ($, on) => {
      core(on);
      await start($);
      expect((await slash($, "sideways")).text).toBe("Usage: /breathe [on|off|box|even|calm]");
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
        expect((await slash($)).text).toContain("Breathe is on.");
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

describe("how often the band is drawn", () => {
  // Every draw of the band hears `below`: count them.
  function counting(on: On) {
    const drawn = { count: 0 };
    return { drawn, clock: core(on, () => ((drawn.count += 1), ENGINE)) };
  }

  test("is ten times a second for a line of text", noCountdown(), async ($, on) => {
    const { drawn, clock } = counting(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "terminal");
    drawn.count = 0;
    await clock.advance(5000);
    expect(drawn.count).toBeGreaterThanOrEqual(45);
    await ui.unmount();
  });

  test("is about once a second for the desktop's picture, which moves by itself", noCountdown(), async ($, on) => {
    const { drawn, clock } = counting(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    await clock.advance(500);
    drawn.count = 0;
    await clock.advance(5000);
    expect(drawn.count).toBeGreaterThanOrEqual(3);
    expect(drawn.count).toBeLessThanOrEqual(10);
    // And the picture is the one it was.
    await isShown(ui);
    await ui.unmount();
  });

  test("goes back to ten times a second when a line of text is drawn", noCountdown(), async ($, on) => {
    const { drawn, clock } = counting(on);
    await start($);
    await beginTurn($);
    const picture = await band($, "desktop");
    await clock.advance(3000);
    // The window is made narrow: the band is a line of text now.
    const narrow = await band($, "desktop", { bodyColumns: 30 });
    await clock.advance(2000); // a draw within a second finds the line
    drawn.count = 0;
    await clock.advance(3000);
    expect(drawn.count).toBeGreaterThanOrEqual(25);
    await narrow.unmount();
    await picture.unmount();
  });

  for (const after of [0, 300, 700]) {
    test(`the band appears when it is due, with no wait for the next draw (${after} ms in)`, noWait({ startAfterSeconds: 2.5 }), async ($, on) => {
      const clock = core(on);
      await start($);
      // A first run, to have drawn the picture once: from then on the draws are few.
      await beginTurn($);
      await clock.advance(6000);
      await band($, "desktop").then((ui) => ui.unmount());
      await endTurn($);
      await clock.advance(20_000 + after);

      await beginTurn($);
      await clock.advance(2400);
      await isEngine(await band($, "desktop"));
      await clock.advance(200); // 2.6 s: the countdown has begun
      const ui = await band($, "desktop");
      await isShown(ui);
      expect(await sourceOf(ui)).toContain("Mach dich bereit");
      await ui.unmount();
    });
  }
});

describe("speaking the phases", () => {
  function voice(on: On, fails = false) {
    const said: string[] = [];
    on("audio.speak", (_$, e) => {
      said.push(e.text);
      if (fails) throw new Error("no voice");
      return { value: { via: "system" } } as never;
    });
    return said;
  }

  test("is off unless asked for", noCountdown(), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(20_000);
    expect(said).toEqual([]);
  });

  test("says each phase once as it begins", noCountdown({ speak: true }), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(300);
    expect(said).toEqual(["Einatmen"]);
    await clock.advance(3700); // 4 s
    await clock.advance(300);
    expect(said).toEqual(["Einatmen", "Halten"]);
    await clock.advance(12_000); // 16.3 s: a second cycle
    expect(said).toEqual(["Einatmen", "Halten", "Ausatmen", "Halten", "Einatmen"]);
  });

  test("says the breath in only when the countdown is over", noWait({ speak: true }), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(3900);
    expect(said).toEqual([]);
    await clock.advance(400);
    expect(said).toEqual(["Einatmen"]);
  });

  test("speaks the labels' language", noCountdown({ speak: true, language: "en" }), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(8300);
    expect(said).toEqual(["Breathe in", "Hold", "Breathe out"]);
  });

  test("goes on through the wind-down and stops with the breath", noCountdown({ speak: true }), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await endTurn($);
    await clock.advance(11_000 + 3000); // past the end of the exhale at 12 s
    expect(said).toEqual(["Einatmen", "Halten", "Ausatmen"]);
  });

  test("keeps quiet after Hide", noCountdown({ speak: true }), async ($, on) => {
    const clock = core(on);
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(300);
    const ui = await band($, "desktop");
    await ui.press({ key: "hide" });
    await clock.advance(20_000);
    expect(said).toEqual(["Einatmen"]);
    await ui.unmount();
  });

  test("keeps quiet while a question waits", noCountdown({ speak: true }), async ($, on) => {
    const clock = core(on);
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    on("tool.call", async () => {
      await answered;
      return { result: {}, text: "A" } as never;
    });
    const said = voice(on);
    await start($);
    await beginTurn($);
    await clock.advance(300);
    const asked = $.tool.call({ tool: "AskUserQuestion", questions: [] });
    await clock.advance(9000);
    expect(said).toEqual(["Einatmen"]);
    answer();
    await asked;
  });

  test("lets it be where there is no voice: the band goes on", noCountdown({ speak: true }), async ($, on) => {
    const clock = core(on);
    const said = voice(on, true);
    await start($);
    await beginTurn($);
    await clock.advance(5000);
    expect(said).toEqual(["Einatmen", "Halten"]);
    expect(await words($, "terminal")).toContain(DE.hold);
  });
});
