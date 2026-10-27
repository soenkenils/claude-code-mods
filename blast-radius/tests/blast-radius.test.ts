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

const SURFACES = ["terminal", "desktop"] as const;
type Surface = (typeof SURFACES)[number];

function pane($: Engine, surface: Surface) {
  return $.ui.mount({
    plugin: "blast-radius",
    surface,
    component: "Pane",
    requestId: "blast-radius",
    props: { title: "Blast Radius", isFocused: true, bodyColumns: 80, placement: "dock", scroll: { offset: 0, bodyRows: 20 }, view: {} },
  });
}

function band($: Engine, surface: Surface, maxRows = 10) {
  return $.ui.mount({
    plugin: "blast-radius",
    surface,
    component: "AbovePrompt",
    props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: 80, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
  });
}

type Drawing = Awaited<ReturnType<typeof pane>> | Awaited<ReturnType<typeof band>>;

async function shown(ui: Drawing) {
  return (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
}

// Calls Bash with a risky command, lets the hook measure it and draw, and hands back the drawing.
async function hold($: Engine, on: On, surface: Surface, command: string, opts: { isPlaced?: boolean; outputs?: Record<string, string>; maxRows?: number } = {}) {
  const { clock, ran } = core(on, opts);
  const call = $.tool.call({ tool: "Bash", command });
  await clock.settle();
  const ui = opts.isPlaced === false ? await band($, surface, opts.maxRows) : await pane($, surface);
  return { clock, ran, call, ui };
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

for (const surface of SURFACES) {
  describe(`on ${surface}`, () => {
    describe("holding a command", () => {
      test("a safe command runs without a pane", async ($, on) => {
        const { ran } = core(on);
        const result = await $.tool.call({ tool: "Bash", command: "ls -la" });
        expect(result.deny).toBe(undefined);
        expect(ran).toEqual(["ls -la"]);
      });

      test("shows what git reset --hard would discard, then runs on Proceed", async ($, on) => {
        const { clock, ran, call, ui } = await hold($, on, surface, "git reset --hard", {
          outputs: { "git status --porcelain --untracked-files=no": " M src/app.ts\n M README.md\n" },
        });
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
        const { clock, ran, call, ui } = await hold($, on, surface, "git clean -fdx", {
          outputs: { "git clean -n -d -x": "Would remove dist/\nWould remove .env.local\n" },
        });
        expect(await shown(ui)).toContain("Removes 2 untracked files");
        await ui.press({ key: "cancel" });
        await clock.advance(250);

        expect((await call).deny).toContain("chose not to run it");
        expect(ran).toEqual([]);
        await ui.unmount();
      });

      test("falls back to the band when the pane cannot be placed", async ($, on) => {
        const { clock, ran, call, ui } = await hold($, on, surface, "git push --force", {
          isPlaced: false,
          outputs: { "git log --oneline HEAD..@{u}": "abc123 Fix login\n" },
        });
        expect(await shown(ui)).toContain("Overwrites 1 commit on the remote");
        await ui.press({ key: "proceed" });
        await clock.advance(250);

        expect((await call).deny).toBe(undefined);
        expect(ran).toEqual(["git push --force"]);
        await ui.unmount();
      });

      test("leaves the band to core while nothing is held", async ($, on) => {
        core(on);
        const ui = await band($, surface);
        expect(await ui.drawn()).toEqual({ type: "engine", ref: 0 });
        await ui.unmount();
      });
    });

    describe("the card", () => {
      test("shows the command as bash code", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git reset --hard HEAD~3");
        const code = await ui.find({ type: "Code" });
        expect(code?.props.source).toBe("git reset --hard HEAD~3");
        expect(code?.props.language).toBe("bash");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("offers Run anyway and Cancel, with Cancel the primary one the focus starts on", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git reset --hard");
        const [proceed, cancel] = await ui.findAll({ type: "Button" });
        expect(proceed?.props).toMatchObject({ label: "Run anyway", hotkey: "1" });
        expect(proceed?.props.autoFocus).toBe(undefined);
        expect(cancel?.props).toMatchObject({ label: "Cancel", hotkey: "2", variant: "primary", autoFocus: true });
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("tells a pane's reader that Esc cancels and that the command is held", async ($, on) => {
        const inPane = await hold($, on, surface, "git reset --hard");
        expect(await shown(inPane.ui)).toContain("Esc cancels");
        expect(await shown(inPane.ui)).toContain("holding this command");
        await inPane.ui.press({ key: "cancel" });
        await inPane.clock.advance(250);
        await inPane.call;
        await inPane.ui.unmount();
      });

      test("a band is a bordered card of its own, without the pane's chrome", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git reset --hard", { isPlaced: false });
        expect(await shown(ui)).not.toContain("Esc cancels");
        const drawn = JSON.stringify(await ui.drawn());
        expect(drawn).toContain('"borderStyle":"round"');
        expect(drawn).toContain('"borderColor":"warning"');
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("danger is red, by theme key", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git reset --hard", {
          outputs: { "git status --porcelain --untracked-files=no": " M a.ts\n" },
        });
        expect((await ui.find({ type: "Text", text: /Discards/ }))?.props.color).toBe("error");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("caution is amber, by theme key", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git reset --hard");
        expect((await ui.find({ type: "Text", text: /working tree is clean/ }))?.props.color).toBe("warning");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });
    });

    describe("what it lists", () => {
      test("an rm shows sizes beside paths and git status beside changed files", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "rm -rf build dist", {
          outputs: {
            "find build dist": "build\nbuild/a.js\ndist\n",
            "du -sh build dist": "812M\tbuild\n4.1M\tdist\n",
            "git status --porcelain -- build dist": " M build/a.js\n D build/old.js\n?? dist\n",
          },
        });
        const text = await shown(ui);
        expect(text).toContain("Deletes 3 files and folders");
        expect(text).toContain("Uncommitted changes in 3 files");
        const sizes = await ui.find({ type: "Text", text: /^812M$/ });
        expect(sizes?.props.dimColor).toBe(true);
        expect((await ui.find({ type: "Text", text: /^M$/ }))?.props.color).toBe("warning");
        expect((await ui.find({ type: "Text", text: /^D$/ }))?.props.color).toBe("error");
        expect((await ui.find({ type: "Text", text: /^\?\?$/ }))?.props.color).toBe("subtle");
        expect(text).toContain("build/old.js");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("an rm of one thing says so in the singular", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "rm -rf tmp", { outputs: { "find tmp": "tmp\n" } });
        expect(await shown(ui)).toContain("Deletes 1 file or folder");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("an rm of nothing that exists says what it could not list instead of claiming zero", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "rm -rf build/*");
        const text = await shown(ui);
        expect(text).toContain("Recursive force delete");
        expect(text).toContain("Globs and variables are not expanded");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a force push lists the commits it would overwrite, hash beside subject", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "git push --force", {
          outputs: { "git log --oneline HEAD..@{u}": "abc123 Fix login\ndef456 Add tests\n" },
        });
        const text = await shown(ui);
        expect(text).toContain("Overwrites 2 commits on the remote");
        expect(text).toContain("def456");
        expect(text).toContain("Add tests");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a django migrate lists what is pending", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "python manage.py migrate", {
          outputs: { "python manage.py showmigrations --plan": "[X]  app.0001_initial\n[ ]  app.0002_add_email\n[ ]  app.0003_drop_name\n" },
        });
        expect(await shown(ui)).toContain("Applies 2 pending migrations");
        expect(await shown(ui)).toContain("app.0003_drop_name");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a django migrate with nothing pending says so", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "python manage.py migrate");
        expect(await shown(ui)).toContain("No pending migrations found");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a long list is cut to the room with a count of the rest", async ($, on) => {
        const files = Array.from({ length: 15 }, (_, i) => `Would remove file${i + 1}.tmp`).join("\n");
        const { clock, call, ui } = await hold($, on, surface, "git clean -fd", { outputs: { "git clean -n -d": files } });
        const text = await shown(ui);
        // A pane with no measured height has 24 rows: 10 for the list, one of them for the count.
        expect(text).toContain("file9.tmp");
        expect(text).not.toContain("file10.tmp");
        expect(text).toContain("… and 6 more");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a band keeps a shorter list so the buttons stay in view", async ($, on) => {
        const files = Array.from({ length: 15 }, (_, i) => `Would remove file${i + 1}.tmp`).join("\n");
        const { clock, call, ui } = await hold($, on, surface, "git clean -fd", {
          isPlaced: false,
          maxRows: 10,
          outputs: { "git clean -n -d": files },
        });
        const text = await shown(ui);
        expect(text).toContain("file2.tmp");
        expect(text).not.toContain("file3.tmp");
        expect(text).toContain("… and 13 more");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });
    });
  });
}
