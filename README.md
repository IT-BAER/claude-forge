# claude-forge

Skills and mods for Claude Code. Each item has its own page with install steps, usage and screenshots. Click a name below.

## Mods

A mod adds a pane, a band or a command to Claude Code itself.

| Mod | What it does |
| --- | --- |
| [`desktop-update`](mods/desktop-update) | A line above the prompt when a newer Claude Desktop is on Anthropic's update feed, with a one-click install that closes Desktop, updates the MSIX package and starts it again, plus a switch that turns Desktop's own auto-update off or on (policy value, UAC prompt). Windows only. |
| [`file-explorer`](mods/file-explorer) | VS Code style file tree with preview, editor, search and find and replace in a pane. Command: `/files`. Windows only. |
| [`prompt-templates`](mods/prompt-templates) | Prompt template library in a pane: search, tags, `{{variables}}` with a fill-in form, and Fill, Insert, Send or Copy for each template; editor and JSON import/export. Command: `/prompts`. |
| [`session-band`](mods/session-band) | Prompt cache band above the prompt (cache time, context, rewrite cost, session cost, plan limits) with a cold-send guard, keep-warm, board and handoff (all under `/session-band`) and an autonomous mode that clears and continues each handoff without you (needs the `session-handoff` skill). Fork of Cache Keeper by Nate Herk. |
| [`session-reaper`](mods/session-reaper) | Archives desktop sessions idle for more than 60 minutes and stops idle process trees (MCP servers, dev servers) left behind by ended sessions, which otherwise fill RAM until other apps run out of memory. Windows and the desktop Code tab only; needs one permission rule in auto mode. |
| [`skill-manager`](mods/skill-manager) | Lists every installed skill (user, project, plugin) in a pane with its source, use count and last use; checks GitHub for newer versions, updates a skill from its source, and moves unwanted skills to a trash folder. Command: `/skill-manager`. |

## VS Code extensions

| Extension | What it does |
| --- | --- |
| [`claude-status`](extensions/claude-status) | The `session-band` values in the VS Code status bar, because mods cannot draw above the prompt in the VS Code chat. **Does nothing without the `session-band` mod**: install the mod first, then the extension from a built .vsix. |

## Skills

A skill teaches Claude a repeatable task. Install a skill by copying its folder (see [Without the marketplace](#without-the-marketplace)).

| Skill | What it does |
| --- | --- |
| [`session-handoff`](skills/session-handoff) | Writes the session state to `~/.claude/handoffs/<repo>/` (12 fixed sections) so a fresh chat can continue, also on another machine, and consumes it in the next chat. The `session-band` handoff button uses it when installed; its autonomous mode needs it. Windows. |

## Install

Start with the marketplace. It takes two commands and gives you updates.

### 1. Add the marketplace (once)

In Claude Code:

```
/plugin marketplace add IT-BAER/claude-forge
```

Or in a terminal:

```bash
claude plugin marketplace add IT-BAER/claude-forge
```

### 2. Install what you want

```
/plugin install desktop-update@claude-forge
/plugin install file-explorer@claude-forge
/plugin install prompt-templates@claude-forge
/plugin install session-band@claude-forge
/plugin install session-reaper@claude-forge
/plugin install skill-manager@claude-forge
```

Terminal form: `claude plugin install file-explorer@claude-forge`. Start a new session afterwards.

### Without the marketplace

Copy the folder into your skills folder. Claude Code loads it at the next session start. This works for mods and for skills. A mod can have its own limits, for example `file-explorer` runs on Windows only.

```bash
git clone https://github.com/IT-BAER/claude-forge.git
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/file-explorer
cp -r claude-forge/mods/file-explorer ~/.claude/skills/file-explorer
rm -rf ~/.claude/skills/prompt-templates
cp -r claude-forge/mods/prompt-templates ~/.claude/skills/prompt-templates
```

PowerShell:

```powershell
git clone https://github.com/IT-BAER/claude-forge.git
Remove-Item "$HOME\.claude\skills\file-explorer" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item claude-forge\mods\file-explorer "$HOME\.claude\skills\file-explorer" -Recurse
Remove-Item "$HOME\.claude\skills\prompt-templates" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item claude-forge\mods\prompt-templates "$HOME\.claude\skills\prompt-templates" -Recurse
```

To try a mod for one session only: `claude --plugin-dir claude-forge/mods/file-explorer` or `claude --plugin-dir claude-forge/mods/prompt-templates`.

### Update and remove

```bash
claude plugin update file-explorer@claude-forge
claude plugin update prompt-templates@claude-forge
claude plugin uninstall file-explorer@claude-forge
claude plugin uninstall prompt-templates@claude-forge
```

The marketplace plugin has no pinned version, so every new commit in this repository counts as an update. For a copied folder, pull the repository and run the `rm` and `cp` lines again, or delete the folder in `~/.claude/skills/`.

## Layout

| Folder | Content |
| --- | --- |
| `mods/<name>/` | A Claude Code mod (hooks plugin) with its own `README.md` and `screenshots/`. |
| `skills/<name>/` | A skill: `SKILL.md` plus its helper files, with its own `README.md`. |
| `extensions/<name>/` | A VS Code extension, built with `npx @vscode/vsce package`. |

## Notes

- Items here are copied from a private source repo by an allowlist script. Nothing else from that repo is published.
- Mods target the Claude desktop Code tab and the mod API of Claude Code 2.1.x. The API changes between releases, so a mod can need updates after an upgrade.
- Issues and pull requests are welcome. Accepted changes are merged back into the private source by hand.

## License

MIT
