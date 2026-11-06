import { describe, expect, test } from "claude-code/testing";

import { box, countdownAt, countdownMs, cycleMs, frameAt, isPatternId, patternOf, restAt, timing } from "../hooks/pacer";

const SECOND = 1000;

// The kit has no toBeCloseTo.
const close = (actual: number, expected: number, within = 1e-6) => expect(Math.abs(actual - expected)).toBeLessThan(within);

describe("box breathing", () => {
  test("is in, hold, out, hold, each the same length", () => {
    const pattern = box(4);
    expect(pattern.phases.map((p) => p.kind)).toEqual(["in", "holdIn", "out", "holdOut"]);
    expect(pattern.phases.map((p) => p.ms)).toEqual([4000, 4000, 4000, 4000]);
    expect(cycleMs(pattern)).toBe(16_000);
  });

  test("takes its phase length from the setting", () => {
    expect(cycleMs(box(2.5))).toBe(10_000);
  });
});

describe("the other patterns", () => {
  test("box is the box pattern, and its timing reads 4-4-4-4", () => {
    expect(patternOf("box", 4)).toEqual(box(4));
    expect(timing(box(4))).toBe("4-4-4-4");
  });

  test("even is in and out, each the phase length, with no holds", () => {
    const even = patternOf("even", 4);
    expect(even.phases.map((p) => p.kind)).toEqual(["in", "out"]);
    expect(cycleMs(even)).toBe(8000);
    expect(frameAt(even, 4000).kind).toBe("out");
    expect(frameAt(even, 8000).kind).toBe("in");
    expect(timing(even)).toBe("4-4");
  });

  test("calm lets the breath out take 1.5 times as long", () => {
    const calm = patternOf("calm", 4);
    expect(calm.phases.map((p) => p.ms)).toEqual([4000, 6000]);
    expect(timing(calm)).toBe("4-6");
    expect(timing(patternOf("calm", 3))).toBe("3-4.5");
  });

  test("a breath with no hold after it finishes at the end of its exhale", () => {
    const calm = patternOf("calm", 4);
    expect(restAt(calm, 0, 1 * SECOND)).toBe(10 * SECOND);
    expect(restAt(calm, 0, 9 * SECOND)).toBe(10 * SECOND);
  });

  test("knows its names", () => {
    expect(["box", "even", "calm"].every(isPatternId)).toBe(true);
    expect(isPatternId("square")).toBe(false);
    expect(isPatternId(4)).toBe(false);
  });
});

describe("the frame", () => {
  const pattern = box(4);

  test("walks through the four phases", () => {
    expect(frameAt(pattern, 0).kind).toBe("in");
    expect(frameAt(pattern, 3999).kind).toBe("in");
    expect(frameAt(pattern, 4000).kind).toBe("holdIn");
    expect(frameAt(pattern, 8000).kind).toBe("out");
    expect(frameAt(pattern, 12_000).kind).toBe("holdOut");
    expect(frameAt(pattern, 15_999).kind).toBe("holdOut");
  });

  test("starts again after the last hold", () => {
    expect(frameAt(pattern, 16_000)).toMatchObject({ kind: "in", index: 0, fill: 0 });
    expect(frameAt(pattern, 16_000 * 5 + 9000).kind).toBe("out");
  });

  test("fills the lungs while breathing in, keeps them full, empties them while breathing out", () => {
    expect(frameAt(pattern, 0).fill).toBe(0);
    close(frameAt(pattern, 2000).fill, 0.5);
    expect(frameAt(pattern, 4000).fill).toBe(1);
    expect(frameAt(pattern, 6000).fill).toBe(1);
    expect(frameAt(pattern, 8000).fill).toBe(1);
    close(frameAt(pattern, 10_000).fill, 0.5);
    expect(frameAt(pattern, 12_000).fill).toBe(0);
    expect(frameAt(pattern, 14_000).fill).toBe(0);
  });

  test("moves slowly at both ends of a breath, quickly in the middle", () => {
    const early = frameAt(pattern, 400).fill - frameAt(pattern, 0).fill;
    const middle = frameAt(pattern, 2200).fill - frameAt(pattern, 1800).fill;
    expect(middle).toBeGreaterThan(early * 5);
  });

  test("never goes outside empty and full", () => {
    for (let ms = 0; ms < 32_000; ms += 137) {
      const { fill } = frameAt(pattern, ms);
      expect(fill).toBeGreaterThanOrEqual(0);
      expect(fill).toBeLessThanOrEqual(1);
    }
  });

  test("counts the seconds left in the phase down to 1, never to 0", () => {
    expect([0, 1000, 2000, 3000, 3999].map((ms) => frameAt(pattern, ms).secondsLeft)).toEqual([4, 3, 2, 1, 1]);
    expect(frameAt(pattern, 4000).secondsLeft).toBe(4);
  });

  test("says how far into the phase it is", () => {
    close(frameAt(pattern, 5000).progress, 0.25);
  });
});

describe("finishing a breath", () => {
  const pattern = box(4);

  test("runs on to the end of the exhale, wherever in the breath the turn ended", () => {
    for (const at of [0, 1 * SECOND, 5 * SECOND, 8 * SECOND, 9 * SECOND, 11.9 * SECOND]) {
      expect(restAt(pattern, 0, at)).toBe(12 * SECOND);
    }
  });

  test("is already there in the hold after the exhale, and ends at once", () => {
    for (const at of [12 * SECOND, 13 * SECOND, 15.9 * SECOND]) {
      expect(restAt(pattern, 0, at)).toBe(at);
    }
  });

  test("counts from when the animation began and from the breath it is in", () => {
    // Began at 100 s; at 118 s it is 18 s in, two seconds into the second breath.
    expect(restAt(pattern, 100 * SECOND, 118 * SECOND)).toBe(128 * SECOND);
    // 30 s in: 14 s into the second breath, in its last hold.
    expect(restAt(pattern, 100 * SECOND, 130 * SECOND)).toBe(130 * SECOND);
  });

  test("follows the phase length", () => {
    expect(restAt(box(2), 0, 1 * SECOND)).toBe(6 * SECOND);
  });
});

describe("the countdown", () => {
  test("takes a second for each number from the start down to 0", () => {
    expect(countdownMs(3)).toBe(4 * SECOND);
    expect(countdownMs(1)).toBe(2 * SECOND);
    expect(countdownMs(10)).toBe(11 * SECOND);
  });

  test("is none for 0 or less", () => {
    expect(countdownMs(0)).toBe(0);
    expect(countdownMs(-2)).toBe(0);
  });

  test("shows each number for its second, ending on 0 just before the breath", () => {
    // `until` is how long the breath is still away: 4 s at the start of a countdown from 3.
    expect(countdownAt(4000)).toBe(3);
    expect(countdownAt(3001)).toBe(3);
    expect(countdownAt(3000)).toBe(2);
    expect(countdownAt(2000)).toBe(1);
    expect(countdownAt(1001)).toBe(1);
    expect(countdownAt(1000)).toBe(0);
    expect(countdownAt(1)).toBe(0);
  });
});
