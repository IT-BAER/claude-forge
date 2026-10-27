import type { GithubSource, PaneView, SkillRow, SkillUsage, SortKey, UpdateInfo, UsageMap } from '../types'

export type Paths = {
  sep: string
  home: string
  userSkills: string
  globalLock: string
  plugins: string
  projectsDir: string
}

export const pathsFrom = (home: string, configDirEnv: string | undefined): Paths => {
  const sep = home.includes('\\') ? '\\' : '/'
  const configDir = configDirEnv ?? `${home}${sep}.claude`

  return {
    sep,
    home,
    userSkills: `${configDir}${sep}skills`,
    globalLock: `${home}${sep}.agents${sep}.skill-lock.json`,
    plugins: `${configDir}${sep}plugins${sep}installed_plugins.json`,
    projectsDir: `${configDir}${sep}projects`,
  }
}

export type LockEntry = {
  source?: string
  sourceType?: string
  sourceUrl?: string
  skillPath?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
}

export const lockSkills = (json: unknown): Record<string, LockEntry> =>
  (json as { skills?: Record<string, LockEntry> } | undefined)?.skills ?? {}

export const githubSource = (entry: LockEntry | undefined, lock: GithubSource['lock']): GithubSource | undefined => {
  if (entry?.sourceType !== 'github' || !entry.source || !entry.skillPath) return undefined

  return {
    kind: 'github',
    repo: entry.source,
    url: entry.sourceUrl ?? `https://github.com/${entry.source}`,
    skillPath: entry.skillPath,
    hash: entry.skillFolderHash ?? '',
    installedAt: entry.installedAt ?? '',
    updatedAt: entry.updatedAt ?? entry.installedAt ?? '',
    lock,
  }
}

export type PluginInstall = { installPath?: string; version?: string; lastUpdated?: string }

/** installed_plugins.json: `name@marketplace` -> install or list of installs. */
export const pluginInstalls = (json: unknown) => {
  const plugins = (json as { plugins?: Record<string, PluginInstall | PluginInstall[]> } | undefined)?.plugins ?? {}
  const seen = new Set<string>()
  const out: Array<{ plugin: string; marketplace: string; install: Required<Pick<PluginInstall, 'installPath'>> & PluginInstall }> = []
  for (const [key, value] of Object.entries(plugins)) {
    const [plugin = key, marketplace = ''] = key.split('@')
    for (const install of Array.isArray(value) ? value : [value]) {
      if (!install.installPath || seen.has(install.installPath)) continue
      seen.add(install.installPath)
      out.push({ plugin, marketplace, install: { ...install, installPath: install.installPath } })
    }
  }

  return out
}

/** A top-level file changed more than 2 minutes after the lock's updatedAt. */
export const isModifiedAfter = (updatedAt: string, mtimes: number[]) => {
  const since = Date.parse(updatedAt)

  return !Number.isNaN(since) && mtimes.some(mtime => mtime > since + 120_000)
}

/** Reads `name` and `description` from a SKILL.md frontmatter block. */
export const parseFrontmatter = (text: string): { name?: string; description?: string } => {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match?.[1]) return {}
  const lines = match[1].split(/\r?\n/)
  const out: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[i] ?? '')
    if (!field?.[1]) continue
    let value = (field[2] ?? '').trim()
    if (value === '' || value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? '')) block.push((lines[++i] ?? '').trim())
      value = block.join(' ')
    }
    out[field[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2')
  }

  return out
}

/**
 * Text a surface accepts: a tree with an escape sequence or control character is
 * refused whole ("Nothing to show yet"), and CLI output carries ANSI colors.
 */
export const plainText = (text: string, max = 300) =>
  text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-_]?/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** The last non-empty line of CLI output, without escape codes or a leading glyph like `└`. */
export const lastLine = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map(line => plainText(line).replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
    .pop() ?? ''

export const isSafeName =(name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)

/** owner/repo plus the folder that holds the skill folder, from a lock entry. */
export const githubLocation = (repo: string, skillPath: string) => {
  const parts = skillPath.split('/').slice(0, -1)
  const leaf = parts.pop() ?? ''

  return { repo, parent: parts.join('/'), leaf }
}

/** Set on every update run: a vanished or private repo fails at once instead of waiting for a git login. */
export const UPDATE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  SKILLS_CLONE_TIMEOUT_MS: '60000',
}

/** Run limit: 30 s to start npx or claude plus one 60 s clone per source repo; the engine allows 10 minutes at most. */
export const updateTimeout = (repos: number) => Math.min(600_000, 30_000 + 60_000 * Math.max(1, repos))

export type UpdateBatch = { argv: string[]; cwd?: string; timeoutMs: number; rows: SkillRow[] }

/**
 * The runs that update `rows`: one skills CLI run per lock file holding all its skills
 * (the CLI clones each repo once and writes its lock itself), one `claude plugin update`
 * per plugin. Rows that cannot update come back with a reason.
 */
export const updateBatches = (rows: SkillRow[], paths: Paths, cwd: string | null) => {
  const batches = new Map<string, UpdateBatch>()
  const skipped: Array<{ row: SkillRow; reason: string }> = []
  const add = (key: string, row: SkillRow, start: () => UpdateBatch) => {
    const batch = batches.get(key) ?? start()
    batch.rows.push(row)
    batches.set(key, batch)
  }
  for (const row of rows) {
    const source = row.source
    if (source?.kind === 'plugin') {
      const id = source.marketplace ? `${source.plugin}@${source.marketplace}` : source.plugin
      if (!isSafeName(source.plugin) || (source.marketplace && !isSafeName(source.marketplace)))
        skipped.push({ row, reason: `unexpected plugin id ${id}` })
      else add(`plugin:${id}`, row, () => ({ argv: ['claude', 'plugin', 'update', id], timeoutMs: updateTimeout(1), rows: [] }))
    } else if (source?.kind !== 'github') skipped.push({ row, reason: 'no recorded source' })
    else if (!isSafeName(row.folder)) skipped.push({ row, reason: `unexpected folder name ${row.folder}` })
    else add(`lock:${source.lock}`, row, () => ({ argv: [], cwd: source.lock === 'global' ? paths.home : (cwd ?? paths.home), timeoutMs: 0, rows: [] }))
  }
  for (const [key, batch] of batches) {
    if (!key.startsWith('lock:')) continue
    const npx = ['npx', '-y', 'skills', 'update', ...batch.rows.map(row => row.folder), key === 'lock:global' ? '-g' : '-p', '-y']
    // npx is a .cmd shim on Windows: it starts only through cmd.
    batch.argv = paths.sep === '\\' ? ['cmd', '/d', '/c', ...npx] : npx
    batch.timeoutMs = updateTimeout(new Set(batch.rows.map(row => (row.source?.kind === 'github' ? row.source.repo : ''))).size)
  }

  return { batches: [...batches.values()], skipped }
}

/**
 * The rows a finished run updated. The skills CLI prints `✓ Updated <folder>` per skill in
 * newer versions only, so with exit 0 and no such line every row counts as updated.
 */
export const updatedRows = (rows: SkillRow[], stdout: string, exitCode: number) => {
  const names = new Set(
    stdout
      .split(/\r\n|\r|\n/)
      .map(line => /^✓\s*Updated (\S+)$/.exec(plainText(line))?.[1])
      .filter((name): name is string => !!name),
  )
  if (exitCode === 0 && names.size === 0) return rows

  return rows.filter(row => names.has(row.folder))
}

/** Only user and project skill folders directly under a known skills root may be trashed. */
export const canDelete = (row: SkillRow, paths: Paths, cwd: string | null) => {
  const roots = [paths.userSkills, ...(cwd ? [`${cwd}${paths.sep}.claude${paths.sep}skills`] : [])]

  return row.scope !== 'plugin' && isSafeName(row.folder) && roots.includes(row.root)
}

/** One GitHub contents call per repo folder that holds skill folders. */
export const updateChecks = (rows: SkillRow[]) => {
  const groups = new Map<string, { api: string; url: string; rows: Array<{ id: string; leaf: string; hash: string }> }>()
  for (const row of rows) {
    if (row.source?.kind !== 'github') continue
    const { repo, parent, leaf } = githubLocation(row.source.repo, row.source.skillPath)
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue
    const path = parent.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    const api = `repos/${repo}/contents${path ? `/${path}` : ''}`
    const url = `https://api.github.com/${api}`
    const group = groups.get(url) ?? { api, url, rows: [] }
    group.rows.push({ id: row.id, leaf, hash: row.source.hash })
    groups.set(url, group)
  }

  return [...groups.values()]
}

/** The entries of a GitHub contents reply, or undefined when it is not a folder listing. */
export const folderListing = (text: string): Array<{ name: string; sha: string }> | undefined => {
  try {
    const json: unknown = JSON.parse(text)

    return Array.isArray(json) ? json : undefined
  } catch {
    return undefined
  }
}

type Counted = Record<string, { count?: number; last?: string | null }>

/**
 * Usage from the transcript scan: every Skill tool call, plus typed slash
 * commands whose name is a known skill.
 */
export const importedUsage = (json: unknown, known: Set<string>): UsageMap => {
  const scan = (json ?? {}) as { skills?: Counted; commands?: Counted }
  const out: UsageMap = {}
  const add = (name: string, use: { count?: number; last?: string | null }) => {
    const old = out[name]
    const last = [old?.last, use.last].filter((x): x is string => !!x).sort().pop() ?? null
    out[name] = { count: (old?.count ?? 0) + (use.count ?? 0), last }
  }
  for (const [name, use] of Object.entries(scan.skills ?? {})) add(name, use)
  for (const [name, use] of Object.entries(scan.commands ?? {})) if (known.has(name)) add(name, use)

  return out
}

export const usageOf =(usage: UsageMap, name: string): SkillUsage => usage[name] ?? { count: 0, last: null }

/** Max-merges two usage maps: a re-import never loses counts from deleted transcripts. */
export const mergeUsage = (a: UsageMap, b: UsageMap): UsageMap => {
  const out: UsageMap = { ...a }
  for (const [name, use] of Object.entries(b)) {
    const old = out[name]
    const last = [old?.last, use.last].filter((x): x is string => !!x).sort().pop() ?? null
    out[name] = { count: Math.max(old?.count ?? 0, use.count), last }
  }

  return out
}

export const ago = (iso: string | null, now: number) => {
  if (!iso) return 'never'
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

/** Name shown in a list row: a plugin skill drops its `plugin:` prefix, its section names the plugin. */
export const shortName = (row: SkillRow) => (row.scope === 'plugin' ? row.name.slice(row.name.indexOf(':') + 1) : row.name)

export const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

export const lastShort = (use: SkillUsage, now: number) => (use.last ? ago(use.last, now).replace(' ago', '') : '–')

/** Sections in list order: user, project, then one per plugin; empty ones are left out. */
export const sections = (rows: SkillRow[]) => {
  const out = new Map<string, { key: string; title: string; rows: SkillRow[] }>()
  const put = (key: string, title: string, row: SkillRow) => {
    const section = out.get(key) ?? { key, title, rows: [] }
    section.rows.push(row)
    out.set(key, section)
  }
  for (const scope of ['user', 'project'] as const)
    for (const row of rows) if (row.scope === scope) put(scope, scope === 'user' ? 'User' : 'Project', row)
  const plugins = rows.filter(row => row.scope === 'plugin')
  for (const name of [...new Set(plugins.map(row => (row.source?.kind === 'plugin' ? row.source.plugin : '')))].sort())
    for (const row of plugins)
      if (row.source?.kind === 'plugin' && row.source.plugin === name) put(`plugin:${name}`, `Plugin ${name}`, row)

  return [...out.values()]
}

export type ListLine =
  | { kind: 'section'; key: string; title: string; count: number }
  | { kind: 'row'; row: SkillRow }

/** The list as lines of one row each: a section's title, then its rows. */
export const listLines = (rows: SkillRow[]): ListLine[] =>
  sections(rows).flatMap(section => [
    { kind: 'section' as const, key: section.key, title: section.title, count: section.rows.length },
    ...section.rows.map(row => ({ kind: 'row' as const, row })),
  ])

// A drawn row serializes to about 700 characters: 110 lines stay well under the 100,000 tree bound.
// A pane taller than that shows blank rows below the drawn lines.
const MAX_DRAWN_LINES = 110
// Lines drawn past each window edge; also covers the controls above the list.
const SLACK = 20

/** Lines [start, end) to draw for a pane window at tree row `offset`; the rest become spacers. */
export const listWindow = (total: number, offset: number, bodyRows: number) => {
  const want = Math.min(MAX_DRAWN_LINES, bodyRows + 2 * SLACK)
  const start = Math.max(0, Math.min(offset - SLACK, total - want))

  return { start, end: Math.min(total, start + want) }
}

/** The direction each sort key's comparator produces: names A-Z, numbers and dates high first. */
export const NATURAL_DIR: Record<SortKey, 'asc' | 'desc'> = { name: 'asc', uses: 'desc', last: 'desc', updates: 'desc' }

export const sortDir = (view: PaneView) => view.dir ?? NATURAL_DIR[view.sort]

/** A header click: a new column starts in its natural direction, the active one flips. */
export const clickSort = (view: PaneView, key: SortKey): PaneView =>
  view.sort === key
    ? { ...view, dir: sortDir(view) === 'asc' ? 'desc' : 'asc' }
    : { ...view, sort: key, dir: NATURAL_DIR[key] }

export const visibleRows = (
  rows: SkillRow[],
  usage: UsageMap,
  view: PaneView,
  updates: Record<string, UpdateInfo> = {},
) => {
  const text = view.text.trim().toLowerCase()
  const shown = rows.filter(
    row =>
      (view.scope === 'all' || row.scope === view.scope) &&
      (text === '' || row.name.toLowerCase().includes(text) || row.description.toLowerCase().includes(text)),
  )
  const byName = (a: SkillRow, b: SkillRow) => a.name.localeCompare(b.name)
  const byUses = (a: SkillRow, b: SkillRow) => usageOf(usage, b.name).count - usageOf(usage, a.name).count || byName(a, b)
  const hasUpdate = (row: SkillRow) => (updates[row.id]?.status === 'available' ? 1 : 0)
  const sorters = {
    name: byName,
    uses: byUses,
    updates: (a: SkillRow, b: SkillRow) => hasUpdate(b) - hasUpdate(a) || byUses(a, b),
    last: (a: SkillRow, b: SkillRow) =>
      (usageOf(usage, b.name).last ?? '').localeCompare(usageOf(usage, a.name).last ?? '') || byName(a, b),
  }

  const sorted = shown.sort(sorters[view.sort])

  return sortDir(view) === NATURAL_DIR[view.sort] ? sorted : sorted.reverse()
}
