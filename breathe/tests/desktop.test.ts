import { describe, expect, test } from "claude-code/testing";

import { noWait, noCountdown, EN, DONE, core, start, beginTurn, endTurn, band, words, hide, pictureOf, sourceOf, sourceNow, breathBegin, fadesOf, READY } from "./helpers";

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

  test("is one line high: the picture is 24 px high, with no seconds and no pattern hint", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).toContain('height="24"');
    expect(await words($, "desktop")).not.toMatch(/Box Breathing|4-4-4-4| s\b/);
  });

  // Claude Desktop gives a picture's frame with no size 300 by 150 px, whatever the markup says,
  // and fits the picture into it: so the element says the size itself.
  test("gives the element the picture's own size, so the app does not pick one", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const picture = await pictureOf(ui);
    const source = String(picture?.props.source);
    const own = { width: Number(/ width="([\d.]+)"/.exec(source)?.[1]), height: Number(/ height="([\d.]+)"/.exec(source)?.[1]) };
    expect(own.height).toBe(24);
    expect(own.width).toBeGreaterThan(24 * 4);
    expect(picture?.props.height).toBe(own.height);
    expect(picture?.props.width).toBe(own.width);
    await ui.unmount();
  });

  test("keeps the frame's size through a run, so the band does not jump", noWait(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const size = async () => {
      const props = (await pictureOf(ui))?.props;
      return [props?.width, props?.height];
    };
    const counting = await size();
    expect(counting[1]).toBe(24);
    await clock.advance(6000); // the countdown is over, the breath is under way
    expect(await size()).toEqual(counting);
    await endTurn($);
    expect(await size()).toEqual(counting);
    await ui.unmount();
  });

  test("puts the close control at the far end of the band, as a cross named by its label", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    const row = (await ui.drawn()) as { props?: unknown; children?: Array<{ type: string; props?: Record<string, unknown>; children?: unknown[] }> };
    const cells = row.children?.[0]?.children as Array<{ type: string; props?: Record<string, unknown>; children?: unknown[] }> | undefined;
    expect(cells?.map((c) => c.type)).toEqual(["Svg", "Box", "Button"]);
    // The Box between them takes what is left of the row.
    expect(cells?.[1]?.props?.flexGrow).toBe(1);
    const button = await hide(ui);
    expect(button?.props.label).toBe("Ausblenden");
    expect(button?.props.role).toBe("dismiss");
    expect(button?.text).toBe("✕");
    await ui.unmount();
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
    const ui = await band($, "desktop"); // on screen all along, so it is drawn about once a second
    await clock.advance(11_500);
    await endTurn($); // 0.5 s to go
    expect(fadesOf(await sourceOf(ui))).toEqual([["1", "0", "0.5", "0"]]);
    await ui.unmount();
  });

  test("is drawn anew when the turn ends, in step with the breath, and does not fade in again", noCountdown(), async ($, on) => {
    const clock = core(on);
    await start($);
    await beginTurn($);
    const ui = await band($, "desktop");
    await clock.advance(3000);
    await endTurn($);
    const source = await sourceOf(ui);
    expect(breathBegin(source)).toBe("-3");
    expect(fadesOf(source).map(([from]) => from)).toEqual(["1"]);
    await ui.unmount();
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

describe("the desktop picture's settings", () => {
  test("motion reduced draws no moving orb at all", noCountdown({ motion: "reduced" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).not.toContain('class="move"');
    expect(source).not.toContain("<animateTransform");
    expect(source).not.toContain("<style>");
    expect(source).toContain('<g class="still">');
  });

  test("motion auto leaves it to the system", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    const source = await sourceNow($);
    expect(source).toContain('class="move"');
    expect(source).toContain('class="still" display="none"');
  });

  test("a theme gives the words a color made for it", noCountdown({ theme: "dark" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await sourceNow($)).toContain('fill="#DAD8D2"');
  });

  test("a light theme the other", noCountdown({ theme: "light" }), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await sourceNow($)).toContain('fill="#4A4944"');
  });

  test("and by default a grey for either", noCountdown(), async ($, on) => {
    core(on);
    await start($);
    await beginTurn($);
    expect(await sourceNow($)).toContain('fill="#8A8985"');
  });
});
