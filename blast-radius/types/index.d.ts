export type BlastRadiusRisk =
  | { kind: "rm"; targets: string[] }
  | { kind: "git-reset-hard" }
  | { kind: "git-clean"; flags: string[] }
  | { kind: "force-push" }
  | { kind: "migration"; tool: "django" | "other" };

export type BlastRadiusHeld = {
  command: string;
  title: string;
  lines: string[];
  where: "pane" | "band";
};

declare module "claude-code" {
  interface PluginState {
    "blast-radius": { held: BlastRadiusHeld | null };
  }
}
