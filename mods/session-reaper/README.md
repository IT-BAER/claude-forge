# session-reaper

A Claude Code mod for Windows: the Claude desktop app, the VS Code extension and the CLI. Every few minutes it:

1. Releases Code sessions that had no activity for longer than a limit (default 60 minutes): it stops the session's own process tree (`claude.exe`, its MCP servers, shells and helpers). The session stays in the sidebar, keeps its conversation, and the app starts a fresh process when you open it again and send a message. Running sessions, and sessions whose side session is still working, are skipped. Pinned sessions are released like any other.
2. Releases VS Code and CLI sessions the same way after the same limit, their `claude.exe` included. Each such session records when its last turn started or ended; a session with a turn in progress, a background task (shell, monitor, subagent, workflow) or a scheduled wakeup (`/loop`, CronCreate, ScheduleWakeup) is skipped. The conversation stays in its transcript on disk.
3. Optionally archives sessions idle for longer than a second limit (`archiveMinutes`, off by default). Running and pinned sessions are skipped; the app itself also refuses sessions that are open on screen or still have background work. Archived sessions can be restored from the Archived list.
4. Stops process trees that a session left behind. It records every process a `claude.exe` started (MCP servers, dev servers, shells). Once that `claude.exe` is gone, a tree is stopped only when every process in it is at least 60 minutes old and used almost no CPU since the previous check. `chrome.exe`, `msedge.exe`, `Code.exe`, `claude.exe`, `explorer.exe` and `WindowsTerminal.exe` are never stopped (a released session's own `claude.exe` is the one exception).

Every open session loads the mod. Each one reports its own `claude.exe` to the plugin store once, so the sessions can be mapped to their processes; a heartbeat in the plugin store picks one session to do the work. Releasing and archiving desktop sessions have one leader per desktop app instance, because the app lists only its own sessions; two instances with different data folders each release their own. Releasing VS Code and CLI sessions and orphan cleanup have one leader for the whole machine: a desktop session takes it over from a CLI or VS Code session, which leads only while no desktop session runs.

## Why it exists

Each desktop Code session keeps its own `claude.exe` (about 0.4 GB) plus its own copy of every MCP server, about 1.6 to 3.2 GB per session in all, and none of it goes away while the session sits in the sidebar. On a 32 GB machine, a day of work left 38 `claude.exe` (15 GB) and 88 `node.exe` (8 GB) processes running, the commit charge reached 47.1 of 47.6 GB, and Chrome crashed with an out-of-memory error. Releasing the idle sessions frees that memory without losing the sessions.

## Requirements

- Windows installed in `C:\Windows` (the process steps run `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` by its fixed path and read `Win32_Process`).
- For desktop sessions, the Claude desktop app's Code tab: their release and archive steps call the app's `ccd_session_mgmt` server.
- For VS Code and CLI sessions, an installation without managed settings: where an organization manages Claude Code, the `Stop` event that reports background tasks and wakeups does not reach an installed plugin, so such a session could be released while it waits for one.
- Remote Control: a released session is no longer served to claude.ai/code until it is opened again on the computer.
- In auto permission mode the archive call from a mod is refused unless it is allowed. If you turn archiving on, add this rule to `permissions.allow` in `~/.claude/settings.json`:

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
| `idleMinutes` | 60 | Release a session idle for this many minutes (stop its process tree; a desktop session stays in the sidebar, a VS Code or CLI session in its transcript) |
| `archiveMinutes` | 0 | Also archive a session idle for this many minutes; 0 = never |
| `orphanMinutes` | 60 | Minimum age of every process in a left-behind tree |
| `cpuIdleMs` | 1000 | Most CPU time (ms) a process may use between two checks and still count as idle |
| `intervalMinutes` | 5 | How often the active session checks |

Only sessions that loaded this version of the mod can be released (a session loads it when it starts), and only processes seen under a running `claude.exe` while the mod runs are tracked as orphans; trees left behind before the mod loaded are not touched.
