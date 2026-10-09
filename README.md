# claude-forge

Skills and mods for Claude Code. Each item has its own page with install steps, usage and screenshots. Click a name below.

## Mods

A mod adds a pane, a band or a command to Claude Code itself.

| Mod | What it does |
| --- | --- |
| [`file-explorer`](mods/file-explorer) | VS Code style file tree with preview, editor, search and find and replace in a pane. Command: `/files`. Windows only. |
| [`cache-status`](mods/cache-status) | Prompt cache band above the prompt (cache time, context, rewrite cost, session cost, plan limits) with a cold-send guard, keep-warm, `/board` and `/handoff`. Fork of Cache Keeper by Nate Herk. |

## VS Code extensions

| Extension | What it does |
| --- | --- |
| [`claude-status`](extensions/claude-status) | The `cache-status` values in the VS Code status bar, because mods cannot draw above the prompt in the VS Code chat. **Does nothing without the `cache-status` mod**: install the mod first, then the extension from a built .vsix. |

## Skills

A skill teaches Claude a repeatable task. No skills are published yet.

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
/plugin install file-explorer@claude-forge
/plugin install cache-status@claude-forge
```

Terminal form: `claude plugin install file-explorer@claude-forge`. Start a new session afterwards.

### Without the marketplace

Copy the folder into your skills folder. Claude Code loads it at the next session start. This works for mods and for skills. A mod can have its own limits, for example `file-explorer` runs on Windows only.

```bash
git clone https://github.com/IT-BAER/claude-forge.git
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/file-explorer
cp -r claude-forge/mods/file-explorer ~/.claude/skills/file-explorer
```

PowerShell:

```powershell
git clone https://github.com/IT-BAER/claude-forge.git
Remove-Item "$HOME\.claude\skills\file-explorer" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item claude-forge\mods\file-explorer "$HOME\.claude\skills\file-explorer" -Recurse
```

To try a mod for one session only: `claude --plugin-dir claude-forge/mods/file-explorer`.

### Update and remove

```bash
claude plugin update file-explorer@claude-forge
claude plugin uninstall file-explorer@claude-forge
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
