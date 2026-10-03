import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Entry, Preview, Tree } from '../types'
import { editorProps, markdownChunks, sourceChunks } from './editing'

const cleanError = (error: unknown) => String((error as Error)?.message ?? error).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 1000)
async function requestBack($: any, discard = false): Promise<boolean> {
  let closed = false
  await update($, tree, (cur: Tree) => {
    closed = false
    const p = cur.preview
    if (!p) return cur
    if (p.busy) return cur
    if (p.dirty && !discard) return { ...cur, preview: { ...p, confirmBack: true } }
    closed = true
    return { ...cur, picked: '', preview: undefined }
  })
  return closed
}

async function savePreview($: any, request: number, goBack = false) {
  let snapshot: Preview | undefined
  await update($, tree, (cur: Tree) => {
    snapshot = undefined
    const p = cur.preview
    if (!p || p.request !== request || !p.editable || p.busy) return cur
    snapshot = { ...p }
    return { ...cur, preview: { ...p, busy: true, error: '' } }
  })
  if (!snapshot) return
  const p = snapshot as Preview
  try {
    const cur: Tree = await read($, tree)
    const [root, file] = await Promise.all([$.fs.stat(cur.root, { resolve: true }), $.fs.stat(p.path, { resolve: true })])
    if (!root.realPath || !file.realPath || file.kind !== 'file' || norm(file.realPath) !== norm(p.realPath ?? '') || !norm(file.realPath).startsWith(norm(root.realPath) + '/')) throw new Error('File location changed or is outside the explorer root.')
    const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/hooks/write-file.ps1`, '-FilePath', file.realPath, '-RootPath', root.realPath], {
      stdin: JSON.stringify({ hash: p.hash, text: p.draft, encoding: p.encoding, eol: p.eol }), timeoutMs: 10000,
    })
    if (result.exitCode !== 0) throw new Error('Save could not finish. Your draft is kept; check the file on disk.')
    const data = JSON.parse(result.stdout)
    if (data.ok !== true || typeof data.hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.hash)) throw new Error(typeof data.message === 'string' ? data.message : 'Invalid save response. Your draft is kept.')
    await update($, tree, (saved: Tree) => saved.preview?.request === request ? { ...saved, preview: {
      ...saved.preview, hash: data.hash, savedText: p.draft, dirty: saved.preview.draft !== p.draft,
      busy: false, error: '', notice: 'Saved',
    } } : saved)
    if (goBack) await requestBack($)
  } catch (error) {
    await update($, tree, (cur: Tree) => cur.preview?.request === request ? { ...cur, preview: { ...cur.preview, busy: false, error: cleanError(error) } } : cur)
  }
}

async function editorMessage($: any, e: any) {
  const data = e.data
  if (data?.view) {
    const v = data.view
    if (![v.request, v.row, v.line, v.col, v.selected, v.total].every(Number.isSafeInteger) || v.row < 0 || v.line < 0 || v.col < 0 || v.selected < 0 || v.total < 1) return {}
    await update($, tree, (cur: Tree) => {
      const p = cur.preview
      if (!p?.editing || p.request !== v.request) return cur
      return { ...cur, preview: { ...p, editorRow: v.row, editorLine: v.line, editorCol: v.col, editorSelected: v.selected, editorTotal: v.total } }
    })
    $.clock.after(80, () => $.ui.scroll({ to: { key: 'editor-caret' }, in: PANE }).catch(() => {}))
    return {}
  }
  if (data?.find) {
    const f = data.find
    if (!Number.isSafeInteger(f.request) || typeof f.text !== 'string' || f.text.length > 400) return {}
    if (f.request !== (await current($)).preview?.request) return {}
    findShown = !!f.text
    $.ui.status(f.text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ') || undefined)
    return {}
  }
  if (!data || typeof data.instance !== 'string' || !data.instance || data.instance.length > 100 || !Number.isSafeInteger(data.seq) || data.seq <= 0 || !Number.isSafeInteger(data.request)) return {}
  if (!Number.isSafeInteger(data.rows) || data.rows < 8 || data.rows > 40) return {}
  if (typeof data.text !== 'string' || data.text.length > 30000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(data.text)) return {}
  if (!['change', 'save', 'copy', 'cut', 'paste'].includes(data.action)) return {}
  if (!Number.isSafeInteger(data.from) || !Number.isSafeInteger(data.to) || data.from < 0 || data.to < data.from || data.to > data.text.length) return {}
  let accepted = false
  await update($, tree, (cur: Tree) => {
    accepted = false
    const p = cur.preview
    if (!p || p.request !== data.request || !p.editable || !p.editing || (p.editorInstance === data.instance && data.seq <= (p.editorSeq ?? 0))) return cur
    accepted = true
    return { ...cur, preview: { ...p, draft: data.text, content: data.text, dirty: data.text !== p.savedText,
      editorInstance: data.instance, editorSeq: data.seq, editorCursor: data.to } }
  })
  if (!accepted) return {}
  if (data.action === 'save') await savePreview($, data.request)
  else if (data.action !== 'change') {
    await update($, tree, (cur: Tree) => cur.preview && cur.preview.request === data.request ? { ...cur, preview: { ...cur.preview, busy: true } } : cur)
    try {
      let inserted = ''
      if (data.action === 'paste') {
        const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $text=Get-Clipboard -Raw; [Console]::Out.Write((@{text=$text}|ConvertTo-Json -Compress))'], { timeoutMs: 5000 })
        if (result.exitCode !== 0) throw new Error('Clipboard could not be read.')
        const clipboard = JSON.parse(result.stdout)
        if (clipboard.text !== null && typeof clipboard.text !== 'string') throw new Error('Clipboard does not contain text.')
        inserted = (clipboard.text ?? '').replace(/\r\n?/g, '\n')
      } else {
        const copied = await $.ui.copy({ text: data.text.slice(data.from, data.to), surface: e.surface })
        if (!copied.isCopied) throw new Error('Clipboard could not be updated.')
      }
      const text = data.action === 'copy' ? data.text : data.text.slice(0, data.from) + inserted + data.text.slice(data.to)
      if (text.length > 30000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text)) throw new Error('Pasted text exceeds the editor limit or contains unsupported control characters.')
      await update($, tree, (cur: Tree) => {
        const p = cur.preview
        if (!p || p.request !== data.request) return cur
        if (p.editorSeq !== data.seq || p.editorInstance !== data.instance) return { ...cur, preview: { ...p, busy: false, error: 'Buffer changed during the clipboard operation. Try again.' } }
        return { ...cur, preview: { ...p, draft: text, content: text, dirty: text !== p.savedText, busy: false,
          editorRefresh: (p.editorRefresh ?? 0) + (data.action === 'copy' ? 0 : 1), editorCursor: data.from + inserted.length } }
      })
    } catch (error) {
      await update($, tree, (cur: Tree) => cur.preview && cur.preview.request === data.request ? { ...cur, preview: { ...cur.preview, busy: false, error: cleanError(error) } } : cur)
    }
  }
  const cur: Tree = await read($, tree)
  return cur.preview && cur.preview.request === data.request ? { props: editorFor(cur.preview, data.rows) } : {}
}

const PANE = 'file-explorer'
const MAX_ROWS = 800
const clickAcks = new Map<string, { instance: string; seq: number }>()
let lastFileClick: { path: string; root: string } | undefined
let selectionActive = false
let findShown = false
// Last pane geometry seen, so the editor's props agree between a pane render and an editor message reply.
const paneView = { offset: 0, body: 35, content: 0, fit: 1 }
const editorFor = (p: Preview, rows: number) => {
  const total = p.editorTotal ?? p.draft?.split('\n').length ?? 0
  const top = Math.max(0, paneView.offset - Math.max(0, paneView.content - total - 2))
  return editorProps(p, rows, paneView.fit, top, Math.max(8, paneView.body))
}
const EDITOR_WINDOW = 120
const ENCODINGS: Record<string, string> = { utf8: 'UTF-8', utf8bom: 'UTF-8 BOM', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE' }
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

async function clearSelection($: any) {
  lastFileClick = undefined
  selectionActive = false
  const c = await current($)
  if (c.picked || c.menu) await update($, tree, (cur: Tree) => ({ ...cur, picked: '', ...NO_MENU }))
}

async function backToFiles($: any, discard = false) {
  if (await requestBack($, discard)) {
    lastFileClick = undefined
    clickAcks.clear()
    selectionActive = false
  }
}

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
  // CSS px of one character cell vertically; converts rowH into the cell offsets Box top and bottom take.
  cellPx: 19.2,
  radius: 4,
  bgHover: '#161b22',
  bgPicked: '#09182e',
  menuBg: '#262624',
  menuBorder: '#3d3d3a',
  menuHover: '#30302e',
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
// One 8px-wide end of a rounded row highlight; the straight middle is a plain Box.
const capSvg = (color: string, left: boolean) => {
  const h = T.rowH
  const r = T.radius
  const path = left
    ? `M8 0H${r}A${r} ${r} 0 0 0 0 ${r}V${h - r}A${r} ${r} 0 0 0 ${r} ${h}H8Z`
    : `M0 0H${8 - r}A${r} ${r} 0 0 1 8 ${r}V${h - r}A${r} ${r} 0 0 1 ${8 - r} ${h}H0Z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 ${h}" width="8" height="${h}"><path d="${path}" fill="${color}"/></svg>`
}
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
const relPath = (root: string, p: string) => p.slice(root.replace(/[\\/]+$/, '').length + 1)
const mention = (rel: string) => `@${/\s/.test(rel) ? `"${rel}"` : rel} `

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
      const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/hooks/read-preview.ps1`, '-FilePath', file.realPath, '-RootPath', folder.realPath], { timeoutMs: 10000 })
      if (result.exitCode !== 0) throw new Error('File could not be read for preview.')
      const data = JSON.parse(result.stdout)
      if (!['text', 'unsupported'].includes(data.kind) || typeof data.content !== 'string' || data.content.length > 30000) throw new Error('Invalid text preview response.')
      preview.kind = data.kind
      preview.content = data.content
      preview.realPath = file.realPath
      if (data.kind === 'text' && data.editable === true) {
        if (typeof data.draft !== 'string' || data.draft !== data.content || !/^[a-f0-9]{64}$/.test(data.hash) || !['utf8', 'utf8bom', 'utf16le', 'utf16be'].includes(data.encoding) || !['lf', 'crlf', 'cr'].includes(data.eol)) throw new Error('Invalid editable file response.')
        Object.assign(preview, { editable: true, draft: data.draft, savedText: data.draft, hash: data.hash, encoding: data.encoding, eol: data.eol, dirty: false, editing: false })
      }
      preview.notice = data.kind === 'text' ? (typeof data.notice === 'string' && data.notice ? data.notice : data.truncated ? 'Preview truncated · showing the beginning of the file' : preview.editable ? 'Preview · Edit to make changes' : 'Read-only preview') : ''
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

type Row = { path: string; name: string; depth: number; kind: Entry['kind']; isOpen: boolean; fresh: boolean; where?: string }

// Every entry below the root, crawled breadth-first on the first search so collapsed folders match too.
let searchIndex: { root: string; hits: { path: string; name: string; kind: Entry['kind'] }[] } | undefined
const SEARCH_SKIP = new Set(['node_modules'])
const SEARCH_CAP = 20000

async function buildSearchIndex($: any, root: string) {
  const index = { root, hits: [] as { path: string; name: string; kind: Entry['kind'] }[] }
  searchIndex = index
  const queue = [root]
  let listed = 0
  while (queue.length && index.hits.length < SEARCH_CAP && searchIndex === index) {
    const dir = queue.shift()!
    let entries: Entry[]
    try { entries = await $.fs.list(dir) } catch { continue }
    for (const e of entries) {
      if (HIDDEN.has(e.name) || SEARCH_SKIP.has(e.name)) continue
      const path = join(dir, e.name)
      index.hits.push({ path, name: e.name, kind: e.kind })
      if (e.kind === 'dir') queue.push(path)
    }
    if (++listed % 25 === 0) await update($, tree, (cur: Tree) => ({ ...cur, tick: cur.tick + 1 }))
  }
  if (searchIndex === index) await update($, tree, (cur: Tree) => ({ ...cur, tick: cur.tick + 1 }))
}

const flatten = (t: Tree): Row[] => {
  const rows: Row[] = []
  const needle = t.filter.trim().toLowerCase()
  if (needle && searchIndex?.root === t.root) {
    const rootLength = t.root.replace(/[\\/]+$/, '').length + 1
    for (const h of searchIndex.hits) {
      if (!h.name.toLowerCase().includes(needle)) continue
      const where = h.path.slice(rootLength, h.path.length - h.name.length - 1)
      rows.push({ path: h.path, name: h.name, depth: 0, kind: h.kind, isOpen: false, fresh: false, where })
    }
    return rows
  }
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
  const root: string = t.pin || T.pin || (await $.session.root())
  if (t.root !== root && (t.preview?.dirty || t.preview?.busy)) return
  lastRoot = root
  searchIndex = undefined
  if (t.filter.trim()) buildSearchIndex($, root).catch(() => {})
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
  await update($, tree, (cur: Tree) => cur.root !== root && (cur.preview?.dirty || cur.preview?.busy) ? cur : ({ ...cur, root, preview: cur.root === root ? cur.preview : undefined }))
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

const NO_MENU = { menu: undefined, menuMode: undefined, menuText: undefined }
const MENU_W = 28

// Runs file-op.ps1 on a path inside the explorer root and reports a refusal as a toast.
async function fileOp($: any, op: string, path: string, name = '') {
  try {
    const cur: Tree = await read($, tree)
    const [root, item] = await Promise.all([$.fs.stat(cur.root, { resolve: true }), $.fs.stat(path, { resolve: true })])
    const inside = (p?: string) => !!p && !!root.realPath && (norm(p) + '/').startsWith(norm(root.realPath) + '/')
    if (!inside(item.realPath) || (norm(item.realPath) === norm(root.realPath) && !op.startsWith('new'))) throw new Error('Item is outside the explorer root.')
    const result = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/hooks/file-op.ps1`, '-Op', op, '-Path', item.realPath, '-RootPath', root.realPath, ...(name ? ['-Name', name] : [])], { timeoutMs: 15000 })
    if (result.exitCode !== 0) throw new Error('File operation could not finish.')
    const data = JSON.parse(result.stdout)
    if (data.ok !== true) throw new Error(typeof data.message === 'string' && data.message ? data.message : 'File operation failed.')
    await refresh($)
  } catch (error) {
    $.ui.toast(cleanError(error))
  }
}

type MenuItemDef = { id: string; label: string; run: () => unknown }

// The items of the open row menu: the pane draws them and the item message runs one by id.
function menuGroups($: any, t: Tree, row: Row, surface: string): MenuItemDef[][] {
  const isDir = row.kind === 'dir'
  const close = () => update($, tree, (cur: Tree) => ({ ...cur, ...NO_MENU }))
  const closing = (id: string, label: string, run: () => unknown): MenuItemDef => ({ id, label, run: async () => { await close(); await run() } })
  const staying = (id: string, label: string, patch: Partial<Tree>): MenuItemDef => ({ id, label, run: () => update($, tree, (cur: Tree) => ({ ...cur, menu: row.path, ...patch })) })
  if (t.menuMode === 'delete') return [[closing('delete-confirm', 'Delete', () => fileOp($, 'delete', row.path)), { id: 'cancel', label: 'Cancel', run: close }]]
  if (t.menuMode) return []
  const rel = relPath(t.root, row.path)
  return [
    [
      ...(isDir
        ? [staying('new-file', 'New file', { menuMode: 'newfile', menuText: '' }), staying('new-folder', 'New folder', { menuMode: 'newfolder', menuText: '' })]
        : [closing('open', 'Open', () => previewFile($, row.path, t.root))]),
      closing('add-prompt', 'Add to prompt', () => $.prompt.fill({ text: mention(rel), mode: 'append' })),
    ],
    [
      staying('rename', 'Rename', { menuMode: 'rename', menuText: row.name }),
      closing('duplicate', 'Duplicate', () => fileOp($, 'duplicate', row.path)),
      staying('delete', 'Delete', { menuMode: 'delete' }),
    ],
    [
      closing('copy-path', 'Copy path', () => $.ui.copy({ text: row.path, surface })),
      closing('copy-relative', 'Copy relative path', () => $.ui.copy({ text: rel, surface })),
      closing('reveal', 'Reveal in File Explorer', () => $.process.run(['explorer.exe', `/select,${row.path.replace(/\//g, '\\')}`], { timeoutMs: 5000 })),
    ],
  ]
}

async function toggleDir($: any, path: string, isOpen: boolean) {
  lastFileClick = undefined
  selectionActive = true
  await update($, tree, (cur: Tree) => ({
    ...cur,
    picked: path,
    ...NO_MENU,
    open: isOpen ? cur.open.filter(p => p !== path) : [...cur.open, path],
    reveal: isOpen ? cur.reveal : { dir: path, n: 0 },
  }))
  if (isOpen) return
  await load($, path)
  const total = (await current($)).dirs[path]?.length ?? 0
  let n = 0
  const timer = $.clock.every(T.animMs, async () => {
    n += T.animStep
    const done = n >= total
    if (done) timer.cancel()
    await update($, tree, (cur: Tree) => ({
      ...cur,
      reveal: done ? { dir: '', n: 0 } : { dir: path, n },
    }))
  })
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
let paneFocused = false
// The menu path hidden because the pane lost the keyboard while it was open.
let blurredMenu: string | undefined

async function openPane($: any) {
  await refresh($)
  const opened = await $.ui.open({ id: PANE, title: 'Files' })
  paneOpen = !!opened.isPlaced
  if (!opened.isPlaced) $.ui.toast(`Files pane not drawn: ${opened.reason}`)
}

async function closePane($: any) {
  const p = (await current($)).preview
  if (p?.dirty || p?.busy) { await requestBack($); return false }
  await $.ui.close({ id: PANE })
  paneOpen = false
  return true
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
      if (changed || (T.pin && T.pin !== lastRoot) || !(await current($)).root) await refresh($)
      if (!changed) return
      await update($, tree, (cur: Tree) => ({ ...cur, tick: cur.tick + 1 }))
    })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if ((e as any).id === PANE || (e as any).requestId === PANE) {
      const p = (await current($)).preview
      if (e.origin.kind !== 'unload' && (p?.dirty || p?.busy)) { await requestBack($); return { value: undefined } }
      paneOpen = false
      selectionActive = false
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
      else if (!(await closePane($))) return { text: 'Auto-open disabled. Save or discard the draft before closing Files.' }
      return { text: arg === 'on' ? 'Files pane on: opens at every session start.' : 'Files pane off: stays closed at session start. /files opens it.' }
    }
    if (arg) {
      const p = (await current($)).preview
      if (p?.dirty || p?.busy) { await requestBack($); return { text: 'Save or discard the current draft before changing the files root.' } }
      const pin = arg === 'reset' ? '' : arg
      await update($, tree, (cur: Tree) => ({ ...cur, pin, open: [], dirs: {}, picked: '', preview: undefined }))
      await openPane($)
      return { text: 'Files pane opened.' }
    }
    if (paneOpen) {
      const closed = await closePane($)
      return { text: closed ? 'Files pane closed.' : 'Save or discard the current draft before closing Files.' }
    }
    await openPane($)
    return { text: 'Files pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await current($)).preview && e.origin.kind === 'person' && (e.plugin !== 'file-explorer' || !/^(n:|menu-)/.test(e.element ?? ''))) await clearSelection($)
    return next(e)
  })

  // The pane scrolls the editor natively; the editor only draws a window of lines, centred on the scroll position.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    paneView.offset = e.offset; paneView.body = e.bodyRows; paneView.content = e.contentRows
    const p = (await current($)).preview
    if (p?.editing && p.draft !== undefined) {
      const total = p.editorTotal ?? p.draft.split('\n').length
      const first = Math.max(0, e.offset - Math.max(0, e.contentRows - total - 2))
      const win = Math.max(0, Math.min(total - EDITOR_WINDOW, first - Math.floor((EDITOR_WINDOW - e.bodyRows) / 2)))
      if (Math.abs(win - (p.editorWin ?? 0)) > 15) update($, tree, (cur: Tree) => cur.preview?.request === p.request ? { ...cur, preview: { ...cur.preview, editorWin: win } } : cur).catch(() => {})
    }
    return next(e)
  })

  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.element === 'preview-navigation' && e.module === 'hooks/preview-navigation.tsx' && (e.data as { back?: unknown } | null)?.back === true) { await backToFiles($); return {} }
    if (e.element === 'file-editor' && e.module === 'hooks/editor.tsx') return editorMessage($, e)
    if (e.module === 'hooks/clear-selection.tsx' && ['tree-empty', 'tree-title'].includes(e.element) && (e.data as { clear?: unknown } | null)?.clear === true) {
      await clearSelection($)
      return {}
    }
    if (e.module === 'hooks/menu-item.tsx') {
      const id = (e.data as { id?: unknown } | null)?.id
      if (typeof id !== 'string' || e.element !== `m:${id}`) return {}
      const t = await current($)
      const row = t.menu && !t.preview ? flatten(t).slice(0, MAX_ROWS).find(r => r.path === t.menu) : undefined
      const item = row && menuGroups($, t, row, e.surface).flat().find(i => i.id === id)
      if (item) await item.run()
      return {}
    }
    const data = e.data as { path?: unknown; instance?: unknown; clicks?: unknown; toggle?: unknown; menu?: unknown } | null
    if (!data || typeof data.path !== 'string' || e.element !== `n:${data.path}` || e.module !== 'hooks/file-name.tsx') return {}
    if (data.menu === true) {
      const t = await current($)
      const path = data.path
      if (t.preview || !flatten(t).slice(0, MAX_ROWS).some(r => r.path === path)) return {}
      const shown = t.menu === path && blurredMenu !== path
      blurredMenu = undefined
      lastFileClick = undefined
      await update($, tree, (cur: Tree) => shown ? { ...cur, ...NO_MENU } : { ...cur, ...NO_MENU, menu: path })
      return {}
    }
    if (data.toggle === true) {
      const t = await current($)
      const row = t.preview ? undefined : flatten(t).slice(0, MAX_ROWS).find(r => r.path === data.path)
      if (row?.kind === 'dir') await toggleDir($, row.path, row.isOpen)
      return {}
    }
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
    if (pending.length) {
      selectionActive = true
      await update($, tree, (cur: Tree) => ({ ...cur, picked: data.path as string, ...NO_MENU }))
    }
    for (let i = 0; i < mentions; i++) await $.prompt.fill({ text: mention(relPath(t.root, data.path)), mode: 'append' })
    if (preview) await previewFile($, data.path, t.root)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return $.ui.resolve(e).Text({ children: 'Files pane is available in Claude Desktop and the terminal.' })
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Input, Code, Markdown, Client } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    try {
      await loadTheme($)
      if (!e.props.isFocused) { selectionActive = false; lastFileClick = undefined }
      const t: Tree = await current($)
      // No blur event: the pane losing the keyboard (a click outside) hides the open menu. Drawing only, no state write.
      if (paneFocused && !e.props.isFocused && t.menu) blurredMenu = t.menu
      paneFocused = e.props.isFocused
      paneView.offset = e.props.scroll.offset; paneView.body = e.props.scroll.bodyRows; paneView.fit = e.surface === 'desktop' ? 1.15 : 1
      if (findShown && !t.preview?.editing) { findShown = false; $.ui.status(undefined) }
      if (t.preview) {
        const p = t.preview
        const rel =p.path.slice(t.root.replace(/[\\/]+$/, '').length + 1)
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Client key="preview-navigation" module="./preview-navigation.tsx" props={{}} />
              {p.editable && <Box flexDirection="row" gap={1}>
                {p.editing && <Button key="preview-wrap" label={editorProps(p).wrap ? 'Wrap: on' : 'Wrap: off'} variant="secondary" onPress={() => update($, tree, (cur: Tree) => cur.preview ? { ...cur, preview: { ...cur.preview, editorWrap: !editorProps(cur.preview).wrap } } : cur)} />}
                <Button key="preview-edit" label="Edit" variant={p.editing ? 'primary' : 'secondary'} onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, editing: true, confirmBack: false } : undefined }))} />
                <Button key="preview-save" label={p.busy ? 'Saving…' : 'Save'} variant="primary" onPress={() => savePreview($, p.request)} />
              </Box>}
            </Box>
            <Text bold wrap="wrap">{rel}{p.dirty ? ' • Unsaved' : ''}</Text>
            {p.confirmBack && <Box flexDirection="column" gap={1}>
              <Text>Save changes before returning to Files?</Text>
              <Box flexDirection="row" gap={1}>
                <Button key="preview-save-back" label="Save and return" variant="primary" onPress={async () => { await savePreview($, p.request); const latest = (await current($)).preview; if (latest?.request === p.request && !latest.dirty && !latest.busy && !latest.error) await backToFiles($) }} />
                <Button key="preview-discard" label="Discard changes" onPress={() => backToFiles($, true)} />
                <Button key="preview-keep-editing" label="Keep editing" onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, confirmBack: false } : undefined }))} />
              </Box>
            </Box>}
            {p.error && <Text color="red" wrap="wrap">{p.error}</Text>}
            {p.kind === 'text' && (
              <Box flexDirection="row" gap={1}>
                {p.markdown && <Button key="preview-rendered" label="Preview" plain onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, rendered: true, editing: false } : undefined }))} />}
                <Button key="preview-source" label="Source" plain onPress={() => update($, tree, (cur: Tree) => ({ ...cur, preview: cur.preview ? { ...cur.preview, rendered: false, editing: false } : undefined }))} />
              </Box>
            )}
            {p.kind === 'loading' ? <Text dimColor>Loading preview…</Text>
              : p.kind === 'image' && Svg ? <Svg source={p.content} alt={`Preview of ${rel}`} />
              : p.kind === 'image' ? <Text dimColor>Image preview is available in Claude Desktop.</Text>
              : p.kind === 'text' && p.editing ? <Box flexDirection="column">
                <Text dimColor>{`Ln ${(p.editorLine ?? 0) + 1}, Col ${(p.editorCol ?? 0) + 1}${p.editorSelected ? ` (${p.editorSelected} selected)` : ''} · ${ENCODINGS[p.encoding ?? ''] ?? p.encoding ?? ''} · ${(p.eol ?? 'lf').toUpperCase()} · Ctrl+S Save · Ctrl+Z Undo · Ctrl+Y Redo · Ctrl+V Paste`}</Text>
                <Box flexDirection="column" position="relative">
                <Box key="editor-caret" position="absolute" top={p.editorRow ?? 0} height={1} width={1} />
                <Client key="file-editor" module="./editor.tsx" width="100%" props={editorFor(p, Math.max(8, Math.min(40, e.props.scroll.bodyRows - 8)))} />
                </Box>
              </Box>
              : p.kind === 'text' ? (p.content ? (p.markdown && p.rendered ? <Box flexDirection="column">{markdownChunks(p.content).map((part, index) => <Box key={`markdown:${index}`}>{part.code ? <Code source={part.text} language={part.code} /> : <Markdown text={part.text} />}</Box>)}</Box> : <Box flexDirection="column">{sourceChunks(p.content).map((part, index) => <Box key={`source:${index}`}><Code source={part.text} path={p.path} startLine={part.line} /></Box>)}</Box>) : <Text dimColor>Empty file.</Text>)
              : <Text color={p.kind === 'error' ? 'red' : undefined}>{p.content}</Text>}
            {p.notice && <Text dimColor>{p.notice}</Text>}
          </Box>
        )
      }
      const rows = flatten(t)
      const shown = rows.slice(0, MAX_ROWS)

      const setFilter = (v: string) => {
        lastFileClick = undefined
        if (v.trim() && searchIndex?.root !== t.root) buildSearchIndex($, t.root).catch(() => {})
        return update($, tree, (cur: Tree) => ({ ...cur, filter: v, picked: '' }))
      }

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

      // The highlight ends are in-flow cells; an absolute layer over the row would paint over its icon.
      // alignSelf flex-start pins the cell to the row's top: the desktop draws it zero-high, and centred it starts half a row low.
      const rowCap = (left: boolean, isPicked: boolean) => {
        if (!Svg) return <Box width={T.padX} />
        const color = isPicked ? T.bgPicked : T.bgHover
        return (
          <Box width={1} position="relative" alignSelf="flex-start">
            <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 ${T.rowH}" width="8" height="${T.rowH}"/>`} alt="" width={8} height={T.rowH} />
            <Box position="absolute" top={0} left={0} display={isPicked ? 'flex' : 'none'} hover={isPicked ? undefined : { display: 'flex' }}>
              <Svg source={capSvg(color, left)} alt={isPicked ? 'row-cap-picked' : 'row-cap'} width={8} height={T.rowH} />
            </Box>
          </Box>
        )
      }
      // Drawn last in the rows container, so no row paints over it. Rows are rowH px tall and Box offsets are whole cells of cellPx px.
      const menuAt = t.menu && t.menu !== blurredMenu ? shown.findIndex(r => r.path === t.menu) : -1
      const menuPanel = (row: Row, idx: number) => {
        const mode = t.menuMode
        const edit = mode === 'rename' || mode === 'newfile' || mode === 'newfolder'
        const groups = menuGroups($, t, row, e.surface)
        const lines = edit ? 1 : mode === 'delete' ? 3 : groups.flat().length + groups.length - 1
        const cells = (rows: number) => Math.round((rows * T.rowH) / T.cellPx)
        const { offset = 0, bodyRows = 30 } = (e.props as any).scroll ?? {}
        const top = 4 + cells(idx + 1) - offset + lines + 2 > bodyRows ? Math.max(0, cells(idx) - lines - 2) : cells(idx + 1)
        const left = Math.max(0, ((e as any).bodyColumns ?? 60) - MENU_W - 2)
        return (
          <Box key="menu-panel" position="absolute" top={top} left={left} width={MENU_W} flexDirection="column" backgroundColor={T.menuBg} borderStyle="round" borderColor={T.menuBorder} paddingX={1}>
            {edit && (
              <Input key="menu-input" label={mode === 'newfile' ? 'New file ' : mode === 'newfolder' ? 'New folder ' : ''} value={t.menuText ?? ''} onInput={(v: string) => update($, tree, (cur: Tree) => ({ ...cur, menuText: v }))}
                onSubmit={async (v: string) => {
                  await update($, tree, (cur: Tree) => ({ ...cur, ...NO_MENU, open: mode === 'rename' || cur.open.includes(row.path) ? cur.open : [...cur.open, row.path] }))
                  await fileOp($, mode as string, row.path, v)
                }} />
            )}
            {mode === 'delete' && <Text>Move to Recycle Bin?</Text>}
            {groups.map((group, g) => (
              <Box key={`menu-group-${g}`} flexDirection="column">
                {/* The desktop draws ─ 1.15 cells wide; a wrapping Box would move the rule to the top of its cell. */}
                {g > 0 && <Text color={T.menuBorder}>{'─'.repeat(Math.floor((MENU_W - 4) / (e.surface === 'desktop' ? 1.15 : 1)))}</Text>}
                {group.map(item => (
                  <Box key={`menu-row-${item.id}`} hover={{ backgroundColor: T.menuHover }}>
                    <Client key={`m:${item.id}`} module="./menu-item.tsx" width="100%" height={1} props={{ id: item.id, label: item.label }} />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )
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
            // A keyed Box is the hover scope: the label is hidden until the pointer is over its button.
            const tip = (id: string, label: string, button: unknown) => (
              <Box key={`tip-${id}`} position="relative">
                {button}
                <Box position="absolute" top={1} right={0} display="none" hover={{ display: 'flex' }} backgroundColor="#1f2428" paddingX={1}>
                  <Text>{label}</Text>
                </Box>
              </Box>
            )
            const actions = (
              <Box flexDirection="row" gap={1}>
                {tip('refresh', 'Refresh', <Button key="refresh" label="↻" plain dimColor onPress={async () => { await clearSelection($); await refresh($) }} />)}
                {tip('collapse', 'Collapse all folders', <Button
                  key="collapse"
                  label="⊟"
                  plain
                  dimColor
                  onPress={() => { lastFileClick = undefined; return update($, tree, (cur: Tree) => ({ ...cur, open: [], picked: '' })) }}
                />)}
              </Box>
            )
            if (T.searchMode === 'abs') {
              return (
                <Box flexDirection="column">
                  <Box position="absolute" top={T.searchTop} right={T.searchRight} width={T.searchCells}>
                    {search}
                  </Box>
                  <Box flexDirection="row" justifyContent="space-between" paddingX={T.padX}>
                    <Client key="tree-title" module="./clear-selection.tsx" flexGrow={1} height={1}
                      props={{ text: `▾ ${baseName(t.root || '...').toUpperCase()}`, bold: true, padX: 0 }} />
                    {actions}
                  </Box>
                </Box>
              )
            }
            return (
              <Box flexDirection="column" paddingTop={1}>
                <Box flexDirection="row" justifyContent="space-between" paddingX={T.padX}>
                    <Client key="tree-title" module="./clear-selection.tsx" flexGrow={1} height={1}
                      props={{ text: `▾ ${baseName(t.root || '...').toUpperCase()}`, bold: true, padX: 0 }} />
                  <Box flexDirection="row" gap={1}>
                    {wide && <Box width={T.searchCells}>{search}</Box>}
                    {actions}
                  </Box>
                </Box>
                {!wide && search}
              </Box>
            )
          })()}
          <Box position="relative" flexDirection="column">
          {shown.map(row => {
            const icon = iconOf(row.name, row.kind)
            const letter = t.git[norm(row.path)]
            const status = letter === 'I' ? undefined : letter
            const isDir = row.kind === 'dir'
            const isPicked = selectionActive && t.picked === row.path
            const isDim = isIgnored(row.path) || row.fresh
            return (
              <Box key={row.path} flexDirection="row" alignItems="center">
                {rowCap(true, isPicked)}
                <Box flexGrow={1} flexDirection="row" alignItems="center" backgroundColor={isPicked ? T.bgPicked : undefined} hover={isPicked ? undefined : { backgroundColor: T.bgHover }}>
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
                  {/* The Client also draws the status and the "…" trigger: a desktop Button can spend its first click on focus, and a Client per trigger floods the page. */}
                  <Client key={`n:${row.path}`} module="./file-name.tsx" width="100%" height={1}
                    props={{ path: row.path, name: row.where ? `${row.name}  ${row.where}` : row.name, dim: isDim, picked: t.picked, ack: clickAcks.get(row.path) ?? null, dir: isDir, menu: true,
                      status: status ? { text: isDir ? '●' : status, color: GIT_COLOR[status] ?? '' } : null }} />
                </Box>
                </Box>
                {rowCap(false, isPicked)}
              </Box>
            )
          })}
          {menuAt >= 0 && menuPanel(shown[menuAt]!, menuAt)}
          </Box>
          <Client key="tree-empty" module="./clear-selection.tsx" width="100%" flexGrow={1}
            props={{ text: footer, bold: false, padX: 1 }} />
        </Box>
      )
    } catch (err) {
      return <Text color="red">file-explorer error: {String((err as Error)?.message ?? err)}</Text>
    }
  })
}
