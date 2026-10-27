import type { HeadsUpAlert, HeadsUpSeverity } from "../types";

export const RANK: Record<HeadsUpSeverity, number> = { info: 0, warn: 1, danger: 2 };

// Paths that are worth more than a shrug when something writes to them.
const SENSITIVE = [
  /^\/(etc|usr|bin|sbin|boot|lib|lib64|sys|proc|dev)(\/|$)/,
  /\/\.(ssh|aws|gnupg|kube)(\/|$)/,
  /\/\.(bash_profile|bashrc|zshrc|zprofile|profile|gitconfig|npmrc|netrc|pgpass)$/,
];

// Reads the command text only, as blast-radius does: a reminder, not a gate.
const TEST_RUNNERS = [
  /^(?:\w+=\S+\s+)*(?:npx\s+|bunx\s+|uv\s+run\s+|poetry\s+run\s+|python3?\s+-m\s+)?(?:jest|vitest|mocha|pytest|rspec|phpunit|tox|unittest)\b/,
  /^(?:npm|pnpm|yarn|bun|deno)\s+(?:run\s+)?test\b/,
  /^(?:go|cargo|dotnet|mvn|make|rake|gradle|\.\/gradlew)\s+test\b/,
  /^(?:claude\s+)?plugin\s+test\b/,
];

export function isTestCommand(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/).some((segment) => {
    const words = segment.trim();
    return TEST_RUNNERS.some((runner) => runner.test(words));
  });
}

// Backslashes and drive letters are folded so a Windows path compares like a POSIX one.
export function normalize(path: string, cwd: string): string {
  const flat = path.replace(/\\/g, "/");
  const absolute = /^([A-Za-z]:)?\//.test(flat) ? flat : `${cwd.replace(/\\/g, "/")}/${flat}`;
  const drive = /^[A-Za-z]:/.exec(absolute)?.[0].toLowerCase() ?? "";
  const parts: string[] = [];
  for (const part of absolute.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join("/")}`;
}

export function isInside(path: string, base: string): boolean {
  return path === base || path.startsWith(base === "/" ? "/" : `${base}/`);
}

export function expandHome(path: string, home: string | undefined): string {
  if (home === undefined || (path !== "~" && !path.startsWith("~/"))) return path;
  return `${home}${path.slice(1)}`;
}

export function outsideSeverity(path: string): HeadsUpSeverity {
  return SENSITIVE.some((pattern) => pattern.test(path)) ? "danger" : "warn";
}

// The arguments the tool was called with, without the keys the engine adds.
const RESERVED = new Set(["tool", "tool_use_id", "agentId", "requestMeta", "consent"]);
export function inputOf(e: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED.has(key)));
}

export function toolLabel(tool: string): string {
  return tool.startsWith("mcp__") ? tool.slice(5).replace("__", " · ") : tool;
}

// What the call was about, in a few words: the command, or the file.
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  switch (tool) {
    case "Bash":
      return text(input.command).split("\n")[0]?.trim().slice(0, 160) ?? "";
    case "Edit":
    case "Write":
    case "Read":
      return text(input.file_path);
    case "NotebookEdit":
      return text(input.notebook_path);
    default:
      return "";
  }
}

// The first line of an error, which for Bash is "Exit code 1".
export function errorLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 120);
}

// Two calls are the same when they asked the same thing and got the same answer.
export function signature(tool: string, input: Record<string, unknown>, outcome: string): string {
  return `${tool}\u0000${JSON.stringify(input)}\u0000${outcome.length}:${outcome.slice(0, 300)}`;
}

export function short(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1_000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export type Draft = Pick<HeadsUpAlert, "id" | "kind" | "severity" | "title" | "detail">;

// What raising `draft` does to the list, or null when nothing would change.
// A dismissed alert stays quiet until its cause is resolved, so a streak the
// person has seen does not come back with every further failure.
export function apply(
  list: HeadsUpAlert[],
  draft: Draft,
  { repeat, now, keep }: { repeat: boolean; now: number; keep: number },
): { list: HeadsUpAlert[]; isLoud: boolean } | null {
  const old = list.find((a) => a.id === draft.id && a.status !== "resolved");
  if (old?.status === "dismissed") return null;
  if (old) {
    const isSame = old.title === draft.title && old.detail === draft.detail && old.severity === draft.severity;
    if (isSame && !repeat) return null;
    const next = { ...old, ...draft, count: repeat ? old.count + 1 : old.count, at: now };
    return { list: list.map((a) => (a === old ? next : a)), isLoud: RANK[draft.severity] > RANK[old.severity] };
  }
  const added: HeadsUpAlert = { ...draft, count: 1, status: "active", at: now };
  return { list: trim([...list, added], keep), isLoud: true };
}

// Keeps the newest `keep` alerts, but never drops one that is still showing.
export function trim(list: HeadsUpAlert[], keep: number): HeadsUpAlert[] {
  let extra = list.length - keep;
  return extra <= 0 ? list : list.filter((a) => a.status === "active" || extra-- <= 0);
}
