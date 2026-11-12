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
| `git clean` | `-f` (also inside combined flags such as `-fd`) or `--force` is given |
| `git push` | `-f` (also inside combined flags such as `-fu`), `--force...` or a `+refspec` is given |
| Database migrations | Django `manage.py migrate` (also `./manage.py`); `rails`/`rake`/`bin/rails` with `db:migrate`, `db:rollback`, `db:reset` or `db:drop`; `alembic upgrade` or `downgrade`; `migrate`, `migrate:...` or `db:migrate...` through `npx`, `bunx`, `prisma`, `knex`, `flyway`, `alembic`, `sequelize` or `sequelize-cli` |

A command line is split at `&&`, `||`, `;`, `|`, a single `&` and newlines, but not inside single or double quotes or after a backslash, and each part is checked. These are looked through before the command is read:

- a leading `(` or `{` (subshell or group) and the closer after the last word;
- `VAR=value`, and `sudo`, `env`, `nice`, `time`, `command`, `nohup`, `exec` and `bundle exec`, with their flags (`sudo -u root`, `env -u FOO`);
- a backslash or a path on the command (`\rm`, `/bin/rm`, `/usr/bin/git`);
- git's global options before the subcommand (`git -C /x reset --hard`, `git -c a=b push --force`);
- `bash -c '...'`, `sh -c "..."` (also `zsh`, `dash`, `-lc`): the quoted string is checked as a command line of its own.

It reads the command text with a small quote-aware scanner and does not parse the shell, so a separator inside quotes does not split (`git commit -m "a; rm -rf x"` is not held), and neither is text that only names a command (`echo "rm -rf x"`). A quoted target such as `rm -rf "my dir"` is one target.

What still slips past: `$(...)` and backticks, aliases and functions, scripts and Makefile targets that call `rm` or a migration themselves (`npm run migrate`, `./deploy.sh`), commands fed through `xargs` or `find -exec`/`-delete`, `eval`, and anything built from variables. It is a reminder, not a security boundary.

If the check itself fails (or times out), a risky command is refused rather than run, with the reason, and Claude is told to ask you. A command that is not risky still goes through.

## What it measures

Before asking, it runs read-only commands (`find`, `du`, `git`) in the session's folder to see what the command would hit:

- **`rm -rf`**: how many files and folders the targets contain, their sizes, and which have uncommitted changes. Globs and variables are not expanded. Targets that exist are listed even when another does not; those that could not be listed are named under "Could not list". If none can be listed it shows "Nothing listed for these targets".
- **`git reset --hard`**: how many files with uncommitted changes would be discarded.
- **`git clean -f`**: the untracked files a dry run (`git clean -n`) would remove, using the same `-d`, `-x` and `-X` flags. It does not pass `-e` patterns or paths, so the list can be broader than what the command removes.
- **Force push**: the commits on the upstream branch you do not have (`HEAD..@{u}`). With no upstream it says so.
- **Migrations**: for Django, the pending migrations from `python manage.py showmigrations --plan` (tries `python`, then `python3`; always `manage.py` in the session's folder, whatever the command called). If neither can run it, it says "Could not check pending migrations" instead of claiming none. For the other tools it only says to check which database is targeted.

The title takes the theme's error colour when something would be lost (and for migrations it cannot check), and its warning colour when nothing was found.

## The flow

1. The command is held and a **Blast Radius** pane opens with the command, the findings and two buttons.
2. **Run anyway** (key `1`) lets the command run. **Cancel** (key `2`) refuses it, and Claude is told you chose not to run it and should ask how to proceed.
3. Focus starts on Cancel, so pressing Enter alone is safe. Closing the pane (Esc) counts as Cancel.

Where a pane cannot be placed, the same card is drawn as a band above the prompt instead. If you have collapsed that band, nothing of it is on screen, so once per hold it raises a toast and a notification saying a command is waiting and that ctrl+x ctrl+a expands the band. While one command is held, a second risky command is refused with a note to run it afterwards. The hold waits for as long as you need. Interrupting the turn ends the hold without running the command.

## Terminal and Claude Desktop

Both show the same card: a warning title, the command, the findings (a size, status or commit hash in a column, then the path or message) and the two buttons. The list is cut to fit the room (4 to 12 rows in the pane, 2 to 8 in the band, depending on the space), with "... and n more" for what is left.

## Limits

It does not look inside shell expansion, aliases or scripts, and it only holds the Bash tool. The measurements are best effort: what cannot be asked of the tools comes back as "nothing". It has no settings and no slash commands.

## Development

```bash
claude plugin test blast-radius
claude plugin validate blast-radius
```

`hooks/classify.ts` (what is risky) and `hooks/report.ts` (what it hits) hold the logic; `hooks/blast-radius.tsx` holds the hook and the card.
