import type { HookFailure } from "claude-code";

import type { BlastRadiusRisk } from "../types";

// Words that run another command, and the flags of theirs that take a value.
const WRAPPERS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-T", "-r", "-t", "-D", "-R", "-U"],
  env: ["-u", "-C", "-S"],
  nice: ["-n"],
  time: [],
  command: [],
  nohup: [],
  exec: [],
};
const SHELLS = /^(bash|sh|zsh|dash)$/;

// Reads the command text only: `$(…)`, aliases, scripts that call rm
// themselves and commands fed in through `xargs` slip past. A reminder, not
// a security boundary.
export function classify(command: string): BlastRadiusRisk | null {
  for (const segment of command.split(/[;|&\n]/)) {
    // A subshell or group opens the segment; its closer then ends the last word.
    const body = segment.trim();
    const isGrouped = /^[({]/.test(body);
    const words = body.replace(/^[({\s]+/, "").split(/\s+/).map(unquote).filter(Boolean);
    if (isGrouped && words.length > 0) words[words.length - 1] = words[words.length - 1]!.replace(/[)}]+$/, "");
    const risk = classifyWords(stripPrefixes(words.filter(Boolean)));
    if (risk) return risk;
  }
  return null;
}

// Drops what comes before the command: `VAR=1`, `sudo -u root`, `env`, `time`,
// `bundle exec`, a backslash or a path on the command itself.
function stripPrefixes(words: string[]): string[] {
  while (words.length > 0) {
    const word = words[0]!.replace(/^\\/, "");
    const takesValue = WRAPPERS[word];
    if (/^\w+=/.test(word)) {
      words.shift();
    } else if (takesValue) {
      words.shift();
      while (words[0]?.startsWith("-")) {
        const flag = words.shift()!;
        if (takesValue.includes(flag)) words.shift();
      }
    } else if (word === "bundle" && words[1] === "exec") {
      words.splice(0, 2);
    } else {
      words[0] = word.replace(/^.*\//, "");
      break;
    }
  }
  return words;
}

function classifyWords(words: string[]): BlastRadiusRisk | null {
  const [cmd] = words;
  const flags = words.filter((w) => w.startsWith("-"));

  if (cmd === "rm") {
    const isRecursive = flags.some((f) => f === "--recursive" || /^-[a-zA-Z]*[rR]/.test(f));
    const isForced = flags.some((f) => f === "--force" || /^-[a-zA-Z]*f/.test(f));
    if (!isRecursive || !isForced) return null;
    return { kind: "rm", targets: words.slice(1).filter((w) => !w.startsWith("-")) };
  }

  // `bash -c 'rm -rf x'`: the string is a command line of its own.
  if (SHELLS.test(cmd ?? "") && /^-\w*c$/.test(words[1] ?? "")) return classify(words.slice(2).join(" "));

  if (cmd === "git") {
    // Global options (`-C dir`, `-c k=v`, `--no-pager`) come before the subcommand.
    let i = 1;
    while (words[i]?.startsWith("-")) i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(words[i]!) ? 2 : 1;
    const sub = words[i];
    const rest = words.slice(i + 1);
    if (sub === "reset" && rest.includes("--hard")) return { kind: "git-reset-hard" };
    if (sub === "clean" && rest.some((f) => /^-[a-zA-Z]*f/.test(f) || f === "--force")) {
      return { kind: "git-clean", flags: rest.filter((f) => f.startsWith("-")) };
    }
    if (sub === "push" && rest.some((f) => /^-[a-zA-Z]*f/.test(f) || f.startsWith("--force") || /^\+/.test(f))) {
      return { kind: "force-push" };
    }
    return null;
  }

  const sub = words[1];
  if (words.some((w) => /(^|\/)manage\.py$/.test(w)) && words.includes("migrate")) return { kind: "migration", tool: "django" };
  if (/^(rails|rake|bin\/rails)$/.test(cmd ?? "") && /^db:(migrate|rollback|reset|drop)/.test(sub ?? "")) {
    return { kind: "migration", tool: "other" };
  }
  if (words.some((w) => w === "migrate" || w.startsWith("migrate:") || w.startsWith("db:migrate")) && /^(npx|bunx|prisma|knex|flyway|alembic|sequelize|sequelize-cli)$/.test(cmd ?? "")) {
    return { kind: "migration", tool: "other" };
  }
  if (cmd === "alembic" && (sub === "upgrade" || sub === "downgrade")) return { kind: "migration", tool: "other" };

  return null;
}

function unquote(word: string) {
  return word.replace(/^['"]|['"]$/g, "");
}

// What the hook's `.catch` answers when the check itself failed: null lets a
// command that is not risky through; otherwise the refusal to hand Claude.
// If classifying throws too, the command is refused.
export function refusalAfterFailure(command: string, failure: HookFailure): string | null {
  try {
    if (classify(command) === null) return null;
  } catch {}
  const why = failure.kind === "timeout" ? "timed out" : "failed";
  const detail = failure.message ? ` (${failure.message})` : "";
  return `Blast Radius's check ${why}${detail}, so this command was held: ${command}. Ask the user how to proceed.`;
}
