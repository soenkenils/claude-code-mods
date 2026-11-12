import type { EngineInterface } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { clearAsked, commandFailed } from "../hooks/breathe";

// The engine runs a `.catch` only for a hook that throws, and the kit has no way to make one throw
// (the hooks only touch host state), so these call the catch handlers directly with a minimal `$`.
function stub(fails: boolean) {
  const sets: unknown[] = [];
  const $ = {
    state: {
      get: async () => {
        if (fails) throw new Error("state down");
        return { value: true, version: 1 };
      },
      set: async (_ref: unknown, value: unknown) => {
        sets.push(value);
        return { isSet: true, version: 2 };
      },
    },
  } as unknown as EngineInterface;
  return { $, sets };
}

describe("the question hook's catch", () => {
  test("clears the asked flag and passes the call on once", async () => {
    const { $, sets } = stub(false);
    const seen: string[] = [];
    const result = await clearAsked($, "e", (e) => (seen.push(e), "beneath"));
    expect(sets).toEqual([false]);
    expect(result).toBe("beneath");
    expect(seen).toEqual(["e"]);
  });

  test("still passes the call on when clearing the flag fails", async () => {
    const { $, sets } = stub(true);
    const seen: string[] = [];
    const result = await clearAsked($, "e", (e) => (seen.push(e), "beneath"));
    expect(sets).toEqual([]);
    expect(result).toBe("beneath");
    expect(seen).toEqual(["e"]);
  });
});

describe("the /breathe command's catch", () => {
  test("answers that the session carries on", () => {
    expect(commandFailed()).toEqual({ text: "Breathe failed to answer. The session carries on." });
  });
});
