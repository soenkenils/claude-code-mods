import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { classify } from "../hooks/classify";

const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false });

// What sits beneath the plugin in a session: the shell, git, the panes and Bash itself.
function core(on: On, { isPlaced = true, outputs = {} as Record<string, string> } = {}) {
  const clock = mock.clock(on);
  const ran: string[] = [];
  on("session.cwd", () => ({ value: "/repo" }));
  on("process.run", async (_$, e) => {
    if (e.argv[0] === "sleep") {
      await clock.sleep(250);
      return { value: ok() };
    }
    const line = e.argv.join(" ");
    return { value: ok(outputs[line] ?? "") };
  });
  on("ui.open", () => ({ value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: "narrow" } }));
  on("ui.close", () => ({ value: undefined }));
  on("ui.render", { component: "AbovePrompt" }, () => ({ type: "engine", ref: 0 }));
  on("tool.call", { tool: "Bash" }, (_$, e) => {
    ran.push(String(e.command));
    return { result: { stdout: "done", stderr: "", interrupted: false } } as never;
  });
  return { clock, ran };
}

function pane($: Engine) {
  return $.ui.mount({
    plugin: "blast-radius",
    surface: "terminal",
    component: "Pane",
    requestId: "blast-radius",
    props: { title: "Blast Radius", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  });
}

function band($: Engine) {
  return $.ui.mount({
    plugin: "blast-radius",
    surface: "terminal",
    component: "AbovePrompt",
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  });
}

async function shown(ui: Awaited<ReturnType<typeof pane>>) {
  return (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
}

describe("classify", () => {
  for (const command of [
    "rm -rf build",
    "rm -fr node_modules dist",
    "rm -r -f tmp",
    "sudo rm --recursive --force /var/cache/app",
    "cd app && git reset --hard HEAD~1",
    "git clean -fdx",
    "git push --force origin main",
    "git push -f",
    "git push --force-with-lease",
    "python manage.py migrate",
    "bin/rails db:migrate",
    "npx prisma migrate deploy",
  ]) {
    test(`holds: ${command}`, async () => {
      expect(classify(command)).not.toBe(null);
    });
  }

  for (const command of ["rm file.txt", "rm -r empty-dir", "git reset HEAD~1", "git clean -n", "git push origin main", "ls -la", "echo rm -rf"]) {
    test(`lets through: ${command}`, async () => {
      expect(classify(command)).toBe(null);
    });
  }
});

describe("holding a command", () => {
  test("a safe command runs without a pane", async ($, on) => {
    const { ran } = core(on);
    const result = await $.tool.call({ tool: "Bash", command: "ls -la" });
    expect(result.deny).toBe(undefined);
    expect(ran).toEqual(["ls -la"]);
  });

  test("shows what git reset --hard would discard, then runs on Proceed", async ($, on) => {
    const { clock, ran } = core(on, { outputs: { "git status --porcelain --untracked-files=no": " M src/app.ts\n M README.md\n" } });
    const call = $.tool.call({ tool: "Bash", command: "git reset --hard" });
    await clock.settle();

    const ui = await pane($);
    const text = await shown(ui);
    expect(text).toContain("Discards uncommitted changes in 2 files");
    expect(text).toContain("src/app.ts");
    expect(ran).toEqual([]);

    await ui.press({ key: "proceed" });
    await clock.advance(250);
    expect((await call).deny).toBe(undefined);
    expect(ran).toEqual(["git reset --hard"]);
    await ui.unmount();
 });

  test("Cancel denies the call and never runs it", async ($, on) => {
    const { clock, ran } = core(on, { outputs: { "git clean -n -d -x": "Would remove dist/\nWould remove .env.local\n" } });
    const call = $.tool.call({ tool: "Bash", command: "git clean -fdx" });
    await clock.settle();

    const ui = await pane($);
    expect(await shown(ui)).toContain("Removes 2 untracked files");
    await ui.press({ key: "cancel" });
    await clock.advance(250);

    expect((await call).deny).toContain("chose not to run it");
    expect(ran).toEqual([]);
    await ui.unmount();
  });

  test("falls back to the band when the pane cannot be placed", async ($, on) => {
    const { clock, ran } = core(on, { isPlaced: false, outputs: { "git log --oneline HEAD..@{u}": "abc123 Fix login\n" } });
    const call = $.tool.call({ tool: "Bash", command: "git push --force" });
    await clock.settle();

    const ui = await band($);
    expect(await shown(ui)).toContain("Overwrites 1 commits on the remote");
    await ui.press({ key: "proceed" });
    await clock.advance(250);

    expect((await call).deny).toBe(undefined);
    expect(ran).toEqual(["git push --force"]);
    await ui.unmount();
  });

  test("leaves the band to core while nothing is held", async ($, on) => {
    core(on);
    const ui = await band($);
    expect(await ui.drawn()).toEqual({ type: "engine", ref: 0 });
    await ui.unmount();
  });
});
