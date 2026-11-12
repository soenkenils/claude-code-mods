import type { On } from "claude-code";
import { describe, expect, test, type Engine } from "claude-code/testing";

import { SURFACES, noCountdown, DE, core, start, beginTurn, endTurn, slash, band, words, isEngine, isShown, sourceNow, breathBegin, fadesOf } from "./helpers";

describe("/breathe with a pattern", () => {
  const hint = async ($: Engine) => words($, "terminal");

  test("picks the pattern for the next turns, and says so", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    const answer = (await slash($, "calm")).text;
    expect(answer).toContain("Ruhiges Atmen · 4-6");
    expect(answer).toContain("from the next turn");
    await beginTurn($);
    expect(await hint($)).toContain("Ruhiges Atmen · 4-6");
  });

  test("is drawn by the desktop's picture too: a cycle of 10 s, not 16", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await slash($, "calm");
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).toContain('dur="10s"');
    expect(source).not.toContain('dur="16s"');
  });

  test("is not taken up by a breath that is under way: that one finishes as it began", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    await clock.advance(1000);
    await slash($, "even");
    expect(await hint($)).toContain("Box Breathing · 4-4-4-4");
    await clock.advance(5000);
    expect(await hint($)).toContain("Box Breathing");
    // It is the next run that breathes it.
    await endTurn($);
    await clock.advance(20_000);
    await beginTurn($);
    expect(await hint($)).toContain("Gleichmäßiges Atmen · 4-4");
  });

  test("goes on to the turn after next, and /breathe says which it is", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    expect((await slash($)).text).toBe("Breathe is on. Pattern: Box Breathing · 4-4-4-4.");
    await slash($, "calm");
    expect((await slash($)).text).toBe("Breathe is on. Pattern: Ruhiges Atmen · 4-6.");
    for (let turn = 0; turn < 2; turn++) {
      await beginTurn($);
      expect(await hint($)).toContain("Ruhiges Atmen");
      await endTurn($);
      await clock.advance(20_000);
    }
  });

  test("takes the phase length from phaseSeconds, and the labels' language", noCountdown({ phaseSeconds: 2, language: "en" }), async ($, on) => {
    core(on);
    await start($);
    expect((await slash($, "EVEN")).text).toContain("Even Breathing · 2-2");
    await beginTurn($);
    expect(await hint($)).toContain("Even Breathing · 2-2");
  });

  test("finishes a run in its own pattern: a calm breath ends at the end of its long exhale", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await slash($, "calm");
    await beginTurn($);
    await clock.advance(1000);
    await endTurn($);
    await clock.advance(8900);
    await isShown(await band($, "desktop"));
    await clock.advance(200);
    await isEngine(await band($, "desktop"));
  });

  test("does not unmute it", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await slash($, "off");
    expect((await slash($, "calm")).text).toContain("Breathe is still off");
    await beginTurn($);
    await isEngine(await band($, "terminal"));
  });

  test("keeps the setting's pattern until one is picked", noCountdown({ pattern: "calm" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await hint($)).toContain("Ruhiges Atmen · 4-6");
  });
});

describe("while Claude asks a question", () => {
  // A question (the AskUserQuestion tool) is a call that waits for the person's answer.
  function question(on: On) {
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    on("tool.call", async () => {
      await answered;
      return { result: {}, text: "A" } as never;
    });
    return () => answer();
  }
  const ask = ($: Engine, agentId?: string) => $.tool.call({ tool: "AskUserQuestion", questions: [], ...(agentId ? { agentId } : {}) });

  for (const surface of SURFACES) {
    test(`the band steps aside until it is answered, on ${surface}`, noCountdown(), async ($, on) => {
      const clock = core(on);
      const answer = question(on);
      await start($);
      await beginTurn($);
      const ui = await band($, surface);
      await isShown(ui);
      const asked = ask($);
      await clock.advance(500);
      await isEngine(ui);
      await clock.advance(5000);
      await isEngine(ui);
      answer();
      await asked;
      await isShown(ui);
      await ui.unmount();
    });
  }

  test("and the breath goes on behind it: it is in the phase the clock says when it is back", noCountdown(), async ($, on) => {
    const clock = core(on);
    const answer = question(on);
    await start($);
    await beginTurn($);
    const asked = ask($);
    await clock.advance(9000); // asked at 0 s, answered at 9 s: breathing out
    answer();
    await asked;
    expect(await words($, "terminal")).toContain(DE.out);
  });

  test("and the desktop's picture is drawn afresh, in step with the breath, and fades in again", noCountdown(), async ($, on) => {
    const clock = core(on);
    const answer = question(on);
    await start($);
    await beginTurn($);
    expect(breathBegin(await sourceNow($))).toBe("0");
    const asked = ask($);
    await clock.advance(9000);
    answer();
    await asked;
    const source = await sourceNow($);
    expect(breathBegin(source)).toBe("-9");
    expect(fadesOf(source)).toEqual([["0", "1", "0.8", "0"]]);
  });

  test("is back when the call fails", noCountdown(), async ($, on) => {
    core(on);
    on("tool.call", async () => {
      throw new Error("no dialog");
    });
    await start($);
    await beginTurn($);
    await ask($).catch(() => undefined);
    await isShown(await band($, "terminal"));
  });

  test("is not for a subagent's question", noCountdown(), async ($, on) => {
    const clock = core(on);
    question(on);
    await start($);
    await beginTurn($);
    void ask($, "agent-1");
    await clock.advance(500);
    await isShown(await band($, "terminal"));
  });

  test("does not touch other tools' calls", noCountdown(), async ($, on) => {
    const clock = core(on);
    on("tool.call", async () => ({ result: {}, text: "ok" }) as never);
    await start($);
    await beginTurn($);
    await $.tool.call({ tool: "Bash", command: "ls" });
    await clock.advance(500);
    await isShown(await band($, "terminal"));
  });

  test("a survey does the same: the band is drawn afresh when it is over", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    expect(breathBegin(await sourceNow($))).toBe("0");
    await clock.advance(2000);
    await isEngine(await band($, "desktop", { hasSurvey: true }));
    await clock.advance(1000);
    const source = await sourceNow($);
    expect(breathBegin(source)).toBe("-3");
    expect(fadesOf(source)).toEqual([["0", "1", "0.8", "0"]]);
  });
});
