# desktop-update

A Claude Code mod for the Claude desktop app on Windows (MSIX install). When Anthropic's update feed offers a newer Desktop version than the installed one, a line shows above the prompt:

```
Claude Desktop 4.4300.0 is available (installed 4.4212.0)        auto-update on   later   update
```

- **update** asks first, because the install closes every Claude Desktop window and its sessions. **install** then starts the installer and the line shows that it runs.
- **later** hides this version. The line comes back for the next newer version.
- **auto-update on** / **auto-update off** switches Desktop's own updater (see below). While Desktop's updater is on, the mod shows a row for this switch even when no update is offered.

The installer downloads the MSIX named by the feed, checks its SHA256 against the feed, installs it with `Add-AppxPackage -ForceApplicationShutdown` and starts Desktop again. It runs outside the session (started through `Win32_Process.Create`), so it keeps going when Desktop closes. Its log is `%LOCALAPPDATA%\claude-desktop-update\install.log`. The line shows "Installing" until the new version is installed, or for 30 minutes; after that the update is offered again. To check a download without installing, run the script by hand with `-Url`, `-Sha256`, `-Version` from the feed and `-NoInstall`.

## Why it exists

Desktop can restart itself to apply a downloaded update while you are away from the window, which ends running sessions. The policy value `disableAutoUpdates` = 1 under `HKCU\SOFTWARE\Policies\Claude` turns the built-in updater off, but then Desktop no longer says when an update exists. This mod brings the notice back and leaves the install to you.

## How it checks

- At session start and every 6 hours, the mod reads the installed version (`Get-AppxPackage -Name Claude`) and asks `https://api.anthropic.com/api/desktop/win32/x64/msix/update` with that version, the Windows build and a random device id the mod creates once. The feed is undocumented; Anthropic rolls releases out in stages by device id, so this id can see a release earlier or later than Desktop's own.
- The feed answer is shared through the plugin store for 6 hours, so new sessions do not ask again.
- Any error (no Claude package, HTTP error, unknown answer) shows nothing. Only `https://downloads.claude.ai/` download URLs are accepted.

## Auto-update switch

Desktop's own updater follows the policy value `disableAutoUpdates` under `HKCU\SOFTWARE\Policies\Claude` (1 = off). The mod reads it at session start and every 6 hours, from the real registry through WMI, not from the Desktop package's private view.

- While the updater is on: a row `Claude Desktop auto-update is on` with **auto-update off**.
- While it is off: no row until an update is offered; the update line then carries **auto-update on**.
- A press writes the value with an elevated `reg.exe`, so Windows shows a UAC prompt. Without local admin rights, Windows asks for an admin account. The value is written under `HKEY_USERS\<your SID>`, so it lands in your registry even when the UAC account is another one. Turning the updater on writes 0; the key is never deleted.
- Desktop reads the value when it starts: restart every Desktop window of your Windows user afterwards. The value counts for every Desktop profile of that user.
- A machine-wide value under `HKLM\SOFTWARE\Policies\Claude` wins over yours; the mod then shows no switch.
- Log: `%LOCALAPPDATA%\claude-desktop-update\autoupdate.log`. If the UAC prompt is cancelled or not answered within 2 minutes, the mod says that nothing changed.

## Install

```
/plugin install desktop-update@claude-forge
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `relaunch` | empty | `cmd.exe` command line run after the install to start Desktop again; join several commands with `&`. Empty: the Start menu entry of the Claude package. Set it when you start Desktop through your own launcher, for example one per profile. A file `%LOCALAPPDATA%\claude-desktop-update\relaunch.cmd` wins over this option; use it when your settings are synced between PCs with different launchers. |

## Requirements

- Windows with Windows PowerShell 5.1 in `C:\Windows\System32\WindowsPowerShell\v1.0`.
- Claude Desktop installed as the MSIX package `Claude_pzs8sxrjxfjjc`.
- For the auto-update switch: credentials of a local admin account for the UAC prompt.
