# breathe

A breathing exercise to look at while Claude works. A band above the prompt goes through box breathing: breathe in, hold, breathe out, hold, 4 seconds each. Two gentler patterns leave the holds out (see [Patterns](#patterns)). In the terminal it is one line, a bar that fills as you breathe in and empties as you breathe out, with the phase in words after it. In Claude Desktop it is an aurora orb that expands and contracts, with the phase in words beside it. The band stays out of the way: it appears only after a few seconds into a turn, fades in and out, and has a close button. When Claude is done it does not vanish. It finishes the breath you are in and goes at the end of the exhale. It steps aside while Claude asks you a question, and can say each phase aloud.

The orb follows a design made for this mod: an aurora ball (violet on top, then aqua, green and a clay fringe) with a halo and a bright core. It has no background of its own, so the app's background shows through. It grows and brightens on the inhale and shrinks and dims on the exhale, eased like a real breath.

## Install

```
/plugin install breathe --marketplace soenkenils/claude-code-mods
```

## How a breath runs

| Phase | Orb (Desktop) and bar (terminal) | What the label says |
| --- | --- | --- |
| Breathe in (4 s) | grows, fills | `Einatmen` (terminal: and the seconds left) |
| Hold (4 s) | stays large, full | `Halten` |
| Breathe out (4 s) | shrinks, empties | `Ausatmen` |
| Hold (4 s) | stays small, empty | `Halten` |

A turn does not show the band at once. A quick answer should not call up a breathing exercise it then takes away, so the band waits 3 seconds (`startAfterSeconds`). Then comes a short countdown: 3, 2, 1, 0, a second for each number (`Mach dich bereit` and the number; in Desktop the orb waits at rest). Then it starts with a breath in and repeats for as long as Claude works. When the turn ends, however it ends (answered, interrupted, failed):

- before the band has appeared there is nothing to show, and it never does;
- during the countdown there is no breath to finish, so the band goes at once;
- in a breath in, hold or breath out, the band runs on to the end of the exhale and then goes, and the hint says so;
- in the hold after the exhale there is nothing left to finish, so it goes at once;
- if you send the next prompt while it winds down, the breath carries on without starting over.

While Claude asks you a question (the `AskUserQuestion` tool) the band steps aside, so it does not sit between you and the answer. The breath goes on behind it. When you have answered, the band comes back in the phase the clock has reached, and in Desktop it fades in again. A permission prompt is not a question in this sense: nothing in the plugin API tells it apart from a tool that is running, so the band stays.

Only the main conversation's turns count; a subagent working inside a turn does not start or end anything.

## Patterns

The `pattern` setting picks one. `phaseSeconds` sets each phase's length. `/breathe box`, `/breathe even` or `/breathe calm` picks one for the rest of the session, from the next turn on: a breath under way finishes in the pattern it began with.

| `pattern` | Phases | At 4 s | For |
| --- | --- | --- | --- |
| `box` (default) | in, hold, out, hold | 4-4-4-4 | the classic |
| `even` | in, out | 4-4 | when holding the breath feels unpleasant |
| `calm` | in, out for 1.5 times as long | 4-6 | winding down |

In the terminal the hint beside the bar names the pattern and its timing (`Ruhiges Atmen · 4-6`, `Calm Breathing · 4-6` in English). The Desktop band leaves it out.

## Where it shows

- **Terminal**: one line: first a bar that fills as you breathe in and empties as you breathe out, in steps of an eighth of a cell, then the phase (`Einatmen`, `Halten`, `Ausatmen`) in the phase's theme color, the seconds left, and on a wide terminal the hint (`Box Breathing · 4-4-4-4`), then the Hide button. There is no orb in the terminal.
- **Claude Desktop**: a band one line high: a small orb and one word beside it (the phase, or `Mach dich bereit 3` in the countdown), no seconds and no hint, and a close cross at the far end. The picture is 24 px high, the word 14 px. The orb and the word are one SVG without a background that animates itself with SMIL (the SVG's own animation), so they share one clock and the word changes exactly as the orb turns. The band sends the same picture for a whole breathing run, so the desktop app moves it at its own frame rate. It fades in over 0.8 s, and fades out ending as the last exhale ends (0.4 s when you press Hide). While Claude is finishing, a small note says so. On a very narrow band it is the same one line as in the terminal, which has nothing to fade.
- **Reduced motion**: when the system asks for less motion, the orb does not grow and shrink. Two still orbs, a small and a large, fade into each other at the same pace instead, and the words change as before.

Another mod's band above the prompt (the token forecast, a heads-up) is kept and drawn under the orb. A mod above this one in the chain that draws its own band without passing the rest on still hides it, as mods already do to each other.

## Use

- The **Ausblenden** button (`Hide` in English) takes the band away for the rest of the turn, for when you do not want to breathe along just now. In Claude Desktop it is a cross (✕) at the far end of the band, or the app's own close control where the app draws one. In the terminal it is a plain text button; click it, or where the terminal does not pass clicks on, focus the band with ctrl+x tab and press Enter. The next turn brings the band back.
- `/breathe` says whether it is on and which pattern it breathes. `/breathe off` mutes it for the session, `/breathe on` brings it back with the next turn, `/breathe box|even|calm` picks the pattern (see [Patterns](#patterns)).
- The band's own collapse (`[-]`, ctrl+x ctrl+a) hides it for the moment.

## Settings

Fields in `/config` (or `pluginConfigs` in settings).

| Field | Default | |
| --- | --- | --- |
| `pattern` | `box` | `box`, `even` or `calm`, see [Patterns](#patterns) |
| `phaseSeconds` | 4 | length of each phase (in `calm` the breath out is 1.5 times this), 2 to 10 |
| `countdownSeconds` | 3 | count down from this number to 0 before the first breath, a second for each number (3 shows 3, 2, 1, 0); 0 turns the countdown off, 0 to 10 |
| `startAfterSeconds` | 3 | wait this long into a turn before the band (the countdown first) appears, so a quick answer shows nothing; 0 shows it right away; a turn that ends before the first breath begins goes at once |
| `motion` | `auto` | `auto`: the orb grows and shrinks, unless the system asks for less motion. `reduced`: never, two still orbs fade into each other instead |
| `theme` | `auto` | which theme Claude Desktop is set to, `dark` or `light`, for the color of the word beside the orb. `auto` is a grey that reads on both, a little dim |
| `speak` | off | say each phase aloud (`Einatmen`, `Halten`, `Ausatmen`) with the system voice, on the machine where the session runs. macOS only |
| `language` | `de` | the words in the band and the spoken ones, `de` or `en` |

## Limits

- A timer asks for a redraw ten times a second (`$.ui.invalidate`) while a line of text is drawn: the terminal, or a Desktop window too narrow for the picture. For the Desktop picture, which moves by itself, it asks for none, but for the moment the band is due: a redraw draws the close button anew, and that flickers in the app. The picture is drawn anew only when the turn ends, Hide is pressed, or the band steps aside and comes back, in step with the breath. If the app itself reloads the picture at some other moment, it starts from where it was first drawn and is out of step until the next of these.
- The band is a site above the prompt, which the plugin API raises on the terminal and in Claude Desktop only. The mobile app and VS Code do not draw it, so `breathe` shows nothing there. A mobile version would need another site, for instance the backdrop behind the conversation, with no button on it.
- `speak` uses the system voice (`say` on macOS). Elsewhere the call is refused and the band goes on without sound. Each word is said when the clock enters its phase, up to a tenth of a second late.
- The word's color in the Desktop picture is a fixed grey that reads on a dark and on a light ground (about 4.4 to 1 and 3.3 to 1). The picture cannot see the app's theme, so it cannot follow it. The `theme` setting picks a color made for one (about 10 to 1 on dark, 8 to 1 on light).
- Reduced motion by `auto` is the system setting as the SVG sees it, and the app's own setting may differ; `motion: reduced` makes it certain. The picture has been checked in Chromium only.
- The Desktop band's height is the picture's 24 px plus what the app puts around it. Up to 0.4.1 the picture was not given a size as an element, and the app then draws it in a frame of 300 by 150 px whatever the SVG itself says: the band was 170 px high. That it is one line high now follows from that measurement and has not been seen in the app yet.

## Development

```bash
claude plugin test breathe
claude plugin validate breathe
```

The breathing itself (`hooks/pacer.ts`) and the picture's drawing (`hooks/orb.ts`: orb, words, countdown, fades, reduced motion) are plain functions with no engine in them, so they are tested directly; `hooks/breathe.tsx` holds the hooks and the layout. Because the desktop's words are inside the SVG, the tests for what the band says each second run on the terminal, and the SVG tests read the animation's key times. The tests count draws to check how often the band is redrawn, and stand in for the voice (`audio.speak`) and for Claude's question (a `tool.call` that waits).
