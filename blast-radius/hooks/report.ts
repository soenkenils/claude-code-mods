import type { EngineInterface } from "claude-code";

import type { BlastRadiusLine, BlastRadiusRisk, BlastRadiusSection } from "../types";

export type Report = { title: string; tone: "danger" | "caution"; sections: BlastRadiusSection[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Asks git, du and find what the command would hit, in the session's folder.
// What cannot be asked (no upstream, no such path) comes back as "nothing".
export async function measure($: EngineInterface, risk: BlastRadiusRisk, cwd: string): Promise<Report> {
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
      if (risk.targets.length === 0) return { title: "Recursive force delete", tone: "caution", sections: [] };
      const entries = (await run(["find", ...risk.targets])) ?? [];
      const sizes = (await run(["du", "-sh", ...risk.targets])) ?? [];
      const dirty = (await run(["git", "status", "--porcelain", "--", ...risk.targets])) ?? [];
      if (entries.length === 0) {
        return {
          title: "Recursive force delete",
          tone: "caution",
          sections: [{ lines: [{ text: "Nothing listed for these targets. Globs and variables are not expanded here." }] }],
        };
      }
      return {
        title: entries.length === 1 ? "Deletes 1 file or folder" : `Deletes ${entries.length} files and folders`,
        tone: "danger",
        sections: [
          { lines: sizes.map(sized) },
          { heading: `Uncommitted changes in ${plural(dirty.length, "file")}`, lines: porcelain(dirty) },
        ],
      };
    }
    case "git-reset-hard": {
      const dirty = (await run(["git", "status", "--porcelain", "--untracked-files=no"])) ?? [];
      return {
        title: dirty.length > 0 ? `Discards uncommitted changes in ${plural(dirty.length, "file")}` : "Resets the branch (working tree is clean)",
        tone: dirty.length > 0 ? "danger" : "caution",
        sections: [{ lines: porcelain(dirty) }],
      };
    }
    case "git-clean": {
      const extra = risk.flags.filter((f) => /^-[a-zA-Z]*[dxX]/.test(f)).flatMap((f) => f.slice(1).replace(/[^dxX]/g, "").split("").map((c) => `-${c}`));
      const gone = (await run(["git", "clean", "-n", ...extra])) ?? [];
      return {
        title: gone.length > 0 ? `Removes ${plural(gone.length, "untracked file")}` : "Removes no untracked files",
        tone: gone.length > 0 ? "danger" : "caution",
        sections: [{ lines: gone.map((l) => ({ text: l.replace(/^Would remove /, "") })) }],
      };
    }
    case "force-push": {
      const lost = await run(["git", "log", "--oneline", "HEAD..@{u}"]);
      if (lost === null) return { title: "Force push (no upstream to compare)", tone: "caution", sections: [] };
      return {
        title: lost.length > 0 ? `Overwrites ${plural(lost.length, "commit")} on the remote` : "Force push (remote has nothing that would be lost)",
        tone: lost.length > 0 ? "danger" : "caution",
        sections: [{ lines: lost.map(commit) }],
      };
    }
    case "migration": {
      if (risk.tool === "django") {
        const plan = (await run(["python", "manage.py", "showmigrations", "--plan"])) ?? [];
        const pending = plan.filter((l) => l.startsWith("[ ]")).map((l) => l.slice(4));
        return {
          title: pending.length > 0 ? `Applies ${plural(pending.length, "pending migration")}` : "No pending migrations found",
          tone: pending.length > 0 ? "danger" : "caution",
          sections: [{ lines: pending.map((text) => ({ text })) }],
        };
      }
      return {
        title: "Runs database migrations",
        tone: "danger",
        sections: [{ lines: [{ text: "Check which database this targets before going on." }] }],
      };
    }
  }
}

// "812M\tnode_modules" from `du -sh`.
function sized(line: string): BlastRadiusLine {
  const [size = "", ...path] = line.split(/\s+/);
  return { lead: size, text: path.join(" ") };
}

// "abc123 Fix login" from `git log --oneline`.
function commit(line: string): BlastRadiusLine {
  const [hash = "", ...subject] = line.split(" ");
  return { lead: hash, text: subject.join(" ") };
}

// " M src/app.ts" from `git status --porcelain`: two status columns, a space, the path.
export function porcelain(lines: string[]): BlastRadiusLine[] {
  return lines.map((line) => {
    const status = line.slice(0, 2).trim();
    const leadColor = status.includes("D") ? "error" : status === "??" ? "subtle" : status.includes("A") ? "success" : "warning";
    return { lead: status, leadColor, text: line.slice(3) };
  });
}
