import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { PaneView, ScopeFilter, SkillRow, SkillScope, SortKey, UpdateInfo, UsageMap } from '../types'
import type { Paths, UpdateBatch } from './core'
import {
  ago,
  fit,
  shortName,
  lastShort,
  listLines,
  listWindow,
  clickSort,
  sortDir,
  canDelete,
  githubSource,
  importedUsage,
  isModifiedAfter,
  lastLine,
  plainText,
  folderListing,
  lockSkills,
  mergeUsage,
  parseFrontmatter,
  pathsFrom,
  pluginInstalls,
  UPDATE_ENV,
  updateBatches,
  updateChecks,
  updatedRows,
  usageOf,
  visibleRows,
} from './core'

const PANE = 'skill-manager'

const rowsAtom = atom({ plugin: 'skill-manager', key: 'rows' } as const, [] as SkillRow[])
const usageAtom = atom({ plugin: 'skill-manager', key: 'usage' } as const, {} as UsageMap)
const updatesAtom = atom({ plugin: 'skill-manager', key: 'updates' } as const, {} as Record<string, UpdateInfo>)
const viewAtom = atom({ plugin: 'skill-manager', key: 'view' } as const, {
  scope: 'all',
  sort: 'uses',
  text: '',
  selected: null,
  confirm: null,
} as PaneView)
const busyAtom = atom({ plugin: 'skill-manager', key: 'busy' } as const, null as string | null)
const busyRowsAtom = atom({ plugin: 'skill-manager', key: 'busyRows' } as const, [] as string[])
const messageAtom = atom({ plugin: 'skill-manager', key: 'message' } as const, null as string | null)
const cwdAtom = atom({ plugin: 'skill-manager', key: 'cwd' } as const, null as string | null)

async function resolvePaths($: EngineInterface): Promise<Paths | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home ? pathsFrom(home, await $.env.get('CLAUDE_CONFIG_DIR')) : undefined
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

/** Skill folders directly under `root`; dot folders and folders without SKILL.md are skipped. */
async function scanRoot($: EngineInterface, sep: string, root: string, scope: SkillScope, prefix: string) {
  const entries = await $.fs.list(root).catch(() => [])
  const rows: SkillRow[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.kind === 'file') continue
    const dir = `${root}${sep}${entry.name}`
    const text = await $.fs.read(`${dir}${sep}SKILL.md`).catch(() => undefined)
    if (text === undefined) continue
    const front = parseFrontmatter(text)
    const name = `${prefix}${front.name ?? entry.name}`
    rows.push({
      id: `${scope}:${name}`,
      name,
      folder: entry.name,
      scope,
      dir,
      root,
      description: plainText(front.description ?? '', 500),
      isLink: entry.isLink,
    })
  }

  return rows
}

async function withLock($: EngineInterface, rows: SkillRow[], lockPath: string, lock: 'global' | 'project') {
  const entries = lockSkills(await readJson($, lockPath))
  const out: SkillRow[] = []
  for (const row of rows) {
    const source = githubSource(entries[row.folder], lock)
    if (!source) {
      out.push(row)
      continue
    }
    const files = await $.fs.list(row.dir).catch(() => [])
    const mtimes = files.filter(file => file.kind === 'file').map(file => file.mtimeMs)
    out.push({ ...row, source, isModifiedLocally: isModifiedAfter(source.updatedAt, mtimes) })
  }

  return out
}

async function scanSkills($: EngineInterface, paths: Paths, cwd: string | null): Promise<SkillRow[]> {
  const { sep } = paths
  const user = await withLock($, await scanRoot($, sep, paths.userSkills, 'user', ''), paths.globalLock, 'global')
  const project = cwd
    ? await withLock(
        $,
        await scanRoot($, sep, `${cwd}${sep}.claude${sep}skills`, 'project', ''),
        `${cwd}${sep}skills-lock.json`,
        'project',
      )
    : []
  const plugin: SkillRow[] = []
  for (const { plugin: name, marketplace, install } of pluginInstalls(await readJson($, paths.plugins))) {
    for (const row of await scanRoot($, sep, `${install.installPath}${sep}skills`, 'plugin', `${name}:`))
      plugin.push({
        ...row,
        source: {
          kind: 'plugin',
          plugin: name,
          marketplace,
          version: install.version ?? '',
          lastUpdated: install.lastUpdated ?? '',
        },
      })
  }

  return [...user, ...project, ...plugin]
}

async function say($: EngineInterface, text: string | null) {
  await update($, messageAtom, () => (text === null ? null : plainText(text, 400)))
}

async function refresh($: EngineInterface) {
  const paths = await resolvePaths($)
  if (!paths) {
    await say($, 'No USERPROFILE or HOME set: cannot find the skills folders.')
    return
  }
  const rows = await scanSkills($, paths, await read($, cwdAtom))
  await update($, rowsAtom, () => rows)
}

/** Runs one action at a time; a press while another runs is ignored. `rowIds` marks the rows it acts on. */
async function busy($: EngineInterface, label: string, work: () => Promise<unknown>, rowIds: string[] = []) {
  if ((await read($, busyAtom)) !== null) return
  await update($, busyAtom, () => label)
  await update($, busyRowsAtom, () => rowIds)
  try {
    await work()
  } catch (error) {
    await say($, `${label} failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, busyAtom, () => null)
    await update($, busyRowsAtom, () => [])
  }
}

async function recordUse($: EngineInterface, name: string) {
  const stored = ((await $.store.get('usage')) ?? {}) as UsageMap
  const old = usageOf(stored, name)
  const next = { ...stored, [name]: { count: old.count + 1, last: new Date().toISOString() } }
  await $.store.set('usage', next)
  await update($, usageAtom, () => next)
}

async function deleteSkill($: EngineInterface, row: SkillRow) {
  const paths = await resolvePaths($)
  if (!paths || !canDelete(row, paths, await read($, cwdAtom))) {
    await say($, `${row.name} cannot be deleted here.`)
    return
  }
  const script = `${$.plugin.root}${paths.sep}scripts${paths.sep}trash.mjs`
  const ran = await $.process.run(['node', script, row.root, row.folder], { timeoutMs: 60_000 })
  await update($, viewAtom, v => ({ ...v, confirm: null, selected: ran.exitCode === 0 ? null : v.selected }))
  await say($, ran.exitCode === 0 ? `Moved ${row.name} to ${lastLine(ran.stdout)}` : `Delete failed: ${lastLine(ran.stderr)}`)
  await refresh($)
}

/** Runs one update batch under its time limit; a run that is killed or cannot start updates nothing. */
async function runBatch($: EngineInterface, batch: UpdateBatch) {
  try {
    const ran = await $.process.run(batch.argv, { cwd: batch.cwd, env: UPDATE_ENV, timeoutMs: batch.timeoutMs })
    const done = updatedRows(batch.rows, ran.stdout, ran.exitCode)

    return {
      done,
      failed: batch.rows.filter(row => !done.includes(row)),
      reason: ran.exitCode === 0 ? 'not updated' : `exit ${ran.exitCode}`,
      output: lastLine(ran.stdout) || lastLine(ran.stderr),
    }
  } catch (error) {
    return { done: [], failed: batch.rows, reason: plainText(error instanceof Error ? error.message : String(error), 120), output: '' }
  }
}

/** Clears the update marks of the rows that were updated, then scans again. */
async function settle($: EngineInterface, done: SkillRow[]) {
  const updates = { ...(await read($, updatesAtom)) }
  for (const row of done) delete updates[row.id]
  await $.store.set('updates', updates)
  await update($, updatesAtom, () => updates)
  await refresh($)
}

async function updateSkill($: EngineInterface, row: SkillRow) {
  const paths = await resolvePaths($)
  if (!paths) return
  const { batches, skipped } = updateBatches([row], paths, await read($, cwdAtom))
  const batch = batches[0]
  if (!batch) {
    await say($, `${row.name} cannot be updated: ${skipped[0]?.reason ?? 'no recorded source'}`)
    return
  }
  const result = await runBatch($, batch)
  const restart = row.source?.kind === 'plugin' ? ' Restart Claude Code to load it.' : ''
  await say($, result.done.length > 0 ? `Updated ${row.name}.${restart} ${result.output}`.trim() : `Update failed (${result.reason}): ${result.output}`)
  await settle($, result.done)
}

/** Every update the last check found, all at once: batches for different lock files and plugins run in parallel. */
async function updateAll($: EngineInterface) {
  const paths = await resolvePaths($)
  if (!paths) return
  const updates = await read($, updatesAtom)
  const pending = (await read($, rowsAtom)).filter(row => updates[row.id]?.status === 'available')
  const { batches, skipped } = updateBatches(pending, paths, await read($, cwdAtom))
  await update($, busyRowsAtom, () => pending.map(row => row.id))
  await update($, busyAtom, () => `Updating ${pending.length} skill${pending.length === 1 ? '' : 's'}`)
  const results = await Promise.all(batches.map(batch => runBatch($, batch)))
  const failures = new Map<string, string[]>()
  for (const { row, reason } of [
    ...skipped,
    ...results.flatMap(result => result.failed.map(row => ({ row, reason: result.reason }))),
  ])
    failures.set(reason, [...(failures.get(reason) ?? []), row.name])
  const done = results.flatMap(result => result.done)
  const failed = [...failures].map(([reason, names]) => `${names.join(', ')} (${reason})`).join('; ')
  await say($, `Updated ${done.length} of ${pending.length}${failed ? `, failed: ${failed}` : ''}.`)
  await settle($, done)
}

/**
 * A repo folder listing through gh when it is installed and logged in (5000 calls an hour),
 * else through the anonymous GitHub API (60 calls an hour per public IP).
 */
async function listFolder($: EngineInterface, group: { api: string; url: string }) {
  const gh = await $.process.run(['gh', 'api', group.api], { env: { GH_PROMPT_DISABLED: '1' }, timeoutMs: 30_000 }).catch(() => undefined)
  const viaGh = gh?.exitCode === 0 ? folderListing(gh.stdout) : undefined
  if (viaGh) return { listing: viaGh, failure: null }
  const response = await $.http
    .fetch(group.url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-skill-manager' } })
    .catch(() => ({ ok: false, status: 0, text: '' }))
  const listing = response.ok ? folderListing(response.text) : undefined

  return { listing, failure: listing ? null : `HTTP ${response.status}` }
}

async function checkUpdates($: EngineInterface) {
  await refresh($)
  const updates: Record<string, UpdateInfo> = { ...(await read($, updatesAtom)) }
  const checkedAt = new Date().toISOString()
  let available = 0
  const failures: string[] = []
  for (const group of updateChecks(await read($, rowsAtom))) {
    const { listing, failure } = await listFolder($, group)
    if (failure) failures.push(failure)
    for (const one of group.rows) {
      const remote = listing?.find(entry => entry.name === one.leaf)
      if (!remote) {
        updates[one.id] = { status: 'error', checkedAt, detail: failure ?? 'not found upstream' }
        continue
      }
      const isNewer = remote.sha !== one.hash
      if (isNewer) available++
      updates[one.id] = { status: isNewer ? 'available' : 'current', checkedAt }
    }
  }
  await $.store.set('updates', updates)
  await update($, updatesAtom, () => updates)
  const failed = failures.length > 0 ? `, ${failures.length} check(s) failed (${[...new Set(failures)].join(', ')})` : ''
  await say($, `Update check done: ${available} update(s) available${failed}.`)
}

async function importHistory($: EngineInterface) {
  const paths = await resolvePaths($)
  if (!paths) return
  const script = `${$.plugin.root}${paths.sep}scripts${paths.sep}usage-scan.mjs`
  const ran = await $.process.run(['node', script, paths.projectsDir], { timeoutMs: 600_000 })
  if (ran.exitCode !== 0) {
    await say($, `History import failed: ${lastLine(ran.stderr)}`)
    return
  }
  const scan = JSON.parse(ran.stdout) as { files?: number }
  const known = new Set((await read($, rowsAtom)).map(row => row.name))
  const imported = importedUsage(scan, known)
  const merged = mergeUsage(((await $.store.get('usage')) ?? {}) as UsageMap, imported)
  await $.store.set('usage', merged)
  await $.store.set('historyImportedAt', new Date().toISOString())
  await update($, usageAtom, () => merged)
  const runs = Object.values(imported).reduce((sum, use) => sum + use.count, 0)
  await say($, `Imported ${runs} skill runs from ${scan.files ?? 0} transcripts.`)
}

const sourceText = (row: SkillRow) => {
  const source = row.source
  if (source?.kind === 'github') return `GitHub ${source.repo} (${source.skillPath}), updated ${source.updatedAt.slice(0, 10)}`
  if (source?.kind === 'plugin')
    return `plugin ${source.plugin}@${source.marketplace} ${source.version}, updated ${source.lastUpdated.slice(0, 10)}`

  return 'local: no recorded source'
}

const updateText = (info: UpdateInfo | undefined) =>
  !info ? '' : info.status === 'available' ? 'update available' : info.status === 'error' ? `check failed` : 'up to date'

const USES_WIDTH = 7
const LAST_WIDTH = 7
const UPDATE_WIDTH = 10
const SCOPES: ScopeFilter[] = ['all', 'user', 'project', 'plugin']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, cwdAtom, () => e.cwd)
    const stored = ((await $.store.get('usage')) ?? {}) as UsageMap
    const updates = ((await $.store.get('updates')) ?? {}) as Record<string, UpdateInfo>
    await update($, usageAtom, () => stored)
    await update($, updatesAtom, () => updates)
    await $.command.register({ name: 'skill-manager', description: 'Show installed skills in a side pane' })
    void refresh($)

    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    await recordUse($, e.skill)

    return result
  })

  on('command.run', { command: 'skill-manager' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Skills' })

    return { text: 'Skill manager opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Select = 'Select' in elements ? elements.Select : undefined
    const Input = 'Input' in elements ? elements.Input : undefined
    const rows = await read($, rowsAtom)
    const usage = await read($, usageAtom)
    const updates = await read($, updatesAtom)
    const view = await read($, viewAtom)
    const working = await read($, busyAtom)
    const busyRows = await read($, busyRowsAtom)
    const message = await read($, messageAtom)
    const now = Date.now()
    const setView = (patch: Partial<PaneView>) => update($, viewAtom, v => ({ ...v, ...patch }))
    const selected = rows.find(row => row.id === view.selected)

    const status = (
      <Box flexDirection="column">
        {working !== null && <Text>{`${working}...`}</Text>}
        {message !== null && (
          <Box key="message">
            <Text dimColor>{message}</Text>
          </Box>
        )}
      </Box>
    )

    if (selected) {
      const use = usageOf(usage, selected.name)
      const info = updates[selected.id]
      const paths = await resolvePaths($)
      const deletable = paths !== undefined && canDelete(selected, paths, await read($, cwdAtom))
      const isConfirming = view.confirm === selected.id

      return (
        <Box flexDirection="column" gap={1}>
          <Button key="back" label="< All skills" plain onPress={() => setView({ selected: null, confirm: null })} />
          <Text bold>
            {selected.name}
          </Text>
          {selected.description !== '' && <Text>{selected.description}</Text>}
          <Box flexDirection="column">
            <Text>{`Scope: ${selected.scope}${selected.isLink ? ' (link)' : ''}`}</Text>
            <Box key="detail-path"><Text>{`Path: ${selected.dir}`}</Text></Box>
            <Box key="detail-source"><Text>{`Source: ${sourceText(selected)}`}</Text></Box>
            <Text>{`Used: ${use.count}x, last ${use.last ? `${use.last.slice(0, 16).replace('T', ' ')} (${ago(use.last, now)})` : 'never'}`}</Text>
            {info && <Text>{`Update: ${updateText(info)}${info.detail ? ` (${info.detail})` : ''}`}</Text>}
            {selected.isModifiedLocally && (
              <Text color="yellow">
                Files changed after install: an update overwrites them.
              </Text>
            )}
          </Box>
          {status}
          <Box flexDirection="row" gap={2}>
            {selected.source && busyRows.includes(selected.id) && (
              <Box key="updating">
                <Text dimColor>Updating…</Text>
              </Box>
            )}
            {selected.source && !busyRows.includes(selected.id) && (
              <Button
                key="update"
                label={selected.source.kind === 'plugin' ? 'Update plugin' : 'Update from GitHub'}
                variant="primary"
                dimColor={working !== null}
                onPress={() => busy($, `Updating ${selected.name}`, () => updateSkill($, selected), [selected.id])}
              />
            )}
            {deletable && !isConfirming && (
              <Button key="delete" label="Delete" onPress={() => setView({ confirm: selected.id })} />
            )}
          </Box>
          {deletable && isConfirming && (
            <Box flexDirection="column">
              <Text color="red">{`Move ${selected.folder} to ${selected.root}${paths?.sep ?? '/'}.trash?`}</Text>
              <Box flexDirection="row" gap={2}>
                <Button
                  key="confirm-delete"
                  label="Move to trash"
                  onPress={() => busy($, `Deleting ${selected.name}`, () => deleteSkill($, selected))}
                />
                <Button key="cancel-delete" label="Cancel" onPress={() => setView({ confirm: null })} />
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    const shown = visibleRows(rows, usage, view, updates)
    const lines = listLines(shown)
    const { start, end } = listWindow(lines.length, e.props.scroll.offset, e.props.scroll.bodyRows)
    const pending = rows.filter(row => updates[row.id]?.status === 'available').length
    const nameRoom = Math.max(8, e.props.bodyColumns - USES_WIDTH - LAST_WIDTH - UPDATE_WIDTH - 3)
    const arrow = (key: SortKey) => (view.sort === key ? (sortDir(view) === 'asc' ? ' ▲' : ' ▼') : '')
    const header = (key: SortKey, title: string) => (
      <Button key={`sort:${key}`} label={`${title}${arrow(key)}`} plain onPress={() => update($, viewAtom, v => clickSort(v, key))} />
    )
    const cell = (width: number, child: RenderChildren) => (
      <Box width={width} flexShrink={0} justifyContent="flex-end">
        {child}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{`${rows.length} skills${pending > 0 ? `, ${pending} update${pending === 1 ? '' : 's'} available` : ''}`}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="refresh" label="Refresh" onPress={() => busy($, 'Scanning', () => refresh($))} />
          <Button key="check-updates" label="Check updates" onPress={() => busy($, 'Checking GitHub', () => checkUpdates($))} />
          {pending > 0 && (
            <Button key="update-all" label="Update all" dimColor={working !== null} onPress={() => busy($, 'Updating all', () => updateAll($))} />
          )}
          <Button key="import-history" label="Import history" onPress={() => busy($, 'Reading transcripts', () => importHistory($))} />
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {Select && (
            <Select
              key="scope"
              label="Scope"
              value={view.scope}
              options={SCOPES.map(value => ({ value, label: value }))}
              onSelect={value => setView({ scope: value as ScopeFilter })}
            />
          )}
          {Input && (
            <Input key="filter" placeholder="Filter" value={view.text} onInput={value => setView({ text: value })} onSubmit={value => setView({ text: value })} />
          )}
        </Box>
        {status}
        <Box key="list" flexDirection="column" gap={0.25}>
          <Box key="columns" flexDirection="row" gap={1}>
            <Box flexGrow={1}>{header('name', 'Name')}</Box>
            {cell(USES_WIDTH, header('uses', 'Uses'))}
            {cell(LAST_WIDTH, header('last', 'Last'))}
            {cell(UPDATE_WIDTH, header('updates', 'Update'))}
          </Box>
          {shown.length === 0 && <Text dimColor>No skills match.</Text>}
          {start > 0 && <Box key="spacer-above" height={start} flexShrink={0} />}
          {lines.slice(start, end).map(line => {
                if (line.kind === 'section')
                  return (
                    <Box key={`section:${line.key}`}>
                      <Text bold>{`${line.title} (${line.count})`}</Text>
                    </Box>
                  )
                const row = line.row
                const use = usageOf(usage, row.name)

                return (
                  <Box key={`row:${row.id}`} flexDirection="row" gap={1}>
                    <Box flexGrow={1}>
                      <Button
                        key={`open:${row.id}`}
                        label={fit(shortName(row), nameRoom)}
                        plain
                        onPress={() => setView({ selected: row.id, confirm: null })}
                      />
                    </Box>
                    {cell(USES_WIDTH, <Text dimColor>{use.count === 0 ? '–' : String(use.count)}</Text>)}
                    {cell(LAST_WIDTH, <Text dimColor>{lastShort(use, now)}</Text>)}
                    {cell(
                      UPDATE_WIDTH,
                      busyRows.includes(row.id) ? (
                        <Box key={`updating:${row.id}`}>
                          <Text dimColor>Updating…</Text>
                        </Box>
                      ) : updates[row.id]?.status === 'available' ? (
                        <Button
                          key={`update:${row.id}`}
                          label="Update"
                          variant="primary"
                          dimColor={working !== null}
                          onPress={() => busy($, `Updating ${row.name}`, () => updateSkill($, row), [row.id])}
                        />
                      ) : null,
                    )}
                  </Box>
                )
              })}
          {end < lines.length && <Box key="spacer-below" height={lines.length - end} flexShrink={0} />}
        </Box>
      </Box>
    )
  })
}
