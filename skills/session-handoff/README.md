# session-handoff

A skill that writes the state of a Claude Code session to a file, so a fresh chat can continue the work after `/clear`, in another window, or on another day.

The [cache-status](../../mods/cache-status) mod bundles a chat-only handoff skill (from Cache Keeper by Nate Herk). This one writes a file instead, with a fixed header and 12 sections, and has a consume step for the next chat.

## What it writes

The file goes to `<repo>/.claude/session-handoff.md` (or `.superpowers/sdd/session-handoff.md` if the project already uses that folder). Inside a Git repository the skill adds the path to `.git/info/exclude`, so the handoff is not committed by accident.

First line:

```
<!-- handoff: 2026-10-09T22:52:48+02:00 | session: <session id> | status: active -->
```

Then these sections, always all 12, `none` where there is nothing to say: Goal, Location, Files changed, Tests/builds run, Root cause / hypothesis, Decisions, Remaining steps, Open questions, Running state, Risks, Suggested skills, Resume commands.

In chat it prints a short summary and a resume line:

```
Continue from session handoff: read <full handoff path>, consume it with session-handoff, do not re-explore.
```

## Consume

In the new chat, paste the resume line. The skill reads the file, restates the goal in five bullets or fewer, names the next action and changes the header to `status: consumed`. A consumed file is not offered again.

## With cache-status and claude-status

The `handoff` button of the cache-status band (and of the claude-status bar in VS Code) runs a skill named exactly `session-handoff` first, and the mod's bundled one only if that is missing. So with this skill installed the button writes the file. Once the file is written, the button turns into `clear and continue`: it clears the chat and puts the resume line into the prompt box.

## Install

```bash
git clone https://github.com/IT-BAER/claude-forge.git
mkdir -p ~/.claude/skills
cp -r claude-forge/skills/session-handoff ~/.claude/skills/session-handoff
```

Start a new session. Run it with `/session-handoff`, or say "hand off" or "wrap up session".

## Limits

- The skill writes what the model knows from the current chat. Work from an earlier chat that was not handed off is not in it.
- Long chats give long handoffs. Read the file before you clear; it is the only thing the next chat gets.

## License

MIT
