# breathe

A breathing exercise to look at while Claude works. An aurora orb above the prompt (terminal and Claude Desktop) expands as you breathe in, holds, contracts as you breathe out, and holds again: box breathing, 4 seconds each. When Claude is done the orb does not vanish. It finishes the breath you are in and goes at the end of the exhale.

The orb follows a design made for this mod: an aurora ball (violet on top, then aqua, green and a clay fringe) with a halo and a bright core on a dark night sky. It grows and brightens on the inhale and shrinks and dims on the exhale, eased like a real breath.

## How a breath runs

| Phase | What the orb does | What the label says |
| --- | --- | --- |
| Breathe in (4 s) | grows | `Einatmen` and the seconds left |
| Hold (4 s) | stays large | `Halten` |
| Breathe out (4 s) | shrinks | `Ausatmen` |
| Hold (4 s) | stays small | `Halten` |

It starts with a breath in when a turn begins and repeats for as long as Claude works. When the turn ends, however it ends (answered, interrupted, failed):

- in a breath in, hold or breath out, the orb runs on to the end of the exhale and then goes, and the hint says so;
- in the hold after the exhale there is nothing left to finish, so it goes at once;
- if you send the next prompt while it winds down, the breath carries on without starting over.

Only the main conversation's turns count; a subagent working inside a turn does not start or end anything.

## Where it shows

- **Terminal**: the orb is a grid of half-block cells, 8 rows tall (fewer where the band is short), with the phase, a progress bar and the seconds left beside it. With less than 4 rows or under about 50 columns it is one line: the phase and a bar that fills as you breathe in and empties as you breathe out.
- **Claude Desktop**: the orb is an SVG card redrawn about ten times a second, with the phase in large type beside it. On a very narrow band it is the one line of text.

Another mod's band above the prompt (the token forecast, a heads-up) is kept and drawn under the orb. A mod above this one in the chain that draws its own band without passing the rest on still hides it, as mods already do to each other.

## Use

- `/breathe` says whether it is on. `/breathe off` mutes it for the session, `/breathe on` brings it back with the next turn.
- The band's own collapse (`[-]`, ctrl+x ctrl+a) hides it for the moment.

## Settings

Fields in `/config` (or `pluginConfigs` in settings).

| Field | Default | |
| --- | --- | --- |
| `phaseSeconds` | 4 | length of each of the four phases, 2 to 10 |
| `startAfterSeconds` | 0 | wait this long into a turn before the orb appears, so a quick answer does not start a whole breath; the first breath then starts when it appears, and a turn that ends before never shows it |
| `language` | `de` | labels next to the orb, `de` or `en` |

## Limits

- It paints from a timer, about ten frames a second, and redraws the band every time. Whether that is smooth or flickers on a given terminal or in the desktop app depends on how they draw; it has been run in the engine's test kit and its pictures rendered to images, not watched on a real surface yet.
- The terminal's orb needs a terminal that draws truecolor and a `Raster` (the engine's cell-grid element). The terminal's own background shows nowhere inside it: the orb carries its own dark sky, so it is a dark tile on a light theme.

## Development

```bash
claude plugin test breathe
claude plugin validate breathe
```

The breathing itself (`hooks/pacer.ts`) and the drawing (`hooks/orb.ts`) are plain functions with no engine in them, so they are tested directly; `hooks/breathe.tsx` holds the hooks and the layout.
