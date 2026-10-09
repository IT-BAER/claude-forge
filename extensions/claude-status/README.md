# Claude Status

The [cache-status](../../mods/cache-status) band for VS Code. Claude Code mods cannot draw above the prompt in the VS Code chat, so this extension shows the same values in the VS Code status bar.

`● c 42m │ ctx 184k │ rwc ≈ $1.20 │ sc $3.31 │ 5h 40% · w 24%`

| Part | Meaning |
| --- | --- |
| `c 42m` | Prompt cache state and minutes until it expires. Yellow 5 minutes before expiry, red once cold on a big context. |
| `ctx` | Tokens in context. |
| `rwc` | Rewrite cost: what writing the context into the cache again would cost if it expires. |
| `sc` | Session cost so far, at API list prices. |
| `5h`, `w` | 5-hour and weekly plan limits used. Yellow at 80 %, red at 95 %. |

Next to it sits the band's handoff button. It shows `handoff`, then `handoff queued` and `handoff running` while the session-handoff skill runs, then `clear and continue` once the handoff is ready, and `clearing` while the chat clears. Click `handoff` or `clear and continue` to run that step in the chat, as the band buttons do. The click writes a command file to `~/.claude/mods-data/cache-status/commands/`. The mod picks it up within 2 seconds.

Hover the item for the explanations. Click it, or run **Claude Status: Show All Sessions**, for every live Claude Code session on this machine, in /board order.

## Requirements

- The cache-status mod, at a version that writes live files (`~/.claude/mods-data/cache-status/live/`). Update it with `/plugin marketplace update claude-forge`, then start a new session.
- The item shows the session whose working directory is a folder of this VS Code window. A session started from the VS Code extension wins over a terminal or Desktop session in the same folder.

## Install

There is no Marketplace listing. Build and install the .vsix:

```
cd extensions/claude-status
npx @vscode/vsce package
code --install-extension claude-status-0.2.0.vsix
```

## How it works

The mod writes one JSON file per session on each heartbeat (about every 30 seconds, and after every turn). The extension reads that folder every 2 seconds. Files of ended sessions, and files older than 60 minutes, are ignored. Nothing leaves your machine.

## License

MIT. See [LICENSE](LICENSE).
