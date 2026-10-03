import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Entry, Preview, Tree } from '../types'

const PANE = 'file-explorer'
const MAX_ROWS = 800
const clickAcks = new Map<string, { instance: string; seq: number }>()
let lastFileClick: { path: string; root: string } | undefined
const EMPTY: Tree = {
  root: '',
  dirs: {},
  open: [],
  filter: '',
  picked: '',
  git: {},
  reveal: { dir: '', n: 0 },
  pin: '',
  tick: 0,
}
const tree = atom({ plugin: 'file-explorer', key: 'tree' } as const, EMPTY)
const current = async ($: any): Promise<Tree> => ({ ...EMPTY, ...(await read($, tree)) })

const GIT_COLOR: Record<string, string> = {
  M: '#d29922',
  U: '#3fb950',
  A: '#3fb950',
  R: '#3fb950',
  D: '#f85149',
}
const GIT_RANK = ['D', 'M', 'R', 'A', 'U']

// Tunable at runtime from theme.json beside the plugin manifest; see loadTheme.
const T = {
  rowH: 23,
  bgHover: '#161b22',
  bgPicked: '#09182e',
  guide: '#30363d',
  chevron: '#8b949e',
  folder: '#dcb67a',
  chevCells: 2,
  iconCells: 3,
  guideCells: 2,
  padX: 1,
  searchCells: 20,
  bg: '#111111',
  searchMode: 'row',
  searchTop: -2,
  searchRight: 6,
  overlay: true,
  auto: true,
  hitCells: 160,
  nameNormal: '#c9d1d9',
  nameIgnored: '#6e7681',
  dimOpacity: 0.5,
  animMs: 30,
  animStep: 1,
  // Rows at the reveal front drawn dim: a short fade-in trail.
  fadeRows: 3,
  wideCells: 48,
  chevStroke: 1.1,
  pin: '',
}
let themeText = ''
let themeFailed = false
let themeStatus = 'theme: not loaded yet'
async function loadTheme($: any): Promise<boolean> {
  try {
    const text: string = await $.fs.read(`${$.plugin.root}/theme.json`)
    themeStatus = `theme ok (${$.plugin.root})`
    if (text === themeText) return false
    themeText = text
    const file = JSON.parse(text)
    const { git, ...rest } = file
    Object.assign(T, rest)
    if (git) Object.assign(GIT_COLOR, git)
    return true
  } catch (err) {
    themeStatus = `theme error: ${String((err as Error)?.message ?? err)} root=${$.plugin.root}`
    themeFailed = true
    return false
  }
}

const svg = (body: string, dim = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 ${T.rowH}" width="16" height="${T.rowH}"><g transform="translate(0 ${(T.rowH - 16) / 2})"${dim ? ` opacity="${T.dimOpacity}"` : ''}>${body}</g></svg>`
const guideSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 ${T.rowH}" width="16" height="${T.rowH}"><path d="M8 0V${T.rowH}" stroke="${T.guide}" stroke-width="1"/></svg>`
const chevronSvg = (open: boolean) =>
  svg(
    `<path d="${open ? 'M3.5 6l4.5 4.5L12.5 6' : 'M6 3.5L10.5 8L6 12.5'}" fill="none" stroke="${T.chevron}" stroke-width="${T.chevStroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
  )
const folderSvg = (open: boolean, dim = false) =>
  svg(
    open
      ? `<path d="M1.5 4a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V6H4.2a1 1 0 0 0-.95.7L1.5 12z" fill="#b8975f"/><path d="M3.3 6.8a.8.8 0 0 1 .75-.55H14.6a.7.7 0 0 1 .67.9l-1.5 5.2a1 1 0 0 1-.96.7H2.6a.6.6 0 0 1-.57-.8z" fill="${T.folder}"/>`
      : `<path d="M1.5 4a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="${T.folder}"/>`,
    dim,
  )
const fileSvg = (color: string, dim = false) =>
  svg(
    `<path d="M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5z" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.7V5h3.3" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/><rect x="5.6" y="8.6" width="4.8" height="1.6" rx=".8" fill="${color}"/><rect x="5.6" y="11.2" width="3" height="1.2" rx=".6" fill="${color}" opacity=".55"/>`,
    dim,
  )

type Icon = { glyph: string; color: string }
const BY_EXT: Record<string, Icon> = {
  ts: { glyph: 'TS', color: '#519aba' },
  tsx: { glyph: 'TS', color: '#519aba' },
  js: { glyph: 'JS', color: '#cbcb41' },
  jsx: { glyph: 'JS', color: '#cbcb41' },
  mjs: { glyph: 'JS', color: '#cbcb41' },
  cjs: { glyph: 'JS', color: '#cbcb41' },
  json: { glyph: '{}', color: '#cbcb41' },
  jsonl: { glyph: '{}', color: '#cbcb41' },
  md: { glyph: 'M↓', color: '#519aba' },
  py: { glyph: 'Py', color: '#ffbc03' },
  ps1: { glyph: '>_', color: '#519aba' },
  sh: { glyph: '$', color: '#89e051' },
  bash: { glyph: '$', color: '#89e051' },
  yml: { glyph: 'Y', color: '#a074c4' },
  yaml: { glyph: 'Y', color: '#a074c4' },
  toml: { glyph: 'T', color: '#a074c4' },
  html: { glyph: '<>', color: '#e37933' },
  css: { glyph: '#', color: '#519aba' },
  png: { glyph: '▣', color: '#a074c4' },
  jpg: { glyph: '▣', color: '#a074c4' },
  jpeg: { glyph: '▣', color: '#a074c4' },
  gif: { glyph: '▣', color: '#a074c4' },
  svg: { glyph: '▣', color: '#e37933' },
  lock: { glyph: '≡', color: '#8a8a8a' },
  log: { glyph: '≡', color: '#8a8a8a' },
  txt: { glyph: '≡', color: '#d4d7d6' },
  sql: { glyph: 'DB', color: '#dad8d8' },
  csv: { glyph: '▦', color: '#89e051' },
  xml: { glyph: '<>', color: '#e37933' },
  ini: { glyph: '⚙', color: '#8a8a8a' },
  cfg: { glyph: '⚙', color: '#8a8a8a' },
  env: { glyph: '⚙', color: '#cbcb41' },
  zip: { glyph: '▤', color: '#cbcb41' },
}
const BY_NAME: Record<string, Icon> = {
  '.gitignore': { glyph: '◆', color: '#f54d27' },
  '.gitattributes': { glyph: '◆', color: '#f54d27' },
  'package.json': { glyph: '{}', color: '#89e051' },
  'claude.md': { glyph: 'M↓', color: '#e37933' },
  license: { glyph: '§', color: '#cbcb41' },
}
const FILE_DEFAULT: Icon = { glyph: '≡', color: '#8a8a8a' }

const iconOf = (name: string, kind: Entry['kind']): Icon => {
  if (kind === 'dir') return { glyph: '■', color: T.folder }
  const lower = name.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  const dot = lower.lastIndexOf('.')
  return (dot >= 0 && BY_EXT[lower.slice(dot + 1)]) || FILE_DEFAULT
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const join = (dir: string, name: string) => (/[\\/]$/.test(dir) ? dir + name : `${dir}/${name}`)
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

let previewRequest = 0
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp'])
const BINARY_EXT = new Set(['webp', 'avif', 'ico', 'pdf', 'zip', 'gz', '7z', 'exe', 'dll', 'wasm', 'glb', 'psd', 'mp4', 'mp3', 'woff', 'woff2'])

async function previewFile($: any, path: string, root: string) {
  const request = ++previewRequest
  const preview: Preview = { path, request, kind: 'loading', content: '', markdown: /\.(md|markdown)$/i.test(path), rendered: true, notice: '' }
  await update($, tree, (cur: Tree) => ({ ...cur, picked: path, preview }))
  try {
    const [folder, file] = await Promise.all([$.fs.stat(root, { resolve: true }), $.fs.stat(path, { resolve: true })])
    if (!folder.realPath || !file.realPath || !norm(file.realPath).startsWith(norm(folder.realPath) + '/')) throw new Error('File is outside the explorer root.')
    if (file.kind !== 'file') throw new Error('This entry is not a regular file.')
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (IMAGE_EXT.has(ext)) {
      if (file.size > 20 * 1024 * 1024) {
        preview.kind = 'unsupported'
        preview.content = 'Image exceeds the preview size limit (20 MiB).'
      } else {
        const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/hooks/preview-image.ps1`, '-ImagePath', file.realPath], { timeoutMs: 10000 })
        if (result.exitCode !== 0) throw new Error('Image could not be decoded for preview.')
        const svg = result.stdout.trim()
        if (!svg.startsWith('<svg ') || svg.length > 131072) throw new Error('Image preview exceeds the renderer limit.')
        preview.kind = 'image'
        preview.content = svg
        preview.notice = 'Image preview · scaled to fit'
      }
    } else if (BINARY_EXT.has(ext) || file.size > 2 * 1024 * 1024) {
      preview.kind = 'unsupported'
      preview.content = BINARY_EXT.has(ext) ? 'Preview is not available for this file type.' : 'File exceeds the text preview size limit (2 MiB).'
    } else {
      const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/hooks/read-preview.ps1`, '-FilePath', file.realPath], { timeoutMs: 10000 })
      if (result.exitCode !== 0) throw new Error('File could not be read for preview.')
      const data = JSON.parse(result.stdout)
      if (!['text', 'unsupported'].includes(data.kind) || typeof data.content !== 'string' || data.content.length > 9500) throw new Error('Invalid text preview response.')
      preview.kind = data.kind
      preview.content = data.content
      preview.notice = data.kind === 'text' ? (data.truncated ? 'Preview truncated · showing the beginning of the file' : 'Read-only preview') : ''
    }
  } catch (err) {
    preview.kind = 'error'
    preview.content = `Cannot preview file: ${String((err as Error)?.message ?? err)}`.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 1000)
  }
  await update($, tree, (cur: Tree) => cur.preview?.request === request && cur.root === root ? { ...cur, preview } : cur)
}

const sorted = (entries: Entry[]) =>
  [...entries].sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : a.kind === 'dir'
        ? -1
        : 1,
  )

type Row = { path: string; name: string; depth: number; kind: Entry['kind']; isOpen: boolean; fresh: boolean }

const flatten = (t: Tree): Row[] => {
  const rows: Row[] = []
  const needle = t.filter.trim().toLowerCase()
  const walk = (dir: string, depth: number) => {
    const kids = t.dirs[dir] ?? []
    const limit = !needle && t.reveal.dir === dir ? t.reveal.n : kids.length
    const fadeFrom = t.reveal.dir === dir ? limit - T.fadeRows : Infinity
    kids.slice(0, limit).forEach((e, i) => {
      const path = join(dir, e.name)
      const isOpen = e.kind === 'dir' && t.open.includes(path)
      if (!needle || e.name.toLowerCase().includes(needle)) {
        rows.push({ path, name: e.name, depth: needle ? 0 : depth, kind: e.kind, isOpen, fresh: i >= fadeFrom })
      }
      if (isOpen) walk(path, depth + 1)
    })
  }
  walk(t.root, 0)
  return rows
}

// VS Code's default files.exclude.
const HIDDEN = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db'])

async function load($: any, dir: string) {
  const entries = await $.fs.list(dir)
  const slim = sorted(
    entries.filter((e: Entry) => !HIDDEN.has(e.name)).map((e: Entry) => ({ name: e.name, kind: e.kind })),
  )
  await update($, tree, (t: Tree) => ({ ...t, dirs: { ...t.dirs, [dir]: slim } }))
}

// Maps normalized absolute path to a status letter; folders carry their strongest child status.
async function dbg($: any, msg: string) {
  try {
    await $.fs.write(`${$.plugin.root}/debug.log`, msg)
  } catch {
    // debug only
  }
}

async function gitStatus($: any, root: string): Promise<Record<string, string>> {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root })
    if (top.exitCode !== 0) {
      await dbg($, `rev-parse exit ${top.exitCode} cwd=${root} stderr=${top.stderr}`)
      return {}
    }
    const base = norm(top.stdout.trim())
    const st = await $.process.run(['git', 'status', '--porcelain=v1', '-z', '--ignored'], { cwd: root })
    if (st.exitCode !== 0) {
      await dbg($, `status exit ${st.exitCode} stderr=${st.stderr}`)
      return {}
    }
    const out: Record<string, string> = {}
    const put = (key: string, letter: string) => {
      if (letter === 'I') {
        out[key] = 'I'
        return
      }
      const have = out[key]
      if (!have || GIT_RANK.indexOf(letter) < GIT_RANK.indexOf(have)) out[key] = letter
    }
    const parts: string[] = st.stdout.split('\0')
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i]
      if (line.length < 4) continue
      const xy = line.slice(0, 2)
      const file = line.slice(3)
      if (xy[0] === 'R' || xy[0] === 'C') i++
      const letter =
        xy === '!!'
          ? 'I'
          : xy === '??'
            ? 'U'
            : xy.includes('D')
              ? 'D'
              : xy.includes('R')
                ? 'R'
                : xy.includes('A')
                  ? 'A'
                  : 'M'
      let key = `${base}/${file}`.toLowerCase().replace(/\/+$/, '')
      put(key, letter)
      if (letter === 'I') continue
      while (key.length > base.length) {
        key = key.slice(0, key.lastIndexOf('/'))
        if (key.length > base.length) put(key, letter)
      }
    }
    await dbg($, `git ok base=${base} entries=${Object.keys(out).length} sample=${Object.entries(out).slice(0, 5).join(';')}`)
    return out
  } catch (err) {
    await dbg($, `git threw: ${String((err as Error)?.message ?? err)}`)
    return {}
  }
}

// Refreshes run one after another; at most one more waits behind the running one.
let tail: Promise<void> = Promise.resolve()
let pending = 0

let lastRoot = ''

async function refreshNow($: any) {
  await loadTheme($)
  const t: Tree = await current($)
  const root: string = t.pin || T.pin || (await $.session.cwd())
  lastRoot = root
  const dirs = Array.from(new Set([root, ...t.open]))
  for (const d of dirs) {
    try {
      await load($, d)
    } catch (err) {
      $.ui.toast(`file-explorer: cannot list ${d}: ${String((err as Error)?.message ?? err)}`)
      if (d !== root) {
        await update($, tree, (cur: Tree) => ({ ...cur, open: cur.open.filter(p => p !== d) }))
      }
    }
  }
  await update($, tree, (cur: Tree) => ({ ...cur, root, preview: cur.root === root ? cur.preview : undefined }))
  const git = await gitStatus($, root)
  await update($, tree, (cur: Tree) => ({ ...cur, git }))
}

function refresh($: any) {
  if (pending >= 2) return tail
  pending++
  tail = tail
    .then(() => refreshNow($))
    .catch(err => $.ui.toast(`file-explorer: refresh failed: ${String((err as Error)?.message ?? err)}`))
    .finally(() => {
      pending--
    })
  return tail
}

// iterate.json {remaining, prompt}: each reload queues one prompt while remaining > 0.
async function continueIteration($: any) {
  const file = `${$.plugin.root}/iterate.json`
  try {
    const cfg = JSON.parse(await $.fs.read(file))
    if (!(cfg.remaining > 0) || typeof cfg.prompt !== 'string') return
    await $.fs.write(file, JSON.stringify({ ...cfg, remaining: cfg.remaining - 1 }))
    void $.prompt.submit({ text: cfg.prompt })
  } catch {
    // no iterate.json: nothing to continue
  }
}

let paneOpen = false

async function openPane($: any) {
  await refresh($)
  const opened = await $.ui.open({ id: PANE, title: 'Files' })
  paneOpen = !!opened.isPlaced
  if (!opened.isPlaced) $.ui.toast(`Files pane not drawn: ${opened.reason}`)
}

async function closePane($: any) {
  await $.ui.close({ id: PANE })
  paneOpen = false
}

// "auto" in theme.json: open the pane at every session start.
async function setAuto($: any, auto: boolean) {
  const file = `${$.plugin.root}/theme.json`
  const cfg = JSON.parse(await $.fs.read(file))
  await $.fs.write(file, JSON.stringify({ ...cfg, auto }, null, 2))
  T.auto = auto
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'files', description: 'Toggle the files tree pane; on/off sets the start-up default' })
    await loadTheme($)
    await continueIteration($)
    if (T.auto !== false) await openPane($)
    $.clock.every(1500, async () => {
      const changed = await loadTheme($)
      // Session state can start empty (after /clear) without a new session.start.
      if ((T.pin && T.pin !== lastRoot) || !(await current($)).root) await refresh($)
      if (!changed) return
      await update($, tree, (cur: Tree) => ({ ...cur, tick: cur.tick + 1 }))
    })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if ((e as any).id === PANE || (e as any).requestId === PANE) {
      paneOpen = false
      lastFileClick = undefined
      clickAcks.clear()
    }
    return next(e)
  })

  // /files toggles the pane, /files on|off also sets the start-up default, /files <path> pins a root.
  on('command.run', { command: 'files' }, async ($, e) => {
    const arg = e.args.trim().replace(/^["']|["']$/g, '')
    if (arg === 'on' || arg === 'off') {
      await setAuto($, arg === 'on')
      if (arg === 'on') await openPane($)
      else await closePane($)
      return { text: arg === 'on' ? 'Files pane on: opens at every session start.' : 'Files pane off: stays closed at session start. /files opens it.' }
    }
    if (arg) {
      const pin = arg === 'reset' ? '' : arg
      await update($, tree, (cur: Tree) => ({ ...cur, pin, open: [], dirs: {}, picked: '', preview: undefined }))
      await openPane($)
      return { text: 'Files pane opened.' }
    }
    if (paneOpen) {
      await closePane($)
      return { text: 'Files pane closed.' }
    }
    await openPane($)
    return { text: 'Files pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = e.data as { path?: unknown; instance?: unknown; clicks?: unknown } | null
    if (!data || typeof data.path !== 'string' || e.element !== `n:${data.path}` || e.module !== 'hooks/file-name.tsx') return {}
    if (typeof data.instance !== 'string' || data.instance.length > 100 || !Array.isArray(data.clicks) || !data.clicks.length || data.clicks.length > 32) return {}
    if (!data.clicks.every(click => click && Number.isSafeInteger(click.seq) && click.seq > 0 && typeof click.ctrl === 'boolean' && typeof click.canDouble === 'boolean')) return {}
    const t = await current($)
    if (t.preview || !flatten(t).slice(0, MAX_ROWS).some(row => row.path === data.path && row.kind !== 'dir')) return {}
    const prior = clickAcks.get(data.path)
    let seq = prior?.instance === data.instance ? prior.seq : 0
    const pending = data.clicks.filter(click => click.seq > seq)
    if (!pending.every((click, i) => click.seq === seq + i + 1)) return {}
    let preview = false
    let mentions = 0
    for (const click of pending) {
      if (click.ctrl) { mentions++; lastFileClick = undefined }
      else if (click.canDouble && lastFileClick?.path === data.path && lastFileClick.root === t.root) {
        preview = true
        lastFileClick = undefined
      } else lastFileClick = { path: data.path, root: t.root }
      seq = click.seq
    }
    const ack = { instance: data.instance, seq }
    clickAcks.set(data.path, ack)
    if (pending.length) await update($, tree, (cur: Tree) => ({ ...cur, picked: data.path as string }))
    const rel = data.path.slice(t.root.replace(/[\\/]+$/, '').length + 1)
    for (let i = 0; i < mentions; i++) await $.prompt.fill({ text: `@${/\s/.test(rel) ? `"${rel}"` : rel} `, mode: 'append' })
    if (preview) await previewFile($, data.path, t.root)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return undefined
    const { Box, Text, Button, Input, Svg, Code, Markdown, Client } = $.ui.resolve(e)
    try {
      await loadTheme($)
      const t: Tree = await current($)
      if (t.preview) {
        const p = t.preview
        const rel = p.path.slice(t.root.replace(/[\\/]+$/, '').length + 1)
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Button key="preview-back" label="‹ Files" plain onPress={() => { lastFileClick = undefined; clickAcks.clear(); return update($, tree, (cur: Tree) => ({ ...cur, preview: undefined })) }} />
            </Box>
            <Text bold wrap="wrap">{rel}</Text>
            {p.markdown && p.kind === 'text' && (
              <Box flexDirection="row" gap={1}>
                <Button key="preview-rendered" label="Rendered" plain onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, rendered: true } : undefined }))} />
                <Button key="preview-source" label="Source" plain onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, rendered: false } : undefined }))} />
              </Box>
            )}
            {p.kind === 'loading' ? <Text dimColor>Loading preview…</Text>
              : p.kind === 'image' && Svg ? <Svg source={p.content} alt={`Preview of ${rel}`} />
              : p.kind === 'image' ? <Text dimColor>Image preview is available in Claude Desktop.</Text>
              : p.kind === 'text' ? (p.content ? (p.markdown && p.rendered ? <Markdown text={p.content} /> : <Code source={p.content} path={p.path} startLine={1} />) : <Text dimColor>Empty file.</Text>)
              : <Text color={p.kind === 'error' ? 'red' : undefined}>{p.content}</Text>}
            {p.notice && <Text dimColor>{p.notice}</Text>}
          </Box>
        )
      }
      const rows = flatten(t)
      const shown = rows.slice(0, MAX_ROWS)

      const toggle = async (row: Row) => {
        lastFileClick = undefined
        const isOpen = row.isOpen
        await update($, tree, (cur: Tree) => ({
          ...cur,
          picked: row.path,
          open: isOpen ? cur.open.filter(p => p !== row.path) : [...cur.open, row.path],
          reveal: isOpen ? cur.reveal : { dir: row.path, n: 0 },
        }))
        if (isOpen) return
        await load($, row.path)
        const total = (await current($)).dirs[row.path]?.length ?? 0
        let n = 0
        const timer = $.clock.every(T.animMs, async () => {
          n += T.animStep
          const done = n >= total
          if (done) timer.cancel()
          await update($, tree, (cur: Tree) => ({
            ...cur,
            reveal: done ? { dir: '', n: 0 } : { dir: row.path, n },
          }))
        })
      }
      const setFilter = (v: string) => update($, tree, (cur: Tree) => ({ ...cur, filter: v }))

      const footer =
        (rows.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${rows.length}` : `${rows.length} items`) + ` | ${themeStatus}`

      const rootKey = norm(t.root)
      const isIgnored = (path: string) => {
        let key = norm(path)
        while (key.length > rootKey.length) {
          if (t.git[key] === 'I') return true
          key = key.slice(0, key.lastIndexOf('/'))
        }
        return false
      }

      return (
        <Box flexDirection="column" minHeight="100%">
          {(() => {
            const wide = ((e as { bodyColumns?: number }).bodyColumns ?? 0) >= T.wideCells
            const search = (
              <Input
                key="filter"
                label="⌕ "
                placeholder="Search files"
                value={t.filter}
                onInput={setFilter}
                onSubmit={setFilter}
              />
            )
            const actions = (
              <Box flexDirection="row" gap={1}>
                <Button key="refresh" label="↻" plain dimColor onPress={() => refresh($)} />
                <Button
                  key="collapse"
                  label="⊟"
                  plain
                  dimColor
                  onPress={() => update($, tree, (cur: Tree) => ({ ...cur, open: [] }))}
                />
              </Box>
            )
            if (T.searchMode === 'abs') {
              return (
                <Box flexDirection="column">
                  <Box position="absolute" top={T.searchTop} right={T.searchRight} width={T.searchCells}>
                    {search}
                  </Box>
                  <Box flexDirection="row" justifyContent="space-between" paddingX={T.padX}>
                    <Text bold wrap="truncate-end">
                      ▾ {baseName(t.root || '...').toUpperCase()}
                    </Text>
                    {actions}
                  </Box>
                </Box>
              )
            }
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" paddingX={T.padX}>
                  <Text bold wrap="truncate-end">
                    ▾ {baseName(t.root || '...').toUpperCase()}
                  </Text>
                  <Box flexDirection="row" gap={1}>
                    {wide && <Box width={T.searchCells}>{search}</Box>}
                    {actions}
                  </Box>
                </Box>
                {!wide && search}
              </Box>
            )
          })()}
          {shown.map(row => {
            const icon = iconOf(row.name, row.kind)
            const letter = t.git[norm(row.path)]
            const status = letter === 'I' ? undefined : letter
            const isDir = row.kind === 'dir'
            const isPicked = t.picked === row.path
            const isDim = isIgnored(row.path) || row.fresh
            return (
              <Box
                key={row.path}
                flexDirection="row"
                paddingX={T.padX}
                backgroundColor={isPicked ? T.bgPicked : undefined}
                hover={isPicked ? undefined : { backgroundColor: T.bgHover }}
              >
                {Array.from({ length: row.depth }, (_, i) => (
                  <Box key={`g${i}`} width={T.guideCells}>
                    {Svg ? <Svg source={guideSvg()} alt="" width={16} height={T.rowH} /> : <Text dimColor>│ </Text>}
                  </Box>
                ))}
                <Box width={T.chevCells}>
                  {!isDir ? (
                    <Text> </Text>
                  ) : Svg ? (
                    <Svg source={chevronSvg(row.isOpen)} alt="chevron" width={16} height={T.rowH} />
                  ) : (
                    <Text dimColor>{row.isOpen ? '⌄' : '›'}</Text>
                  )}
                </Box>
                <Box width={T.iconCells}>
                  {Svg ? (
                    <Svg
                      source={isDir ? folderSvg(row.isOpen, isDim) : fileSvg(icon.color, isDim)}
                      alt={isDir ? 'folder' : 'file'}
                      width={16}
                      height={T.rowH}
                    />
                  ) : (
                    <Text color={icon.color} bold>
                      {icon.glyph}
                    </Text>
                  )}
                </Box>
                <Box flexGrow={1} flexDirection="row">
                  {isDir ? <Box>
                    <Button
                      key={`n:${row.path}`}
                      label={row.name}
                      plain
                      dimColor={isDim}
                      onPress={() => toggle(row)}
                    />
                  </Box> : <Client key={`n:${row.path}`} module="./file-name.tsx" width="100%" height={1}
                    props={{ path: row.path, name: row.name, dim: isDim, picked: t.picked, ack: clickAcks.get(row.path) ?? null }} />}
                </Box>
                {status && (
                  <Text color={GIT_COLOR[status]} bold>
                    {isDir ? '●' : status}
                  </Text>
                )}
              </Box>
            )
          })}
          <Box paddingX={1}>
            <Text dimColor>{footer}</Text>
          </Box>
        </Box>
      )
    } catch (err) {
      return <Text color="red">file-explorer error: {String((err as Error)?.message ?? err)}</Text>
    }
  })
}
