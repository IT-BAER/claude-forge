# claude-forge

Skills and mods for Claude Code. Each item has its own page with install steps, usage and screenshots. Click a name below.

## Mods

A mod adds a pane, a band or a command to Claude Code itself.

| Mod | What it does |
| --- | --- |
| [`file-explorer`](mods/file-explorer) | VS Code style file tree with preview, editor, search and find and replace in a pane. Command: `/files`. |

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
```

Terminal form: `claude plugin install file-explorer@claude-forge`. Start a new session afterwards.

### Without the marketplace

Copy the folder into your skills folder. Claude Code loads it at the next session start. This works for mods and for skills.

```bash
git clone https://github.com/IT-BAER/claude-forge.git
cp -r claude-forge/mods/file-explorer ~/.claude/skills/file-explorer
```

PowerShell:

```powershell
git clone https://github.com/IT-BAER/claude-forge.git
Copy-Item claude-forge\mods\file-explorer "$HOME\.claude\skills\file-explorer" -Recurse
```

To try a mod for one session only: `claude --plugin-dir claude-forge/mods/file-explorer`.

### Update and remove

```bash
claude plugin update file-explorer@claude-forge
claude plugin uninstall file-explorer@claude-forge
```

For a copied folder, pull the repository and copy again, or delete the folder in `~/.claude/skills/`.

## Layout

| Folder | Content |
| --- | --- |
| `mods/<name>/` | A Claude Code mod (hooks plugin) with its own `README.md` and `screenshots/`. |
| `skills/<name>/` | A skill: `SKILL.md` plus its helper files, with its own `README.md`. |

## Notes

- Items here are copied from a private source repo by an allowlist script. Nothing else from that repo is published.
- Mods target the Claude desktop Code tab and the mod API of Claude Code 2.1.x. The API changes between releases, so a mod can need updates after an upgrade.
- Issues and pull requests are welcome. Accepted changes are merged back into the private source by hand.

## License

MIT
