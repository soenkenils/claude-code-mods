# claude-code-mods

A collection of Claude Code **mods**: plugins whose behaviour is a TypeScript hooks module run by Claude Code's plugin engine. They draw bands and panes in the terminal and in Claude Desktop. The engine API is early access and may change between Claude Code releases.

| Mod | What it does |
| --- | --- |
| [token-weather](token-weather) | A live forecast of the context window, drawn above the prompt. |
| [blast-radius](blast-radius) | Holds risky Bash commands, shows what they would hit, and waits for Run anyway or Cancel. |
| [heads-up](heads-up) | Watches the session and shows a heads-up when something is off: failing tools or tests, edits outside the project, a context spike, a stall. |
| [breathe](breathe) | A breathing guide while Claude works: words and a bar in the terminal, an aurora orb in Claude Desktop. |

## Install

```
/plugin marketplace add soenkenils/claude-code-mods
/plugin install token-weather --marketplace soenkenils/claude-code-mods
```

Replace `token-weather` with any mod above.

## Development

There is no build step and no `package.json`; the engine loads the `.ts`/`.tsx` sources directly. From the repo root, pass the mod folder:

```bash
claude plugin test blast-radius        # runs every *.test.ts(x) under the folder
claude plugin validate blast-radius    # checks manifest and hooks module
bunx -p typescript tsc -p blast-radius # type-check
```

`tsc` needs the types Claude Code generates in `<mod>/.claude-plugin/types/` when it loads the mod. See [CLAUDE.md](CLAUDE.md) for the layout and runtime constraints.

## License

[MIT](LICENSE)
