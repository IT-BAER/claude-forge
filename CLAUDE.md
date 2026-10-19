# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Public publish target for Claude Code mods, one skill and one VS Code extension. Items are
copied in from a private source repo by an allowlist script; changes accepted here are merged
back into that repo by hand. `.claude-plugin/marketplace.json` lists the installable mods; it
pins no versions, so every commit on `main` is an update for marketplace users.

## Layout

- `mods/<name>/`: a hooks-plugin mod. `hooks/hooks.json` names the `register.*` module,
  `.claude-plugin/plugin.json` holds name, description and `userConfig`, tests sit in `tests/`.
  `file-explorer` (tsx + `.ps1` helpers) and `session-reaper` (ts + `procs.ps1`) are Windows
  only; `session-band` is plain `.mjs`.
- `skills/session-handoff/`: the file-writing handoff skill. `mods/session-band/skills/`
  bundles a different, chat-only skill of the same name. Keep them apart.
- `extensions/claude-status/`: VS Code extension, plain JS without a bundler. It only reads the
  per-session JSON files that the `session-band` mod writes.

## Commands

Mod tests run only through the Claude CLI (`*.test.ts` import `claude-code/testing`). Run per
mod; the repo root has no hooks module and is rejected:

```
claude plugin test mods/file-explorer
claude plugin test mods/session-band
claude plugin test mods/session-reaper
```

If `claude` is not on PATH, use `~\.local\bin\claude.exe`. To try a mod in one session without
installing it: `claude --plugin-dir mods/<name>`.

file-explorer's PowerShell helpers have their own tests (they call `powershell.exe` 5.1
internally). Each prints `{"Passed":N,...}` and exits 0, or throws `FAIL: <label>`:

```
pwsh -NoProfile -File mods/file-explorer/tests/fileio.test.ps1
pwsh -NoProfile -File mods/file-explorer/tests/fileop.test.ps1
```

Extension, from `extensions/claude-status/`:

```
node --test                 # same as npm test
npx @vscode/vsce package    # builds claude-status-<version>.vsix (gitignored)
```

## Gotchas

- The repo root also holds a copied Claude config dir (`sessions/`, `state/`, `cache/`,
  `settings.json`, `policy-limits.json`, ...). Those paths are excluded in `.git/info/exclude`,
  not in `.gitignore`, so `git status` is clean. Never add or edit them as project files.
- `hooks/fmt.mjs`, `pricing.mjs` and `privacy.mjs` are copies synced from the private repo
  (`_dev/sync-shared.mjs` is not in this repo). Edit them upstream, or the next sync overwrites.
- `session-band/tests/live.test.ts` can fail one timing test on a cold first run (seen once in
  three runs). Rerun once before investigating.
- Mods target the Claude Code 2.1.x mod API (`claude-code` module), which changes between
  releases. There is no root `package.json` or `node_modules`; `tsconfig.json` is gitignored.
