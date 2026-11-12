# token-weather

A live forecast of the context window, drawn as one line above the prompt. It shows how full the context is, as weather, so you see a compaction coming before it arrives. It only draws; it never blocks anything.

## Install

```
/plugin install token-weather --marketplace soenkenils/claude-code-mods
```

## What you see

After each turn the line shows:

- **The forecast**: a weather word, colored by how full the context is.
- **A gauge** of the fill level.
- **The percentage** (`42%`, or `42% of context` on a wide terminal).
- **A hint**, `try /compact`, from 90% on.
- **Tokens used / window size**, for example `84k / 200k`.
- **A sparkline** of the context size over the last 12 turns, scaled to the largest, once there are two readings.
- **The change** since the last turn: `▲ +3.2k last turn`, `steady`, or `▼ 80k last turn` in green when the context shrank (a compaction or clear).

| Context | Forecast |
| --- | --- |
| under 25% | Clear |
| 25 to 49% | Cloudy |
| 50 to 74% | Showers |
| 75 to 89% | Storm |
| 90% and up | Compact soon |

Nothing is drawn until the first turn has been measured. When the line is too narrow, the less important parts drop out first: the change, the sparkline, the token count and the hint, in that order. The forecast, gauge and percentage stay.

## Terminal and Claude Desktop

- **Terminal**: monospaced text. Single-cell weather glyphs, a gauge of box-drawing cells that grows with the terminal width, and a sparkline of block characters.
- **Claude Desktop**: the same facts in proportional type, with weather emoji and the gauge and sparkline as small vector graphics, since block characters do not line up in a proportional font.

The line is skipped while Claude is showing a survey.

## Settings

None. It has no slash commands either.

## Limits

It reads the usage figures Claude Code reports after each main-thread turn (a subagent's turns do not count), so it shows the state after the last turn, not live token streaming. The history is held by the host, so it survives a reload of the module.

## Development

```bash
claude plugin test token-weather
claude plugin validate token-weather
```
