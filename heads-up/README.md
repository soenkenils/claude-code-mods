# heads-up

Watches the running Claude Code session and shows a heads-up when something is off, so you notice a stuck or drifting run without reading along. It draws a band above the prompt (terminal and Claude Desktop) and raises a toast for warnings. It never blocks a call: it only tells you.

## What it watches

| Heads-up | Fires when | Clears when |
| --- | --- | --- |
| **Tool calls fail in a row** | 3 failed tool calls in a row (a subagent counts on its own) | a call succeeds, or you send a new prompt |
| **Tests fail in a row** | 3 failed test runs in a row (`npm test`, `pytest`, `cargo test`, `go test`, ...), edits in between do not reset it | a test run passes, or you send a new prompt |
| **Edit outside the project** | Edit, Write or NotebookEdit targets a file outside the session folder and project root. System and credential paths (`/etc`, `~/.ssh`, shell rc files) are an alert, the rest a warning | stays until you dismiss it (taken back if the edit was refused) |
| **Context grew by …** | one turn adds 40k tokens or more to the context, with the tools it ran | stays until you dismiss it |
| **Context is …% full** | the window passes 80%, again at 95% | compaction brings it below 70% |
| **No result after …** | a tool call has no result for 5 minutes (it may still run, or wait for your OK) | the call returns |
| **No activity for …** | a running turn shows no activity for 5 minutes | activity resumes, or the turn ends |
| **Same call, same result** | the same tool call returns the same result 3 times in a row (polling tools are exempt) | a different call follows, or you send a new prompt |

A dismissed heads-up stays quiet while its cause goes on, and comes back if the cause clears and returns. Repeats of an event (the same file edited again) count up instead of stacking.

## Use

- **Dismiss** in the band takes one heads-up down; with more than three showing, **Dismiss all** takes them all down.
- `/heads-up` lists what happened this session, newest first.
- `/heads-up clear` dismisses what is showing. `/heads-up off` mutes for the session, `/heads-up on` brings it back.

## Settings

Every threshold is a field in `/config` (or `pluginConfigs` in settings). `0` turns a watch off.

| Field | Default |
| --- | --- |
| `failureStreak` | 3 |
| `testFailures` | 3 |
| `contextJumpTokens` | 40000 |
| `contextPercent` | 80 |
| `stallMinutes` | 5 |
| `repeatCalls` | 3 |
| `watchEdits` | on |
| `ignorePaths` | `/tmp,/var/tmp,~/.claude` (plus the system temp folder) |
| `notify` | off: set it to also send a native notification for warnings, so a stalled run reaches you away from the window |

## Limits

It reads tool inputs and results, not the model. Test runs are recognised by their command line, so a wrapper script that runs tests under another name is not counted. A path check follows no symbolic links. The stall watch cannot tell a hung command from one waiting for a permission prompt, and says "no result" rather than "hung" for that reason.
