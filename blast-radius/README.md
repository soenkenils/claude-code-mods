# blast-radius

Holds risky Bash commands before they run, shows what they would hit, and waits for you to choose **Run anyway** or **Cancel**. Nothing else is blocked: a command it does not recognise goes straight through.

## Install

```
/plugin install blast-radius --marketplace soenkenils/claude-code-mods
```

## What it holds

| Command | Held when |
| --- | --- |
| `rm` | both a recursive (`-r`, `-R`, `--recursive`) and a force (`-f`, `--force`) flag are given |
| `git reset` | `--hard` is given |
| `git clean` | `-f` or `--force` is given |
| `git push` | `-f`, `--force...` or a `+refspec` is given |
| Database migrations | Django `manage.py migrate`; `rails`/`rake`/`bin/rails` with `db:migrate`, `db:rollback`, `db:reset` or `db:drop`; `alembic upgrade` or `downgrade`; `migrate` or `migrate:...` through `npx`, `bunx`, `prisma`, `knex`, `flyway`, `alembic` or `sequelize` |

A command line is split at `&&`, `||`, `;`, `|` and newlines, and each part is checked, with a leading `sudo` or `VAR=value` ignored. It reads the command text only: `$(...)`, aliases, and scripts that call `rm` themselves slip past. It is a reminder, not a security boundary.

## What it measures

Before asking, it runs read-only commands (`find`, `du`, `git`) in the session's folder to see what the command would hit:

- **`rm -rf`**: how many files and folders the targets contain, their sizes, and which have uncommitted changes. Globs and variables are not expanded, so a target it cannot list shows "Nothing listed for these targets".
- **`git reset --hard`**: how many files with uncommitted changes would be discarded.
- **`git clean -f`**: the untracked files a dry run (`git clean -n`) would remove, using the same `-d`, `-x` and `-X` flags.
- **Force push**: the commits on the upstream branch you do not have (`HEAD..@{u}`). With no upstream it says so.
- **Migrations**: for Django, the pending migrations from `showmigrations --plan`. For the other tools it only says to check which database is targeted.

The title is red when something would be lost and amber when nothing was found.

## The flow

1. The command is held and a **Blast Radius** pane opens with the command, the findings and two buttons.
2. **Run anyway** (key `1`) lets the command run. **Cancel** (key `2`) refuses it, and Claude is told you chose not to run it and should ask how to proceed.
3. Focus starts on Cancel, so pressing Enter alone is safe. Closing the pane (Esc) counts as Cancel.

Where a pane cannot be placed, the same card is drawn as a band above the prompt instead. While one command is held, a second risky command is refused with a note to run it afterwards. The hold waits for as long as you need.

## Terminal and Claude Desktop

Both show the same card: a warning title, the command, the findings (a size, status or commit hash in a column, then the path or message) and the two buttons. In the pane the list is longer; in the band it is shortened to fit, with "... and n more" for what is left.

## Limits

It does not look inside shell expansion, aliases or scripts, and it only holds the Bash tool. The measurements are best effort: what cannot be asked of the tools comes back as "nothing". It has no settings and no slash commands.

## Development

```bash
claude plugin test blast-radius
claude plugin validate blast-radius
```

`hooks/classify.ts` (what is risky) and `hooks/report.ts` (what it hits) hold the logic; `hooks/blast-radius.tsx` holds the hook and the card.
