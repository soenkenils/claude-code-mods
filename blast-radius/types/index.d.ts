export type BlastRadiusRisk =
  | { kind: "rm"; targets: string[] }
  | { kind: "git-reset-hard" }
  | { kind: "git-clean"; flags: string[] }
  | { kind: "force-push" }
  | { kind: "migration"; tool: "django" | "other" };

// One row of what a command would hit: a path, a commit, a migration. `lead`
// is the short column before it (a size, a git status, a hash).
export type BlastRadiusLine = {
  lead?: string;
  leadColor?: "success" | "warning" | "error" | "subtle";
  text: string;
};

export type BlastRadiusSection = { heading?: string; lines: BlastRadiusLine[] };

export type BlastRadiusHeld = {
  command: string;
  title: string;
  // danger: something measurable is at stake. caution: nothing found, or nothing to measure.
  tone: "danger" | "caution";
  sections: BlastRadiusSection[];
  where: "pane" | "band";
};

declare module "claude-code" {
  interface PluginState {
    "blast-radius": { held: Shaped<BlastRadiusHeld | null> };
  }
}
