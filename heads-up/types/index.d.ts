export type HeadsUpKind = "failures" | "tests" | "outside" | "context-jump" | "context-high" | "slow" | "quiet" | "repeat";
export type HeadsUpSeverity = "info" | "warn" | "danger";
export type HeadsUpStatus = "active" | "resolved" | "dismissed";

export type HeadsUpAlert = {
  // Stable per cause (`outside:/etc/hosts`, `failures:main`), so a repeat updates its alert.
  id: string;
  kind: HeadsUpKind;
  severity: HeadsUpSeverity;
  title: string;
  detail: string;
  count: number;
  status: HeadsUpStatus;
  at: number;
};

declare module "claude-code" {
  interface PluginState {
    "heads-up": { alerts: Shaped<HeadsUpAlert[]>; isMuted: boolean };
  }
}
