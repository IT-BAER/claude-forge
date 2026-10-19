# session-handoff

A skill that writes the state of a Claude Code session to a file, so a fresh chat can continue the work after `/clear`, in another window, on another day or on another machine.

The [session-band](../../mods/session-band) mod bundles a chat-only handoff skill (from Cache Keeper by Nate Herk). This one writes a file instead, with a fixed header and 12 sections, and has a consume step for the next chat. The band's [autonomous mode](../../mods/session-band#autonomous-mode-a) needs this skill.

## Requirements

- Windows. The skill runs its helper with `powershell` (Windows PowerShell 5.1).
- Git, for the `WipPush` and `WipRestore` steps.

## What it writes

The file goes to `~/.claude/handoffs/<repo-slug>/<time>-<host>.md`. The slug is `owner-repo` from the project's `origin` URL, or `local-<folder>` without one. Nothing is written into the project.

First line:

```
<!-- handoff: 2026-10-09T22:52:48+02:00 | session: <session id> | host: <hostname> | repo: <origin URL> | status: active -->
```

Then these sections, always all 12, `none` where there is nothing to say: Goal, Location, Files changed, Tests/builds run, Root cause / hypothesis, Decisions, Remaining steps, Open questions, Running state, Risks, Suggested skills, Resume commands.

In chat it prints a short summary and a resume line:

```
Continue from session handoff: read <resume path>, consume it with session-handoff, do not re-explore.
```

## Consume

In the new chat, paste the resume line. The skill reads the file, restates the goal in five bullets or fewer, names the next action and changes the header to `status: consumed`. A consumed file is not offered again.

## Two machines

`scripts/handoff.ps1` does the mechanical parts:

| Action | What it does |
|---|---|
| `Prepare` | Prints the file path and the `~` resume path, deletes consumed handoffs older than 14 days. |
| `WipPush` | Snapshots uncommitted work to a new `wip/<topic>-<time>` branch on `origin`. The current branch, index and working tree stay as they are. |
| `Sync` | Runs the claude-config sync (`hooks/sync/claude-sync.sh` through Git Bash) and checks that the handoff is on the remote. |
| `WipRestore` | On the other machine: checks out the base commit and applies the WIP branch as uncommitted changes. Refuses on a dirty tree. When the base moved past the parent, merges the WIP three-way onto it: `ALREADY-CONTAINED` if nothing is left to apply, `BLOCKED` with the paths if newer commits changed the same lines. |

Without a git-synced `~/.claude` (the claude-config setup), `Sync` prints `SKIPPED` and the handoff stays local. The other actions work without it.

## With session-band and claude-status

The `handoff` button of the session-band band (and of the claude-status bar in VS Code) runs a skill named exactly `session-handoff` first, and the mod's bundled one only if that is missing. So with this skill installed the button writes the file. Once the file is written, the button turns into `clear and continue`: it clears the chat and puts the resume line into the prompt box. In autonomous mode the band does that by itself.

## Install

```bash
git clone https://github.com/IT-BAER/claude-forge.git
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/session-handoff
cp -r claude-forge/skills/session-handoff ~/.claude/skills/session-handoff
```

PowerShell:

```powershell
git clone https://github.com/IT-BAER/claude-forge.git
Remove-Item "$HOME\.claude\skills\session-handoff" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item claude-forge\skills\session-handoff "$HOME\.claude\skills\session-handoff" -Recurse
```

The folder must be `~/.claude/skills/session-handoff`, because `SKILL.md` calls `scripts/handoff.ps1` by that path. Start a new session. Run it with `/session-handoff`, or say "hand off" or "wrap up session".

## Limits

- The skill writes what the model knows from the current chat. Work from an earlier chat that was not handed off is not in it.
- Long chats give long handoffs. Read the file before you clear; it is the only thing the next chat gets.
- Handoff text is pushed to the claude-config remote. Keep that repository private; the skill's no-secrets rule is the only content check.
- WIP branches stay on the project remote until you delete them. On a public repository they are public, including untracked files that are not ignored.

## License

MIT
