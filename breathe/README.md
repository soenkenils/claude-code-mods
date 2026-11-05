# breathe

A breathing exercise to look at while Claude works. A band above the prompt goes through box breathing: breathe in, hold, breathe out, hold, 4 seconds each. In the terminal it is one line, the phase in words and a bar that fills as you breathe in and empties as you breathe out. In Claude Desktop it is an aurora orb that expands and contracts. When Claude is done the band does not vanish. It finishes the breath you are in and goes at the end of the exhale.

The orb follows a design made for this mod: an aurora ball (violet on top, then aqua, green and a clay fringe) with a halo and a bright core. It has no background of its own, so the app's background shows through. It grows and brightens on the inhale and shrinks and dims on the exhale, eased like a real breath.

## Install

```
/plugin install breathe --marketplace soenkenils/claude-code-mods
```

## How a breath runs

| Phase | Orb (Desktop) and bar (terminal) | What the label says |
| --- | --- | --- |
| Breathe in (4 s) | grows, fills | `Einatmen` and the seconds left |
| Hold (4 s) | stays large, full | `Halten` |
| Breathe out (4 s) | shrinks, empties | `Ausatmen` |
| Hold (4 s) | stays small, empty | `Halten` |

When a turn begins there is a short countdown first: 3, 2, 1, 0, a second for each number (`Mach dich bereit` and the number; in Desktop the orb waits at rest). Then it starts with a breath in and repeats for as long as Claude works. When the turn ends, however it ends (answered, interrupted, failed):

- during the countdown there is no breath to finish, so the band goes at once;
- in a breath in, hold or breath out, the band runs on to the end of the exhale and then goes, and the hint says so;
- in the hold after the exhale there is nothing left to finish, so it goes at once;
- if you send the next prompt while it winds down, the breath carries on without starting over.

Only the main conversation's turns count; a subagent working inside a turn does not start or end anything.

## Where it shows

- **Terminal**: one line: the phase (`Einatmen`, `Halten`, `Ausatmen`) in the phase's theme color, a bar that fills as you breathe in and empties as you breathe out, the seconds left, and on a wide terminal the hint (`Box Breathing · 4-4-4-4`). There is no orb in the terminal.
- **Claude Desktop**: the orb is an SVG without a background, redrawn about ten times a second, with the phase in large type beside it. On a very narrow band it is the same one line as in the terminal.

Another mod's band above the prompt (the token forecast, a heads-up) is kept and drawn under the orb. A mod above this one in the chain that draws its own band without passing the rest on still hides it, as mods already do to each other.

## Use

- `/breathe` says whether it is on. `/breathe off` mutes it for the session, `/breathe on` brings it back with the next turn.
- The band's own collapse (`[-]`, ctrl+x ctrl+a) hides it for the moment.

## Settings

Fields in `/config` (or `pluginConfigs` in settings).

| Field | Default | |
| --- | --- | --- |
| `phaseSeconds` | 4 | length of each of the four phases, 2 to 10 |
| `countdownSeconds` | 3 | count down from this number to 0 before the first breath, a second for each number (3 shows 3, 2, 1, 0); 0 turns the countdown off, 0 to 10 |
| `startAfterSeconds` | 0 | wait this long into a turn before the band (the countdown first) appears, so a quick answer shows nothing; a turn that ends before the first breath begins goes at once |
| `language` | `de` | the words in the band, `de` or `en` |

## Limits

- It paints from a timer, about ten frames a second, and redraws the band every time. Whether that is smooth or flickers on a given terminal or in the desktop app depends on how they draw; it has been run in the engine's test kit and its pictures rendered to images, not watched on a real surface yet.

## Development

```bash
claude plugin test breathe
claude plugin validate breathe
```

The breathing itself (`hooks/pacer.ts`) and the orb's drawing (`hooks/orb.ts`) are plain functions with no engine in them, so they are tested directly; `hooks/breathe.tsx` holds the hooks and the layout.
