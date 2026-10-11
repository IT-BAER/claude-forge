# session-reaper

A Claude Code mod for the Claude desktop app on Windows. Every few minutes it:

1. Archives Code sessions that had no activity for longer than a limit (default 60 minutes). Running and pinned sessions are skipped; the app itself also refuses sessions that are open on screen or still have background work. Archived sessions can be restored from the Archived list.
2. Stops process trees that a session left behind. It records every process a `claude.exe` started (MCP servers, dev servers, shells). Once that `claude.exe` is gone, a tree is stopped only when every process in it is at least 60 minutes old and used almost no CPU since the previous check. `chrome.exe`, `msedge.exe`, `Code.exe`, `claude.exe`, `explorer.exe` and `WindowsTerminal.exe` are never stopped.

Every open session loads the mod, but only one of them does the work (a heartbeat in the plugin store picks it).

## Requirements

- Windows (the process step uses PowerShell and `Win32_Process`).
- The Claude desktop app's Code tab. The archive step calls the app's `ccd_session_mgmt` server, which other hosts (CLI, VS Code) do not have; there only the process step runs.
- In auto permission mode the archive call from a mod is refused unless it is allowed. Add this rule to `permissions.allow` in `~/.claude/settings.json`:

  ```json
  "mcp__ccd_session_mgmt__archive_session"
  ```

  The rule also lets Claude archive sessions in any chat without asking.

## Install

```
/plugin install session-reaper --marketplace IT-BAER/claude-forge
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `idleMinutes` | 60 | Archive a session idle for this many minutes |
| `orphanMinutes` | 60 | Minimum age of every process in a left-behind tree |
| `cpuIdleMs` | 1000 | Most CPU time (ms) a process may use between two checks and still count as idle |
| `intervalMinutes` | 5 | How often the active session checks |

Only processes seen under a running `claude.exe` while the mod runs are tracked; trees left behind before the mod loaded are not touched.
