---
name: session-handoff
description: "Create or consume a session handoff for an actual context reset, task transfer, resume, or long-session continuation. Trigger on session handoff, hand off, wrap up session, handoff file, resume handoff, restart packet, context reset, clear context, or resume previous work. Do not trigger from the word compact alone or for routine progress summaries."
argument-hint: "What should the next session or recipient focus on?"
---

# Session Handoff

Preserve the state needed to continue correctly, without carrying stale conversation context.

Treat `$ARGUMENTS` as the destination or next-session focus. If it is empty, infer the immediate continuation from the current request. Tailor the handoff to that recipient and focus.

## Create a handoff

Write the handoff to a file, then give the user a compact summary and resume line.

**Path:** `~/.claude/handoffs/<repo-slug>/<time>-<host>.md`. The claude-config sync carries this folder to every machine, so a handoff written on one PC can be resumed on another. Nothing is written into the project, so its `.gitignore` and `.git/info/exclude` stay untouched. Legacy repo-local `session-handoff.md` and `restart-packet.md` files are still detected and consumed.

**Handoff files only.** `~/.claude/handoffs/` holds handoff `.md` files and nothing else: no plans, ledgers, evidence, CSVs, scripts or subfolders. The session band treats every `.md` under that tree as a handoff and offers "clear and continue" on it. Evidence that must survive the session or reach another machine goes to `~/.claude/handoff-evidence/<repo-slug>/<topic>/`; everything else stays in the session scratchpad. That folder syncs only once `!/handoff-evidence/` is in the claude-config `.gitignore` allowlist; until then, say in `## Risks` that the evidence is local to the host. The handoff references those files by absolute path.

`$H` below means `powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/session-handoff/scripts/handoff.ps1`.

1. **Prepare:** `$H -Action Prepare -Cwd "<project root>"`. Write the handoff to the printed `path:`. Use the printed `resume-path:` in the resume line. Prepare also deletes consumed handoffs of this repo that are older than 14 days.
2. **Code state:** `$H -Action WipPush -Cwd "<project root>" -Topic "<short topic>"`. It snapshots uncommitted work (and unpushed commits) to a new `wip/<topic>-<time>` branch on `origin`. It never changes the current branch, index or working tree, never force-pushes, and never pushes to the working branch, where a push could start CI or auto-merge.
   - `CLEAN:` the remote already has everything.
   - `PUSHED: branch=... commit=... parent=... base=...` record all four values in `## Location` and put the matching `WipRestore` command into `## Resume commands`.
   - `NO-GIT:` not a repository; nothing to push.
   - `NO-REMOTE:`, `NO-COMMITS:` or `FAILED:` state in `## Risks` that the changes exist only on this host and block a resume elsewhere.
3. **Sync:** after the file is written, `$H -Action Sync -File "<path>"`. Report its result line. `NOT SYNCED:` blocks a machine switch; say so in the summary. `SKIPPED:` means this machine has no claude-config sync.

**Creation rules:**

- Review the full current conversation, not only the last few turns.
- Synthesize from current-session evidence. Run only targeted checks needed to prevent false state, such as the current time, `git status`, branch, or an explicitly cited test. Do not run `git log`, glob sweeps, or broad filesystem audits to rediscover known work.
- Paths inside the project are repository-relative; give the `origin` URL once in `## Location`, because the other machine may keep the checkout in another folder. Paths outside the project are absolute and belong to the host in the header.
- Reference durable specs, plans, architecture decision records, issues, commits, diffs, and progress ledgers instead of copying or duplicating their settled detail.
- Never include secrets, tokens, API keys, passwords, private keys, raw PII, or secret-bearing configuration. Name a safe credential location or required access mechanism without exposing its value.
- Separate verified facts from assumptions. Label anything unverified and keep superseded hypotheses out.
- Keep it compact, but retain every detail needed to continue safely: the authoritative completion set and its source identifiers, unresolved user intent, exact verification evidence, running processes, risks, and recovery commands.

**First line of the file:**

`<!-- handoff: <actual current ISO-8601 timestamp> | session: ${CLAUDE_SESSION_ID} | host: <hostname> | repo: <origin URL or none> | status: active -->`

Use the real current time, including timezone or `Z`. Never invent or round the timestamp. Keep `status:` last; the hooks read it there.

**Required sections, all 12, in this order. Write `none` under a header rather than omitting it:**

1. `## Goal`
2. `## Location` (host, `origin` URL, checkout path on this host, branch, worktree, relevant Git state, and the WIP branch, commit, parent and base when WipPush pushed)
3. `## Files changed` (absolute paths and concise purpose)
4. `## Tests/builds run` (exact commands and results, including failures)
5. `## Root cause / hypothesis` (mark hypotheses as unverified)
6. `## Decisions` (include important rejected alternatives only when they constrain continuation)
7. `## Remaining steps` (only in-scope executable work; preserve source identifiers, status, and acceptance behavior; do not mix in unrelated findings or optional future work)
8. `## Open questions` (user input that blocks an in-scope step, plus explicitly deferred or out-of-scope items, clearly labelled)
9. `## Running state` (background task IDs, check and stop commands, servers and ports, open worktrees)
10. `## Risks`
11. `## Suggested skills` (zero to five exact installed or repository skill names, each with why it helps; otherwise `none`)
12. `## Resume commands` (each as `command` - expected outcome, so the recipient can distinguish success from breakage)

Do not include raw logs, transcripts, full file contents, or obsolete hypotheses.

## Suggested skills guidance

Recommend only skills that the recipient can actually discover and that directly help with remaining work. Use exact skill names, one short reason each, and no speculative tool shopping.

**After writing the file**, output in chat:

1. A summary of five lines or fewer.
2. A ready-to-copy resume line in a fenced code block, exactly:

```
Continue from session handoff: read <resume-path>, consume it with session-handoff, do not re-explore.
```

3. Ask the user to `/clear` only when restarting this session to continue the same work. For a transfer, fork, or handoff to another recipient, give the path and do not ask the current user to clear.

## Consume a handoff

When resuming from a handoff:

0. For a handoff under `~/.claude/handoffs/`, run `$H -Action Sync` first, so a handoff pushed from the other machine is pulled. Then find the local checkout of the header's `repo:`. If `## Location` names a WIP branch, run `$H -Action WipRestore -Cwd "<checkout>" -Branch <wip branch> -Base <base> -Parent <parent>`. `ALREADY-CONTAINED:` means the base already holds the WIP; continue. On `BLOCKED:` stop and report it; never stash, reset or discard local work to get past it. The WIP branch stays on the remote; deleting it later needs the user's approval.
1. Read the file and check its timestamp and status. If a progress ledger, current Git state, or another authoritative source is newer or contradicts it, trust the newer source and name the conflict.
2. Build one authoritative execution ledger from the handoff goal and every numbered remaining step. Preserve source identifiers and do not replace the full ledger with the next batch, the open questions, or a shorter summary.
3. Restate the goal and current state in five bullets or fewer, including the count of open in-scope ledger items.
4. Identify the next concrete action. A decision about one step resolves only that step; continue through the ledger until every item is verified complete, measured-blocked, or explicitly excluded by the user.
5. If this session will continue the handed-off work, change only the header from `status: active` to `status: consumed` before starting. This retires the detector prompt while preserving the artifact. The change syncs at session end; run `$H -Action Sync -File "<path>"` when switching machines before that. Do not mark it consumed when the current request is unrelated.
6. Do not re-explore the codebase unless a handoff assumption is contradicted or required evidence is missing.
7. Preserve the listed quality gates, safety constraints, tests, root-cause reasoning, and verification requirements.
8. Before ending or switching to unrelated work, reconcile the ledger against the handoff source. Never claim completion while an in-scope item is open or partial. Create a new active handoff only if unfinished state genuinely needs transfer.
