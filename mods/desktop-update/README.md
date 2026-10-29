# desktop-update

A Claude Code mod for the Claude desktop app on Windows (MSIX install). When Anthropic's update feed offers a newer Desktop version than the installed one, a line shows above the prompt:

```
Claude Desktop 4.4300.0 is available (installed 4.4212.0)   update   later
```

- **update** asks first, because the install closes every Claude Desktop window and its sessions. **install** then starts the installer and the line shows that it runs.
- **later** hides this version. The line comes back for the next newer version.

The installer downloads the MSIX named by the feed, checks its SHA256 against the feed, installs it with `Add-AppxPackage -ForceApplicationShutdown` and starts Desktop again. It runs outside the session (started through `Win32_Process.Create`), so it keeps going when Desktop closes. Its log is `%LOCALAPPDATA%\claude-desktop-update\install.log`.

## Why it exists

Desktop can restart itself to apply a downloaded update while you are away from the window, which ends running sessions. The policy value `disableAutoUpdates` = 1 under `HKCU\SOFTWARE\Policies\Claude` turns the built-in updater off, but then Desktop no longer says when an update exists. This mod brings the notice back and leaves the install to you.

## How it checks

- At session start and every 6 hours, the mod reads the installed version (`Get-AppxPackage -Name Claude`) and asks `https://api.anthropic.com/api/desktop/win32/x64/msix/update` with that version, the Windows build and a random device id the mod creates once. The feed is undocumented; Anthropic rolls releases out in stages by device id, so this id can see a release earlier or later than Desktop's own.
- The feed answer is shared through the plugin store for 6 hours, so new sessions do not ask again.
- Any error (no Claude package, HTTP error, unknown answer) shows nothing. Only `https://downloads.claude.ai/` download URLs are accepted.

## Install

```
/plugin install desktop-update@claude-forge
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `relaunch` | empty | `cmd.exe` command line run after the install to start Desktop again; join several commands with `&`. Empty: the Start menu entry of the Claude package. Set it when you start Desktop through your own launcher, for example one per profile. |

## Requirements

- Windows with Windows PowerShell 5.1 in `C:\Windows\System32\WindowsPowerShell\v1.0`.
- Claude Desktop installed as the MSIX package `Claude_pzs8sxrjxfjjc`.
