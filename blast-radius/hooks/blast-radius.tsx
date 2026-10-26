import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { BlastRadiusHeld, BlastRadiusLine } from "../types";
import { classify } from "./classify";
import { measure } from "./report";

const PANE = "blast-radius";
// Change the tag when the held value's fields change: a reload meets what the
// earlier version stored and reads another tag as null.
const held = atom({ plugin: "blast-radius", key: "held" } as const, null, { shape: "held-2" });

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
    // The frame and the close mark are the pane's; leave room for what is not the list.
    const room = Math.max(4, Math.min(12, (e.viewport?.rows ?? 24) - 14));
    return warning($, e, current, { isPane: true, room });
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, held);
    if (current === null || current.where !== "band" || e.props.hasSurvey) return next(e);
    // The band scrolls past `maxRows`; keep the buttons in view with a short list.
    const room = Math.max(2, Math.min(8, e.props.maxRows - 7));
    return warning($, e, current, { isPane: false, room });
  });
};

type Site = { isPane: boolean; room: number };
type Row = { heading: string } | { line: BlastRadiusLine };

// What a command would hit, as a card: what it does, the command, what it hits,
// then the choice. Cancel is the one the focus starts on, so Enter alone is safe.
function warning($: EngineInterface, e: Parameters<EngineInterface["ui"]["resolve"]>[0], shown: BlastRadiusHeld, { isPane, room }: Site) {
  const { Box, Text, Button, Code } = $.ui.resolve(e);
  const color = shown.tone === "danger" ? "error" : "warning";
  const { rows, hidden } = layout(shown.sections, room);
  const leadWidth = Math.min(8, Math.max(0, ...rows.map((r) => ("line" in r ? r.line.lead?.length ?? 0 : 0))));

  return (
    <Box flexDirection="column" paddingX={1} borderStyle={isPane ? undefined : "round"} borderColor={color}>
      <Box flexDirection="row" gap={1}>
        <Text color={color} weight="semibold">⚠</Text>
        <Text color={color} weight="semibold" size="heading">{shown.title}</Text>
      </Box>
      {isPane && <Text dimColor>Blast Radius is holding this command until you decide.</Text>}
      <Box borderStyle={isPane ? "round" : undefined} borderColor="subtle" paddingX={isPane ? 1 : 0} marginTop={isPane ? 1 : 0}>
        <Code source={shown.command} language="bash" />
      </Box>
      {rows.length > 0 && (
        <Box flexDirection="column" marginTop={isPane ? 1 : 0}>
          {rows.map((row) =>
            "heading" in row ? (
              <Box marginTop={isPane ? 1 : 0}>
                <Text dimColor>{row.heading}</Text>
              </Box>
            ) : (
              <Box flexDirection="row" gap={1}>
                {leadWidth > 0 && (
                  <Box width={leadWidth}>
                    <Text mono color={row.line.leadColor} dimColor={row.line.leadColor === undefined}>{row.line.lead ?? ""}</Text>
                  </Box>
                )}
                <Text mono wrap="truncate-middle">{row.line.text}</Text>
              </Box>
            ),
          )}
          {hidden > 0 && <Text dimColor>… and {hidden} more</Text>}
        </Box>
      )}
      <Box flexDirection="row" alignItems="center" gap={2} marginTop={1}>
        <Button key="proceed" label="Run anyway" hotkey="1" plain onPress={() => decide("proceed")} />
        <Button key="cancel" label="Cancel" hotkey="2" plain variant="primary" autoFocus onPress={() => decide("cancel")} />
        {isPane && <Text dimColor>Esc cancels</Text>}
      </Box>
    </Box>
  );
}

// Fits the sections into `room` rows: a heading counts a row and shows only
// above a line that fits; one row at the end is kept for "… and n more".
function layout(sections: BlastRadiusHeld["sections"], room: number) {
  const filled = sections.filter((s) => s.lines.length > 0);
  const total = filled.reduce((n, s) => n + s.lines.length + (s.heading ? 1 : 0), 0);
  const budget = total > room ? room - 1 : room;
  const rows: Row[] = [];
  let hidden = 0;
  for (const { heading, lines } of filled) {
    let from = 0;
    if (heading && rows.length + 2 <= budget) rows.push({ heading });
    else if (heading) from = lines.length;
    for (const line of lines.slice(from)) {
      if (rows.length < budget) rows.push({ line });
      else hidden++;
    }
    hidden += from;
  }
  return { rows, hidden };
}

function decide(choice: Decision) {
  if (isHolding && decision === null) decision = choice;
}
