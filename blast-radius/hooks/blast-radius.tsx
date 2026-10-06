import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { BlastRadiusHeld, BlastRadiusRisk } from "../types";
import { classify } from "./classify";

const PANE = "blast-radius";
const SHOWN = 8;
const held = atom({ plugin: "blast-radius", key: "held" } as const, null);

// The decision lives in the module, not in $.state: every $.state.get of one
// dispatch reads one moment, so the waiting hook would never see a press.
type Decision = "proceed" | "cancel";
let isHolding = false;
let decision: Decision | null = null;

export const register: Register = (on) => {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const command = String(e.command ?? "");
    const risk = classify(command);
    if (risk === null) return next(e);

    if (isHolding) {
      return { deny: "Blast Radius is already holding another command; run this one after it." };
    }

    isHolding = true;
    decision = null;
    try {
      const report = await measure($, risk, await $.session.cwd());
      await update($, held, (): BlastRadiusHeld => ({ command, ...report, where: "pane" }));
      const opened = await $.ui.open({ id: PANE, title: "Blast Radius", focus: true });
      if (!opened.isPlaced) await update($, held, (cur) => (cur ? { ...cur, where: "band" as const } : cur));

      // A `$` call in flight does not count against the hook's budget, so
      // short sleeps let us wait on the person for as long as they need.
      while (decision === null && !next.signal.aborted) {
        await $.process.run(["sleep", "0.25"]);
      }
    } finally {
      isHolding = false;
      await update($, held, () => null);
      await $.ui.close({ id: PANE });
    }

    if (decision === "proceed") return next(e);
    return {
      deny: `Blast Radius held this command and the user chose not to run it: ${command}. Ask them how to proceed instead of retrying.`,
    };
  });

  // Closing the pane by hand (Escape, its close mark) counts as Cancel.
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === "person") decide("cancel");
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, held);
    if (current === null) return <Box><Text dimColor>Nothing held.</Text></Box>;
    return warning($, e, current);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, held);
    if (current === null || current.where !== "band" || e.props.hasSurvey) return next(e);
    return warning($, e, current);
  });
};

function warning($: EngineInterface, e: Parameters<EngineInterface["ui"]["resolve"]>[0], shown: BlastRadiusHeld) {
  const { Box, Text, Button } = $.ui.resolve(e);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="red" bold>⚠ {shown.title}</Text>
      <Text dimColor>$ {shown.command}</Text>
      {shown.lines.slice(0, SHOWN).map((line) => <Text>  {line}</Text>)}
      {shown.lines.length > SHOWN && <Text dimColor>  … and {shown.lines.length - SHOWN} more</Text>}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="proceed" label="Proceed" hotkey="1" plain onPress={() => decide("proceed")} />
        <Button key="cancel" label="Cancel" hotkey="2" plain onPress={() => decide("cancel")} />
      </Box>
    </Box>
  );
}

function decide(choice: Decision) {
  if (isHolding && decision === null) decision = choice;
}

type Report = { title: string; lines: string[] };

async function measure($: EngineInterface, risk: BlastRadiusRisk, cwd: string): Promise<Report> {
  const run = async (argv: string[]) => {
    try {
      const r = await $.process.run(argv, { cwd });
      return r.exitCode === 0 ? r.stdout.split("\n").filter(Boolean) : null;
    } catch {
      return null;
    }
  };

  switch (risk.kind) {
    case "rm": {
      if (risk.targets.length === 0) return { title: "Recursive force delete", lines: [] };
      const entries = (await run(["find", ...risk.targets])) ?? [];
      const sizes = (await run(["du", "-sh", ...risk.targets])) ?? [];
      const dirty = (await run(["git", "status", "--porcelain", "--", ...risk.targets])) ?? [];
      return {
        title: `Deletes ${entries.length} files and folders`,
        lines: [
          ...sizes.map((s) => s.replace(/\s+/, "  ")),
          ...(dirty.length > 0 ? [`${dirty.length} of them have uncommitted changes:`, ...dirty] : []),
        ],
      };
    }
    case "git-reset-hard": {
      const dirty = (await run(["git", "status", "--porcelain", "--untracked-files=no"])) ?? [];
      return {
        title: dirty.length > 0 ? `Discards uncommitted changes in ${dirty.length} files` : "Resets the branch (working tree is clean)",
        lines: dirty,
      };
    }
    case "git-clean": {
      const extra = risk.flags.filter((f) => /^-[a-zA-Z]*[dxX]/.test(f)).flatMap((f) => f.slice(1).replace(/[^dxX]/g, "").split("").map((c) => `-${c}`));
      const gone = (await run(["git", "clean", "-n", ...extra])) ?? [];
      return { title: `Removes ${gone.length} untracked files`, lines: gone.map((l) => l.replace(/^Would remove /, "")) };
    }
    case "force-push": {
      const lost = await run(["git", "log", "--oneline", "HEAD..@{u}"]);
      if (lost === null) return { title: "Force push (no upstream to compare)", lines: [] };
      return {
        title: lost.length > 0 ? `Overwrites ${lost.length} commits on the remote` : "Force push (remote has nothing that would be lost)",
        lines: lost,
      };
    }
    case "migration": {
      if (risk.tool === "django") {
        const plan = (await run(["python", "manage.py", "showmigrations", "--plan"])) ?? [];
        const pending = plan.filter((l) => l.startsWith("[ ]")).map((l) => l.slice(4));
        return { title: `Applies ${pending.length} pending migrations`, lines: pending };
      }
      return { title: "Runs database migrations", lines: ["Check which database this targets before going on."] };
    }
  }
}
