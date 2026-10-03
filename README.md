# claude-forge

Skills and mods for Claude Code, published from a private config repo.

## Layout

| Folder | Content |
| --- | --- |
| `skills/<name>/` | A skill: `SKILL.md` plus its helper files. Copy the folder into `~/.claude/skills/`. |
| `mods/<name>/` | A Claude Code mod (hooks plugin). Load it with `claude --plugin-dir mods/<name>`. |

## Mods

| Mod | Description |
| --- | --- |
| `file-explorer` | VS Code style file tree of the session's working directory in a pane. Command: `/files`. |

## Notes

- Items here are copied from a private source repo by an allowlist script. Nothing else from that repo is published.
- Mods target the Claude desktop Code tab and the mod API of Claude Code 2.1.x. The API changes between releases, so a mod can need updates after an upgrade.
- Issues and pull requests are welcome. Accepted changes are merged back into the private source by hand.

## License

MIT
