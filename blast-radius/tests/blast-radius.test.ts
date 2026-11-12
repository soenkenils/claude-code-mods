import type { On } from "claude-code";
import { describe, expect, mock, test, type Engine } from "claude-code/testing";

import { classify, refusalAfterFailure } from "../hooks/classify";

const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false });

// What sits beneath the plugin in a session: the shell, git, the panes and Bash itself.
function core(on: On, { isPlaced = true, outputs = {} as Record<string, string>, exits = {} as Record<string, number>, cwdThrows = false, closeThrows = false } = {}) {
  const clock = mock.clock(on);
  const ran: string[] = [];
  const toasts: string[] = [];
  const notes: string[] = [];
  on("ui.toast", (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.notify", (_$, e) => {
    notes.push(e.text);
    return { value: { isSent: true as const, channel: "kitty" as const } };
  });
  on("session.cwd", () => {
    if (cwdThrows) throw new Error("no cwd");
    return { value: "/repo" };
  });
  on("process.run", async (_$, e) => {
    if (e.argv[0] === "sleep") {
      await clock.sleep(250);
      return { value: ok() };
    }
    const line = e.argv.join(" ");
    return { value: { ...ok(outputs[line] ?? ""), exitCode: exits[line] ?? 0 } };
  });
  on("ui.open", () => ({ value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: "narrow" } }));
  on("ui.close", () => {
    if (closeThrows) throw new Error("close failed");
    return { value: undefined };
  });
  on("ui.render", { component: "AbovePrompt" }, () => ({ type: "engine", ref: 0 }));
  on("tool.call", { tool: "Bash" }, (_$, e) => {
    ran.push(String(e.command));
    return { result: { stdout: "done", stderr: "", interrupted: false } } as never;
  });
  return { clock, ran, toasts, notes };
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

function band($: Engine, surface: Surface, maxRows = 10, isCollapsed = false) {
  return $.ui.mount({
    plugin: "blast-radius",
    surface,
    component: "AbovePrompt",
    props: { hasSurvey: false, isCollapsed, isWorking: true, maxRows, bodyColumns: 80, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
  });
}

type Drawing = Awaited<ReturnType<typeof pane>> | Awaited<ReturnType<typeof band>>;

async function shown(ui: Drawing) {
  return (await ui.findAll({ type: "Text" })).map((t) => t.text).join("\n");
}

// Calls Bash with a risky command, lets the hook measure it and draw, and hands back the drawing.
async function hold($: Engine, on: On, surface: Surface, command: string, opts: { isPlaced?: boolean; outputs?: Record<string, string>; exits?: Record<string, number>; maxRows?: number; closeThrows?: boolean; isCollapsed?: boolean } = {}) {
  const { clock, ran, toasts, notes } = core(on, opts);
  const call = $.tool.call({ tool: "Bash", command });
  await clock.settle();
  const ui = opts.isPlaced === false ? await band($, surface, opts.maxRows, opts.isCollapsed) : await pane($, surface);
  return { clock, ran, call, ui, toasts, notes };
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
    // combined short flags that contain f
    "git push -fu origin main",
    "git push -uf origin",
    // command prefixes and wrappers
    "sudo -u root rm -rf x",
    "sudo -E rm -rf x",
    "env FOO=1 rm -rf x",
    "env -u FOO rm -rf x",
    "time rm -rf x",
    "command rm -rf x",
    "\\rm -rf x",
    "/bin/rm -rf x",
    "/usr/bin/git reset --hard",
    "FOO=1 sudo rm -rf x",
    // git global options before the subcommand
    "git -C /x reset --hard",
    "git -c a=b push --force",
    "git --no-pager -C /x clean -fd",
    // migrations
    "./manage.py migrate",
    "python3 ./manage.py migrate",
    "sequelize db:migrate",
    "npx sequelize-cli db:migrate",
    "npx sequelize-cli db:migrate:undo",
    "bundle exec rake db:migrate",
    // other separators and groups
    "sleep 1 & rm -rf x",
    "(rm -rf x)",
    "{ rm -rf x; }",
    "echo a\nrm -rf x",
    // a shell asked to run a string
    "bash -c 'rm -rf x'",
    'sh -c "git reset --hard"',
    "bash -lc 'cd app && rm -rf x'",
    // a separator inside the string, and the string itself holds a risky command line
    "bash -c 'cd x; rm -rf y'",
    'sh -c "a && git reset --hard"',
    // quotes closed before the real separator
    "echo 'a' && rm -rf x",
    'git commit -m "a" ; rm -rf x',
  ]) {
    test(`holds: ${command}`, async () => {
      expect(classify(command)).not.toBe(null);
    });
  }

  for (const command of [
    "rm file.txt",
    "rm -r empty-dir",
    "rm -f x",
    "git reset HEAD~1",
    "git clean -n",
    "git push origin main",
    "git push -u origin main",
    "git -C /x status",
    "sudo -u root ls",
    "sudo ls -rf",
    "env FOO=1 ls",
    "ls -la",
    "echo rm -rf",
    "echo 'rm -rf x'",
    // a separator inside quotes does not split
    'git commit -m "a; rm -rf x"',
    'echo "a && rm -rf x"',
    "echo 'x | rm -rf y'",
    "echo 'a\nrm -rf x'",
    "cmd 2>&1",
    "bash -c 'ls'",
    "bash script.sh",
    "bundle exec rspec",
    "npx sequelize-cli db:seed",
  ]) {
    test(`lets through: ${command}`, async () => {
      expect(classify(command)).toBe(null);
    });
  }

  // Known gaps, pinned so the README stays true: the command text is all it reads.
  for (const command of ["echo $(rm -rf x)", "xargs rm -rf < list", "npm run migrate", "find . -delete", "x=$(git reset --hard)", "alias nuke='rm -rf'; nuke x"]) {
    test(`still slips past: ${command}`, async () => {
      expect(classify(command)).toBe(null);
    });
  }

  test("a quoted target is one target, without its quotes", () => {
    expect(classify('rm -rf "my dir"')).toEqual({ kind: "rm", targets: ["my dir"] });
    expect(classify("rm -rf 'a b' c")).toEqual({ kind: "rm", targets: ["a b", "c"] });
  });

  test("the rm targets exclude group closers and flags", () => {
    expect(classify("(rm -rf x y)")).toEqual({ kind: "rm", targets: ["x", "y"] });
    expect(classify("/bin/rm -rf x")).toEqual({ kind: "rm", targets: ["x"] });
    // A closer that belongs to the target itself stays.
    expect(classify("rm -rf ${DIR}")).toEqual({ kind: "rm", targets: ["${DIR}"] });
    expect(classify("rm -rf $(pwd)")).toEqual({ kind: "rm", targets: ["$(pwd)"] });
  });
});

describe("refusalAfterFailure", () => {
  const throwFailure = { kind: "throw", message: "boom", budget: 1000 } as const;
  const timeoutFailure = { kind: "timeout", budget: 1000 } as const;

  test("a safe command is not refused", () => {
    expect(refusalAfterFailure("ls -la", throwFailure)).toBe(null);
  });

  test("a risky command is refused, with the reason", () => {
    expect(refusalAfterFailure("rm -rf build", throwFailure)).toContain("check failed (boom)");
  });

  test("a timeout without a message reads well", () => {
    const deny = refusalAfterFailure("rm -rf build", timeoutFailure);
    expect(deny).toContain("check timed out");
    expect(deny).not.toContain("undefined");
  });

  test("a timeout with a message gives it", () => {
    expect(refusalAfterFailure("rm -rf build", { ...timeoutFailure, message: "slow" })).toContain("check timed out (slow)");
  });

  test("a command that cannot be classified is refused", () => {
    expect(refusalAfterFailure(undefined as never, throwFailure)).toContain("check failed");
  });
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

      test("a collapsed band tells the person once that a command waits, and how to answer", async ($, on) => {
        const { clock, call, ui, toasts, notes } = await hold($, on, surface, "git reset --hard", { isPlaced: false, isCollapsed: true });
        const again = await band($, surface, 10, true);
        await clock.settle();
        expect(toasts).toHaveLength(1);
        expect(notes).toHaveLength(1);
        expect(toasts[0]).toContain("git reset --hard");
        expect(toasts[0]).toContain("ctrl+x ctrl+a");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        expect((await call).deny).toContain("chose not to run it");
        await again.unmount();
        await ui.unmount();
      });

      test("the next hold tells again", async ($, on) => {
        const first = await hold($, on, surface, "git reset --hard", { isPlaced: false, isCollapsed: true });
        await first.ui.press({ key: "cancel" });
        await first.clock.advance(250);
        await first.call;
        const call = $.tool.call({ tool: "Bash", command: "git clean -fd" });
        await first.clock.settle();
        const ui = await band($, surface, 10, true);
        await first.clock.settle();
        expect(first.toasts).toHaveLength(2);
        await ui.press({ key: "cancel" });
        await first.clock.advance(250);
        await call;
        await ui.unmount();
        await first.ui.unmount();
      });

      test("a visible band or the pane says nothing extra", async ($, on) => {
        const shownBand = await hold($, on, surface, "git reset --hard", { isPlaced: false, isCollapsed: false });
        expect(shownBand.toasts).toEqual([]);
        expect(shownBand.notes).toEqual([]);
        await shownBand.ui.press({ key: "cancel" });
        await shownBand.clock.advance(250);
        await shownBand.call;
        await shownBand.ui.unmount();
      });

      test("the pane says nothing extra", async ($, on) => {
        const { clock, call, ui, toasts, notes } = await hold($, on, surface, "git reset --hard");
        // a collapsed band elsewhere is not drawn for the hold: it sits in the pane
        const idle = await band($, surface, 10, true);
        await clock.settle();
        expect(toasts).toEqual([]);
        expect(notes).toEqual([]);
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await idle.unmount();
        await ui.unmount();
      });

      test("a failing check holds a risky command instead of letting it run", async ($, on) => {
        const { ran } = core(on, { cwdThrows: true });
        const result = await $.tool.call({ tool: "Bash", command: "rm -rf build" });
        expect(result.deny).toContain("check failed");
        expect(ran).toEqual([]);
      });

      test("a failing check says why, without a missing message", async ($, on) => {
        core(on, { cwdThrows: true });
        const result = await $.tool.call({ tool: "Bash", command: "rm -rf build" });
        expect(result.deny).toContain("session.cwd");
        expect(result.deny).not.toContain("undefined");
      });

      test("a failing close does not undo Run anyway", async ($, on) => {
        const { clock, ran, call, ui } = await hold($, on, surface, "git reset --hard", { closeThrows: true });
        await ui.press({ key: "proceed" });
        await clock.advance(250);
        expect((await call).deny).toBe(undefined);
        expect(ran).toEqual(["git reset --hard"]);
        await ui.unmount();
      });

      test("a failing close still denies on Cancel with the usual message", async ($, on) => {
        const { clock, ran, call, ui } = await hold($, on, surface, "git reset --hard", { closeThrows: true });
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        expect((await call).deny).toContain("chose not to run it");
        expect(ran).toEqual([]);
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

      test("one missing target does not blank the others, and is named", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "rm -rf build missing", {
          outputs: { "find build missing": "build\nbuild/a.js\n", "du -sh build missing": "4.0K\tbuild\n" },
          exits: { "find build missing": 1, "du -sh build missing": 1 },
        });
        const text = await shown(ui);
        expect(text).toContain("Deletes 2 files and folders");
        expect(text).toContain("Could not list");
        expect(text).toContain("missing");
        expect(text).not.toContain("Nothing listed");
        expect((await ui.find({ type: "Text", text: /Deletes/ }))?.props.color).toBe("error");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a glob that listed nothing is named among the unlisted when others exist", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "rm -rf build out/*", {
          outputs: { "find build out/*": "build\n" },
          exits: { "find build out/*": 1 },
        });
        const text = await shown(ui);
        expect(text).toContain("Deletes 1 file or folder");
        expect(text).toContain("out/*");
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

      test("a django migrate falls back to python3 when python is not there", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "python manage.py migrate", {
          outputs: { "python3 manage.py showmigrations --plan": "[ ]  app.0002_add_email\n" },
          exits: { "python manage.py showmigrations --plan": 127 },
        });
        expect(await shown(ui)).toContain("Applies 1 pending migration");
        await ui.press({ key: "cancel" });
        await clock.advance(250);
        await call;
        await ui.unmount();
      });

      test("a django migrate that could not be checked says so, in the danger tone", async ($, on) => {
        const { clock, call, ui } = await hold($, on, surface, "python manage.py migrate", {
          exits: { "python manage.py showmigrations --plan": 127, "python3 manage.py showmigrations --plan": 127 },
        });
        const text = await shown(ui);
        expect(text).toContain("Could not check pending migrations");
        expect(text).not.toContain("No pending migrations");
        expect((await ui.find({ type: "Text", text: /Could not check/ }))?.props.color).toBe("error");
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
