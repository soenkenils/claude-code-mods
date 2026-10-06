import type { BlastRadiusRisk } from "../types";

// Reads the command text only: `$(…)`, aliases and scripts that call rm
// themselves slip past. A reminder, not a security boundary.
export function classify(command: string): BlastRadiusRisk | null {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).map(unquote).filter(Boolean);
    while (words[0] === "sudo" || /^\w+=/.test(words[0] ?? "")) words.shift();
    const risk = classifyWords(words);
    if (risk) return risk;
  }
  return null;
}

function classifyWords(words: string[]): BlastRadiusRisk | null {
  const [cmd, sub, ...rest] = words;
  const flags = words.filter((w) => w.startsWith("-"));

  if (cmd === "rm") {
    const isRecursive = flags.some((f) => f === "--recursive" || /^-[a-zA-Z]*[rR]/.test(f));
    const isForced = flags.some((f) => f === "--force" || /^-[a-zA-Z]*f/.test(f));
    if (!isRecursive || !isForced) return null;
    return { kind: "rm", targets: words.slice(1).filter((w) => !w.startsWith("-")) };
  }

  if (cmd === "git") {
    if (sub === "reset" && rest.includes("--hard")) return { kind: "git-reset-hard" };
    if (sub === "clean" && rest.some((f) => /^-[a-zA-Z]*f/.test(f) || f === "--force")) {
      return { kind: "git-clean", flags: rest.filter((f) => f.startsWith("-")) };
    }
    if (sub === "push" && rest.some((f) => f === "-f" || f.startsWith("--force") || /^\+/.test(f))) {
      return { kind: "force-push" };
    }
    return null;
  }

  if (words.includes("manage.py") && words.includes("migrate")) return { kind: "migration", tool: "django" };
  if (/^(rails|rake|bin\/rails)$/.test(cmd ?? "") && /^db:(migrate|rollback|reset|drop)/.test(sub ?? "")) {
    return { kind: "migration", tool: "other" };
  }
  if (words.some((w) => w === "migrate" || w.startsWith("migrate:")) && /^(npx|bunx|prisma|knex|flyway|alembic|sequelize)$/.test(cmd ?? "")) {
    return { kind: "migration", tool: "other" };
  }
  if (cmd === "alembic" && (sub === "upgrade" || sub === "downgrade")) return { kind: "migration", tool: "other" };

  return null;
}

function unquote(word: string) {
  return word.replace(/^['"]|['"]$/g, "");
}
