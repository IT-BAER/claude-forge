import type { ClientModule } from 'claude-code'

export type EditorProps = {
  request: number; text: string; instance: string; seq: number; refresh: number; cursor: number;
  busy: boolean; rows: number; ext: string; fit: number; win: number; wrap: boolean; top: number; span: number
  mono?: boolean
}
type Snapshot = { text: string; cursor: number; anchor: number }
type Find = { mode: 0 | 1 | 2; q: string; r: string; field: 0 | 1 }
type State = Snapshot & {
  request: number; instance: string; seq: number; refresh: number; limit: number; find: Find; findView: string;
  left: number; py: number; view?: string; geo?: string; win: number; winProp: number; seen: number; undo: Snapshot[]; redo: Snapshot[]; drag: boolean; locked: number
  clicks: { t: number; x: number; y: number; n: number } | null; unit: 'char' | 'word' | 'line'; base: [number, number]
  edit: { kind: string; t: number; at: number } | null
}

const SLASHES = ['c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'java', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'go', 'rs', 'swift', 'kt', 'php', 'scala', 'dart']
const HASHES = ['py', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'psd1', 'yml', 'yaml', 'toml', 'rb', 'r', 'pl', 'conf', 'env', 'gitignore', 'dockerfile']
function commentMarks(ext: string): [string, string] {
  if (SLASHES.includes(ext)) return ['//', '']
  if (HASHES.includes(ext)) return ['#', '']
  if (['sql', 'lua', 'hs'].includes(ext)) return ['--', '']
  if (['ini', 'cfg'].includes(ext)) return [';', '']
  if (['css', 'scss'].includes(ext)) return ['/*', '*/']
  if (['html', 'htm', 'xml', 'md', 'svg', 'vue'].includes(ext)) return ['<!--', '-->']
  return ['#', '']
}

const WINDOW = 120, BUDGET = 70000
export const PLAIN = 0, KW = 1, CTL = 2, STR = 3, COM = 4, NUM = 5, TYPE = 6, FN = 7, PROP = 8, HEAD = 9, CODE = 10
const FAINT = '#4b5260', MATCH = '#3a3f4b', FOUND = '#515c6a'
export const COLORS: (string | undefined)[] =[undefined, '#569cd6', '#c586c0', '#ce9178', '#6a9955', '#b5cea8', '#4ec9b0', '#dcdcaa', '#9cdcfe', '#569cd6', '#ce9178']

type Lang = {
  line?: string[]; block?: [string, string][]; quotes?: string; triple?: boolean
  kw?: Set<string>; ctl?: Set<string>; types?: Set<string>
  ci?: boolean; vars?: boolean; fn?: boolean; dash?: boolean; verbNoun?: boolean; hex?: boolean; at?: boolean; keyed?: ':' | '='
}
const words = (list: string) => new Set(list.split(' '))
const CLIKE: Lang = { line: ['//'], block: [['/*', '*/']], quotes: '"\'`', fn: true,
  kw: words('const let var function class interface enum extends implements new this super typeof instanceof in of as import from export default async await static public private protected readonly void null undefined true false delete keyof namespace declare abstract int long short byte char float double bool string struct fn mut impl trait use mod pub func package go defer chan using internal sealed override virtual nil self'),
  ctl: words('if else for while do switch case break continue return throw try catch finally yield match goto select foreach'),
  types: words('number boolean any unknown never symbol bigint Array Promise Record Map Set Date Error String Number Boolean Object') }
const JSONL: Lang = { quotes: '"', keyed: ':', kw: words('true false null') }
const PY: Lang = { line: ['#'], quotes: '"\'', triple: true, fn: true,
  kw: words('def class import from as lambda None True False self cls in is not and or with pass global nonlocal async await del'),
  ctl: words('if elif else for while break continue return raise try except finally yield assert match case') }
const PS1: Lang = { line: ['#'], block: [['<#', '#>']], quotes: '"\'', vars: true, ci: true, dash: true, verbNoun: true,
  kw: words('function param begin process end class using filter workflow in switch'),
  ctl: words('if elseif else foreach for while do until break continue return throw try catch finally exit trap') }
const SH: Lang = { line: ['#'], quotes: '"\'', vars: true,
  kw: words('function export local readonly alias source in do done then fi esac declare'),
  ctl: words('if elif else for while until case return exit break continue') }
const YML: Lang = { line: ['#'], quotes: '"\'', keyed: ':', dash: true, kw: words('true false null yes no on off True False') }
const TOML: Lang = { line: ['#', ';'], quotes: '"\'', keyed: '=', dash: true, kw: words('true false') }
const SQL: Lang = { line: ['--'], block: [['/*', '*/']], quotes: '\'"', ci: true, fn: true,
  kw: words('select from where and or not null insert into values update set delete create table alter drop index join left right inner outer on as group by order having limit distinct union all case when then else end is in like between exists primary key foreign references default int varchar text begin commit rollback') }
const CSS: Lang = { block: [['/*', '*/']], quotes: '"\'', keyed: ':', dash: true, hex: true, at: true, kw: words('important') }
const LANGS = new Map<string, Lang | 'md' | 'html'>()
for (const e of 'js jsx mjs cjs ts tsx cs java go rs c cc cpp h hpp kt swift dart php scala'.split(' ')) LANGS.set(e, CLIKE)
for (const [list, lang] of [['json jsonc', JSONL], ['py', PY], ['ps1 psm1 psd1', PS1], ['sh bash zsh', SH], ['yml yaml', YML], ['toml ini cfg conf env', TOML], ['sql', SQL], ['css scss', CSS],
  ['md markdown', 'md'], ['html htm xml svg vue', 'html']] as const) for (const e of list.split(' ')) LANGS.set(e, lang)
const FENCE_EXT: Record<string, string> = { typescript: 'ts', javascript: 'js', powershell: 'ps1', bash: 'sh', shell: 'sh', python: 'py', yaml: 'yml', csharp: 'cs', rust: 'rs', golang: 'go', 'c++': 'cpp', xml: 'html' }

const IDENT = /[A-Za-z_$][\w$]*/y
const IDENT_DASH = /[A-Za-z_$][\w$-]*/y
const NUMBER = /0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[A-Za-z%]*/y
const VAR = /\$\{?[\w:?]+\}?/y
const HEX = /#[\da-fA-F]{3,8}\b/y

function sticky(re: RegExp, text: string, at: number) {
  re.lastIndex = at
  return re.exec(text)
}

function scan(text: string, cfg: Lang, kinds: Uint8Array, from: number, to: number) {
  const keyRe = cfg.keyed === '=' ? /^[ \t]*=(?!=)/ : /^[ \t]*:(?=\s|$)/
  const strKeyRe = cfg.keyed === '=' ? /^\s*=/ : /^\s*:/
  const ident = cfg.dash ? IDENT_DASH : IDENT
  let i = from
  outer: while (i < to) {
    const c = text[i]!
    for (const [open, close] of cfg.block ?? []) {
      if (!text.startsWith(open, i)) continue
      const end = text.indexOf(close, i + open.length)
      const stop = end < 0 || end + close.length > to ? to : end + close.length
      kinds.fill(COM, i, stop)
      i = stop
      continue outer
    }
    for (const marker of cfg.line ?? []) {
      if (!text.startsWith(marker, i)) continue
      const nl = text.indexOf('\n', i)
      const stop = nl < 0 || nl > to ? to : nl
      kinds.fill(COM, i, stop)
      i = stop
      continue outer
    }
    if (cfg.quotes?.includes(c)) {
      const triple = !!cfg.triple && text.startsWith(c.repeat(3), i)
      const quote = triple ? c.repeat(3) : c
      let j = i + quote.length
      while (j < to) {
        if (text[j] === '\\') { j += 2; continue }
        if (text.startsWith(quote, j)) { j += quote.length; break }
        if (!triple && c !== '`' && text[j] === '\n') break
        j++
      }
      j = Math.min(j, to)
      kinds.fill(cfg.keyed && strKeyRe.test(text.slice(j, j + 40)) ? PROP : STR, i, j)
      i = j
      continue
    }
    const special = c === '$' && cfg.vars ? sticky(VAR, text, i) : c === '#' && cfg.hex ? sticky(HEX, text, i) : null
    if (special) {
      const stop = Math.min(i + special[0].length, to)
      kinds.fill(c === '$' ? PROP : NUM, i, stop)
      i = stop
      continue
    }
    if (c === '@' && cfg.at) {
      const m = sticky(IDENT_DASH, text, i + 1)
      if (m) { const stop = Math.min(i + 1 + m[0].length, to); kinds.fill(KW, i, stop); i = stop; continue }
    }
    if (c >= '0' && c <= '9') {
      const stop = Math.min(i + sticky(NUMBER, text, i)![0].length, to)
      kinds.fill(NUM, i, stop)
      i = stop
      continue
    }
    const m = sticky(ident, text, i)
    if (m) {
      const stop = Math.min(i + m[0].length, to)
      const word = cfg.ci ? m[0].toLowerCase() : m[0]
      const rest = text.slice(stop, stop + 20)
      const kind = cfg.ctl?.has(word) ? CTL : cfg.kw?.has(word) ? KW : cfg.types?.has(word) ? TYPE
        : cfg.keyed && keyRe.test(rest) ? PROP
        : cfg.verbNoun && /^[A-Za-z]+-[A-Za-z]+$/.test(m[0]) ? FN
        : cfg.fn && rest[0] === '(' ? FN
        : cfg.fn && /^[A-Z][a-z]/.test(m[0]) ? TYPE : PLAIN
      if (kind) kinds.fill(kind, i, stop)
      i = stop
      continue
    }
    i++
  }
}

function htmlScan(text: string, kinds: Uint8Array, base: number) {
  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      const stop = end < 0 ? text.length : end + 3
      kinds.fill(COM, base + lt, base + stop)
      i = stop
      continue
    }
    const tag = /^<\/?[A-Za-z][\w:.-]*/.exec(text.slice(lt, lt + 80))
    if (!tag) { i = lt + 1; continue }
    kinds.fill(TYPE, base + lt + (tag[0][1] === '/' ? 2 : 1), base + lt + tag[0].length)
    let j = lt + tag[0].length
    while (j < text.length && text[j] !== '>') {
      const c = text[j]!
      if (c === '"' || c === '\'') {
        const end = text.indexOf(c, j + 1)
        const stop = end < 0 ? text.length : end + 1
        kinds.fill(STR, base + j, base + stop)
        j = stop
        continue
      }
      const attr = /^[A-Za-z_:@][\w:.@-]*/.exec(text.slice(j, j + 60))
      if (attr) { kinds.fill(PROP, base + j, base + j + attr[0].length); j += attr[0].length; continue }
      j++
    }
    i = j + 1
  }
}

function highlightRange(text: string, ext: string, kinds: Uint8Array, from: number, to: number) {
  const lang = LANGS.get(FENCE_EXT[ext.toLowerCase()] ?? ext.toLowerCase())
  if (lang === 'html') htmlScan(text.slice(from, to), kinds, from)
  else if (lang && lang !== 'md') scan(text, lang, kinds, from, to)
}

function markdownScan(text: string, kinds: Uint8Array) {
  let pos = 0
  let fence: { marker: string; lang: string; body: number } | null = null
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const end = nl < 0 ? text.length : nl
    const line = text.slice(pos, end)
    if (fence) {
      if (line.trim().startsWith(fence.marker)) {
        highlightRange(text, fence.lang, kinds, fence.body, pos)
        kinds.fill(COM, pos, end)
        fence = null
      }
    } else {
      const open = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line)
      if (open) {
        fence = { marker: open[1]!, lang: open[2] ?? '', body: Math.min(end + 1, text.length) }
        kinds.fill(COM, pos, end)
      } else if (/^#{1,6}\s/.test(line)) kinds.fill(HEAD, pos, end)
      else if (/^\s*>/.test(line)) kinds.fill(COM, pos, end)
      else {
        const list = /^\s*(?:[-*+]|\d+[.)])\s/.exec(line)
        if (list) kinds.fill(KW, pos, pos + list[0].length - 1)
        for (const m of line.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)) kinds.fill(FN, pos + m.index!, pos + m.index! + m[0].length)
        for (const m of line.matchAll(/`[^`\n]+`/g)) kinds.fill(CODE, pos + m.index!, pos + m.index! + m[0].length)
      }
    }
    if (nl < 0) break
    pos = nl + 1
  }
  if (fence) highlightRange(text, fence.lang, kinds, fence.body, text.length)
}

let memo: { text: string; ext: string; kinds: Uint8Array } | undefined
export function highlight(text: string, ext: string): Uint8Array | undefined {
  const lang = LANGS.get(ext)
  if (!lang) return undefined
  if (memo && memo.text === text && memo.ext === ext) return memo.kinds
  const kinds = new Uint8Array(text.length)
  try {
    if (lang === 'md') markdownScan(text, kinds)
    else highlightRange(text, ext, kinds, 0, text.length)
  } catch { kinds.fill(PLAIN) }
  memo = { text, ext, kinds }
  return kinds
}

// The bracket under or just before `at` and its partner; brackets inside strings and comments do not count.
function matchBracket(text: string, at: number, kinds?: Uint8Array): [number, number] | undefined {
  const skip = (i: number) => kinds !== undefined && (kinds[i] === STR || kinds[i] === COM)
  for (const i of [at, at - 1]) {
    const c = text[i]
    if (i < 0 || !c || skip(i)) continue
    const open = '([{'.indexOf(c)
    const close = ')]}'.indexOf(c)
    if (open < 0 && close < 0) continue
    const dir = open >= 0 ? 1 : -1
    const partner = open >= 0 ? ')]}'[open]! : '([{'[close]!
    let depth = 0
    for (let j = i; j >= 0 && j < text.length; j += dir) {
      if (skip(j)) continue
      if (text[j] === c) depth++
      else if (text[j] === partner && --depth === 0) return [i, j]
    }
  }
  return undefined
}

// Start offsets of every case-insensitive, non-overlapping occurrence of q.
function findAll(text: string, q: string): number[] {
  if (!q) return []
  const hay = text.toLowerCase()
  const needle = q.toLowerCase()
  const folded = hay.length === text.length && needle.length === q.length
  const h = folded ? hay : text
  const n = folded ? needle : q
  const out: number[] = []
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + n.length)) out.push(i)
  return out
}

const kindOf = (c: string) => c === '\n' ? 'n' : /[ \t]/.test(c) ? 's' : /[\p{L}\p{N}_\ud800-\udfff]/u.test(c) ? 'w' : 'p'

function wordRange(text: string, at: number): [number, number] {
  let i = at
  if ((i >= text.length || text[i] === '\n') && i > 0 && text[i - 1] !== '\n') i--
  if (i >= text.length || text[i] === '\n') return [at, at]
  const kind = kindOf(text[i]!)
  let from = i
  let to = i + 1
  while (from > 0 && kindOf(text[from - 1]!) === kind) from--
  while (to < text.length && kindOf(text[to]!) === kind) to++
  return [from, to]
}

const lineStart = (text: string, at: number) => at <= 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1

// One entry per drawn row. `limit` 0 means one row per line; otherwise rows break after the last space, else hard-cut.
type VRow = { start: number; end: number; line: number; first: boolean; last: boolean }
let layoutMemo: { text: string; limit: number; rows: VRow[] } | undefined
export function layout(text: string, limit: number): VRow[] {
  if (layoutMemo && layoutMemo.text === text && layoutMemo.limit === limit) return layoutMemo.rows
  const rows: VRow[] = []
  let start = 0
  for (let line = 0; ; line++) {
    const nl = text.indexOf('\n', start)
    const stop = nl < 0 ? text.length : nl
    for (let at = start; ;) {
      let end = stop
      if (limit && stop - at > limit) {
        const space = text.lastIndexOf(' ', at + limit - 1)
        end = space > at ? space + 1 : at + limit
        if (space <= at && /[\ud800-\udbff]/.test(text[end - 1]!)) end--
      }
      rows.push({ start: at, end, line, first: at === start, last: end === stop })
      if (end === stop) break
      at = end
    }
    if (nl < 0) break
    start = nl + 1
  }
  layoutMemo = { text, limit, rows }
  return rows
}

function lineRange(text: string, at: number): [number, number] {
  const from = lineStart(text, at)
  const newline = text.indexOf('\n', at)
  return [from, newline < 0 ? text.length : newline + 1]
}

// The frame timer outlives each render's closures, so it calls whichever tick the latest render set.
const ticks = new WeakMap<object, () => void>()

const Editor: ClientModule<EditorProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (!surface.state) surface.every(60, () => ticks.get(surface)?.())
  let s: State = surface.state?.request === props.request ? surface.state : { text: props.text, cursor: 0, anchor: 0, request: props.request,
    instance: crypto.randomUUID(), seq: 0, refresh: props.refresh, limit: -1, find: { mode: 0, q: '', r: '', field: 0 }, findView: '',
    left: 0, py: 0, win: props.win, winProp: props.win, seen: 0, undo: [], redo: [], drag: false, locked: 0, clicks: null, unit: 'char', base: [0, 0], edit: null }
  if (surface.state !== s) surface.setState(s)
  if (props.instance === s.instance && props.seq >= s.locked && !props.busy) s.locked = 0
  if (props.refresh !== s.refresh) {
    s.undo.push({ text: s.text, cursor: s.cursor, anchor: s.anchor })
    s.text = props.text
    s.cursor = Math.min(props.cursor, s.text.length)
    s.anchor = s.cursor
    s.refresh = props.refresh
    s.edit = null
  }
  const height = props.rows
  const gutter = Math.max(4, String(s.text.split('\n').length).length + 2)
  const cells = Math.max(8, (surface.columns || 70) - gutter)
  const width = Math.max(8, Math.floor(cells * props.fit))
  const limit = props.wrap ? width - 1 : 0
  const V = () => layout(s.text, limit)
  // Rows are drawn rows, not lines: with wrap off the two are the same.
  const point = (position: number) => {
    const all = V()
    let lo = 0
    let hi = all.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (all[mid]!.start <= position) lo = mid; else hi = mid - 1
    }
    return { row: lo, col: position - all[lo]!.start }
  }
  const offset = (row: number, col: number) => {
    const all = V()
    const r = all[Math.max(0, Math.min(all.length - 1, row))]!
    return r.start + Math.max(0, Math.min(r.end - r.start - (r.last ? 0 : 1), col))
  }
  const redraw = (reveal = true) => {
    if (reveal) {
      const p = point(s.cursor)
      if (limit) s.left = 0
      else if (p.col < s.left) s.left = p.col
      else if (p.col >= s.left + width) s.left = p.col - width + 1
    }
    surface.setState({ ...s })
  }
  const send = (action = 'change') => {
    const seq = ++s.seq
    if (action !== 'change') s.locked = seq
    surface.post({ request: s.request, instance: s.instance, seq, text: s.text, action, rows: props.rows,
      from: Math.min(s.cursor, s.anchor), to: Math.max(s.cursor, s.anchor) })
    redraw()
  }
  const snapshot = (): Snapshot => ({ text: s.text, cursor: s.cursor, anchor: s.anchor })
  // A run of typing, or of deletes, at one caret is a single undo step.
  const replace = (text: string, from = Math.min(s.cursor, s.anchor), to = Math.max(s.cursor, s.anchor), kind = 'other') => {
    text = text.replace(/\r\n?/g, '\n')
    if (s.text.length - (to - from) + text.length > 30000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text)) return false
    const now = Date.now()
    const last = s.edit
    const join = kind !== 'other' && last && last.kind === kind && now - last.t < 800 && last.at === s.cursor && s.cursor === s.anchor
    if (!join) {
      s.undo.push(snapshot())
      if (s.undo.length > 100) s.undo.shift()
    }
    s.redo = []
    s.text = s.text.slice(0, from) + text + s.text.slice(to)
    s.cursor = from + text.length
    s.anchor = s.cursor
    s.edit = { kind, t: now, at: s.cursor }
    send()
    return true
  }
  const mapLines = (fn: (line: string) => string) => {
    const from = Math.min(s.cursor, s.anchor)
    const to = Math.max(s.cursor, s.anchor)
    const bs = lineStart(s.text, from)
    const newline = s.text.indexOf('\n', to > from && s.text[to - 1] === '\n' ? to - 1 : to)
    const be = newline < 0 ? s.text.length : newline
    const block = s.text.slice(bs, be)
    const text = block.split('\n').map(fn).join('\n')
    const ranged = s.cursor !== s.anchor
    const caret = s.cursor
    if (text === block || !replace(text, bs, be)) return
    if (ranged) { s.anchor = bs; s.cursor = bs + text.length } else { s.cursor = s.anchor = Math.max(bs, caret + text.length - block.length) }
    redraw()
  }
  const toggleComment = () => {
    const [open, close] = commentMarks(props.ext)
    const from = Math.min(s.cursor, s.anchor)
    const to = Math.max(s.cursor, s.anchor)
    const first = lineStart(s.text, from)
    const last = s.text.indexOf('\n', to)
    const filled = s.text.slice(first, last < 0 ? s.text.length : last).split('\n').filter(l => l.trim())
    const commented = filled.length > 0 && filled.every(l => l.trimStart().startsWith(open))
    mapLines(line => {
      if (!line.trim()) return line
      const indent = /^[ \t]*/.exec(line)![0]
      const body = line.slice(indent.length)
      if (commented) return indent + body.slice(open.length).replace(/^ /, '').replace(close ? new RegExp(` ?${close.replace(/[*]/g, '\\$&')}$`) : /$^/, '')
      return indent + open + ' ' + body + (close ? ' ' + close : '')
    })
  }
  const move = (next: number, select: boolean) => {
    s.edit = null
    s.cursor = Math.max(0, Math.min(s.text.length, next))
    if (!select) s.anchor = s.cursor
    redraw()
  }
  const previous = (at: number) => at > 1 && /[\udc00-\udfff]/.test(s.text[at - 1]!) ? at - 2 : at - 1
  const following = (at: number) => /[\ud800-\udbff]/.test(s.text[at] ?? '') ? at + 2 : at + 1
  const loose = (c: string | undefined) => c !== undefined && (kindOf(c) === 's' || kindOf(c) === 'p')
  const wordRight = (at: number) => {
    const t = s.text
    if (at >= t.length) return at
    if (t[at] === '\n') return at + 1
    let i = at
    while (loose(t[i])) i++
    if (i >= t.length || t[i] === '\n') return i
    while (i < t.length && kindOf(t[i]!) === 'w') i++
    return i
  }
  const wordLeft = (at: number) => {
    const t = s.text
    if (at <= 0) return 0
    if (t[at - 1] === '\n') return at - 1
    let i = at
    while (loose(t[i - 1])) i--
    if (i === 0 || t[i - 1] === '\n') return i
    while (i > 0 && kindOf(t[i - 1]!) === 'w') i--
    return i
  }
  const step = (dir: 1 | -1, inclusive: boolean) => {
    const all = findAll(s.text, s.find.q)
    if (!all.length) return
    const lo = Math.min(s.cursor, s.anchor)
    const hi = Math.max(s.cursor, s.anchor)
    const at = dir === 1 ? all.find(h => h >= (inclusive ? lo : hi)) ?? all[0]! : [...all].reverse().find(h => h < lo) ?? all[all.length - 1]!
    s.anchor = at
    s.cursor = at + s.find.q.length
    s.edit = null
    redraw()
  }
  const replaceCurrent = () => {
    const lo = Math.min(s.cursor, s.anchor)
    const hi = Math.max(s.cursor, s.anchor)
    if (s.find.q && s.text.slice(lo, hi).toLowerCase() === s.find.q.toLowerCase() && !replace(s.find.r, lo, hi)) return
    step(1, false)
  }
  const replaceAll = () => {
    const all = findAll(s.text, s.find.q)
    if (!all.length) return
    let out = ''
    let last = 0
    for (const h of all) { out += s.text.slice(last, h) + s.find.r; last = h + s.find.q.length }
    if (replace(out + s.text.slice(last), 0, s.text.length)) { s.cursor = s.anchor = all[0]!; redraw() }
  }
  // Escape returns the focus before it reaches a Client, so the bar closes with Ctrl+F or Ctrl+H again.
  const toggleFind = (mode: 1 | 2) => {
    const f = s.find
    const picked = s.text.slice(Math.min(s.cursor, s.anchor), Math.max(s.cursor, s.anchor))
    s.find = f.mode === mode ? { ...f, mode: 0 } : { ...f, mode, field: 0, q: picked && !picked.includes('\n') ? picked : f.q }
    redraw(false)
  }
  const findKey = (e: { key: string; ctrl?: true; shift?: true; meta?: true }, key: string): boolean => {
    const f = s.find
    if (e.ctrl || e.meta) {
      if (key === 'return') { if (!props.busy && !s.locked) replaceAll(); return true }
      return false
    }
    const edited = (patch: Partial<Find>) => { s.find = { ...f, ...patch }; if (patch.q !== undefined) step(1, true); else redraw(false) }
    if (key === 'return') {
      if (e.shift) step(-1, false)
      else if (f.mode === 2 && f.field === 1) { if (!props.busy && !s.locked) replaceCurrent() }
      else step(1, false)
    } else if (key === 'tab') { if (f.mode === 2) edited({ field: f.field ? 0 : 1 }) }
    else if (key === 'backspace') edited(f.field ? { r: f.r.slice(0, -1) } : { q: f.q.slice(0, -1) })
    else if ([...e.key].length === 1) edited(f.field ? { r: f.r + e.key } : { q: f.q + e.key })
    else return false
    return true
  }
  surface.onKey(e => {
    const key = e.key.toLowerCase()
    const p = point(s.cursor)
    const selected = s.cursor !== s.anchor
    if ((e.ctrl || e.meta) && (key === 'f' || key === 'h')) { toggleFind(key === 'f' ? 1 : 2); return }
    if (s.find.mode && findKey(e, key)) return
    if (e.ctrl || e.meta) {
      if (key === 'a') { s.anchor = 0; s.cursor = s.text.length; redraw(); return }
      if (key === 'home') { move(0, !!e.shift); return }
      if (key === 'end') { move(s.text.length, !!e.shift); return }
      if (key === 'left') { move(wordLeft(s.cursor), !!e.shift); return }
      if (key === 'right') { move(wordRight(s.cursor), !!e.shift); return }
      if (key === 'l') { [s.anchor, s.cursor] = lineRange(s.text, s.cursor); s.edit = null; redraw(); return }
      if (props.busy || s.locked) return
      if (key === 'backspace' || key === 'delete') {
        if (selected) replace('')
        else if (key === 'backspace') replace('', wordLeft(s.cursor), s.cursor)
        else replace('', s.cursor, wordRight(s.cursor))
        return
      }
      if (key === 'd') {
        const from = Math.min(s.cursor, s.anchor)
        const to = Math.max(s.cursor, s.anchor)
        const start = lineStart(s.text, from)
        const newline = s.text.indexOf('\n', to > from && s.text[to - 1] === '\n' ? to - 1 : to)
        const stop = newline < 0 ? s.text.length : newline
        const block = s.text.slice(start, stop)
        const caret = s.cursor + block.length + 1
        if (replace('\n' + block, stop, stop)) { s.cursor = s.anchor = caret; redraw() }
        return
      }
      if (key === 'k') {
        const [start] = lineRange(s.text, Math.min(s.cursor, s.anchor))
        const [, end] = lineRange(s.text, Math.max(s.cursor, s.anchor))
        const last = end >= s.text.length && s.text[end - 1] !== '\n'
        replace('', last && start > 0 ? start - 1 : start, end)
        return
      }
      if (key === '/' || key === '_') { toggleComment(); return }
      if (key === 's') { send('save'); return }
      if (key === 'c' || key === 'x') { if (selected) send(key === 'c' ? 'copy' : 'cut'); return }
      if (key === 'v') { send('paste'); return }
      if (key === 'z' || key === 'y') {
        const redo = key === 'y' || !!e.shift
        const next = (redo ? s.redo : s.undo).pop()
        if (next) {
          (redo ? s.undo : s.redo).push(snapshot())
          Object.assign(s, next)
          s.edit = null
          send()
        }
        return
      }
      return
    }
    if (key === 'left') { move(selected && !e.shift ? Math.min(s.cursor, s.anchor) : previous(s.cursor), !!e.shift); return }
    if (key === 'right') { move(selected && !e.shift ? Math.max(s.cursor, s.anchor) : following(s.cursor), !!e.shift); return }
    if (key === 'up' || key === 'down' || key === 'pageup' || key === 'pagedown') {
      const delta = key === 'up' ? -1 : key === 'down' ? 1 : key === 'pageup' ? -height : height
      move(offset(p.row + delta, p.col), !!e.shift); return
    }
    if (key === 'home' || key === 'end') {
      const r = V()[p.row]!
      const indent = r.first ? /^[ \t]*/.exec(s.text.slice(r.start, r.end))![0].length : 0
      move(offset(p.row, key === 'end' ? Infinity : p.col === indent ? 0 : indent), !!e.shift); return
    }
    if (props.busy || s.locked) return
    if (key === 'return') {
      const from = Math.min(s.cursor, s.anchor)
      const before = s.text.slice(lineStart(s.text, from), from)
      replace('\n' + /^[ \t]*/.exec(before)![0] + (/[{(\[]\s*$/.test(before) ? '  ' : ''))
    }
    else if (key === 'tab') {
      if (e.shift) mapLines(line => line.replace(/^(?: {1,2}|\t)/, ''))
      else if (selected) mapLines(line => line ? '  ' + line : line)
      else replace('  ', undefined, undefined, 'type')
    }
    else if (key === 'backspace') {
      if (selected) replace('')
      else if (s.cursor > 0) replace('', previous(s.cursor), s.cursor, 'delete')
    } else if (key === 'delete') {
      if (selected) replace('')
      else if (s.cursor < s.text.length) replace('', s.cursor, following(s.cursor), 'delete')
    } else if ([...e.key].length === 1 || e.key.includes('\n')) replace(e.key, undefined, undefined, e.key === '\n' ? 'other' : 'type')
  })
  // Past the visible rows the caret keeps stepping toward the pointer, faster the further out it is.
  ticks.set(surface, () => {
    const bottom = props.top + props.span - 1
    const gap = s.py > bottom ? s.py - bottom : s.py < props.top ? s.py - props.top : 0
    if (!s.drag || !gap) return
    const p = point(s.cursor)
    move(offset(p.row + Math.sign(gap) * Math.min(8, 1 + (Math.abs(gap) >> 2)), p.col), true)
  })
  const span = (at: number): [number, number] => s.unit === 'word' ? wordRange(s.text, at) : s.unit === 'line' ? lineRange(s.text, at) : [at, at]
  // The pointer column counts cells; the desktop draws props.fit characters per cell. The caret goes before the character under the cell centre.
  const place = (e: { x: number; y: number }) => offset(e.y, s.left + Math.max(0, Math.round((e.x - gutter + 0.5) * props.fit - 0.5)))
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') {
      const at = place(e)
      const now = Date.now()
      const last = s.clicks
      const n = last && now - last.t < 400 && last.y === e.y && Math.abs(last.x - e.x) <= 1 ? Math.min(3, last.n + 1) : 1
      s.clicks = { t: now, x: e.x, y: e.y, n }
      s.edit = null
      s.unit = n === 3 ? 'line' : n === 2 ? 'word' : 'char'
      if (s.unit === 'char') {
        s.cursor = at
        if (!e.shift) s.anchor = s.cursor
      } else {
        s.base = span(at)
        s.anchor = s.base[0]
        s.cursor = s.base[1]
      }
      s.drag = true
      s.py = e.y
      redraw()
    } else if (e.type === 'move' && s.drag && e.button === 'left') {
      s.py = e.y
      const at = place({ x: e.x, y: Math.max(props.top, Math.min(props.top + props.span - 1, e.y)) })
      if (s.unit === 'char') s.cursor = at
      else {
        const [from, to] = span(at)
        if (at >= s.base[0]) { s.anchor = s.base[0]; s.cursor = to } else { s.anchor = s.base[1]; s.cursor = from }
      }
      redraw()
    } else if (e.type === 'up' || e.type === 'leave') s.drag = false
  })
  const vrows = V()
  const start = Math.min(s.cursor, s.anchor)
  const end = Math.max(s.cursor, s.anchor)
  const caret = point(s.cursor)
  const caretLine = vrows[caret.row]!.line
  const logicalCol = s.cursor - lineStart(s.text, s.cursor)
  const kinds = highlight(s.text, props.ext)
  const total = vrows.length
  const view = `${caret.row}:${caretLine}:${logicalCol}:${s.cursor}:${s.anchor}:${total}`
  if (s.view !== view) {
    s.view = view
    surface.post({ view: { request: s.request, row: caret.row, line: caretLine, col: logicalCol, selected: end - start, total, cursor: s.cursor, anchor: s.anchor } })
  }
  if (s.limit !== limit) { s.limit = limit; s.seen = -1 }
  if (props.win !== s.winProp) { s.winProp = props.win; s.win = props.win }
  if (s.cursor !== s.seen && (caret.row < s.win + 2 || caret.row >= s.win + WINDOW - 2)) s.win = caret.row - WINDOW / 2
  s.seen = s.cursor
  s.win = Math.max(0, Math.min(total - WINDOW, Math.floor(s.win)))
  const pair = start === end ? matchBracket(s.text, s.cursor, kinds) : undefined
  const hits = s.find.mode ? findAll(s.text, s.find.q) : []
  const mask = hits.length ? new Uint8Array(s.text.length) : undefined
  for (const h of hits) mask!.fill(1, h, h + s.find.q.length)
  const shown = s.find.q.slice(0, 40)
  const index = end - start === s.find.q.length ? hits.indexOf(start) : -1
  const count = !s.find.q ? 'type to search' : hits.length ? `${index >= 0 ? index + 1 : '–'}/${hits.length}` : 'no results'
  const status = !s.find.mode ? ''
    : s.find.mode === 1 ? `Find: ${shown}▏ · ${count} · Enter next · Shift+Enter prev · Ctrl+F close`
    : `Find: ${shown}${s.find.field ? '' : '▏'} → Replace: ${s.find.r.slice(0, 40)}${s.find.field ? '▏' : ''} · ${count} · Tab field · Enter replace · Ctrl+Enter all · Ctrl+H close`
  if (s.findView !== status) {
    s.findView = status
    surface.post({ find: { request: s.request, text: status } })
  }
  let size = 0
  const draw = (row: number) => {
      const r = vrows[row]!
      const line = s.text.slice(r.start, r.end)
      const at = r.start
      const visible = [...line.slice(s.left, s.left + cells * 2)]
      let column = s.left
      const lead = r.first ? / */.exec(line)![0].length : 0
      const trail = r.last ? / *$/.exec(line)![0].length : 0
      const spans: { text: string; cursor: boolean; selected: boolean; kind: number; tone: number; match: boolean; found: boolean }[] = []
      for (const char of visible) {
        const offset = at + column
        const cursor = s.cursor === offset && row === caret.row
        const selected = offset >= start && offset < end
        const kind = kinds?.[offset] ?? PLAIN
        const match = !!pair && (offset === pair[0] || offset === pair[1])
        const found = mask?.[offset] === 1
        const faint = char === '\t' || (char === ' ' && trail > 0 && column >= line.length - trail)
        const guide = char === ' ' && lead < line.length && column % 2 === 0 && column + 2 <= lead
        const tone = faint ? 2 : guide ? 1 : 0
        column += char.length
        const text = char === '\t' ? '→' : faint ? '·' : guide ? '│' : char
        const last = spans[spans.length - 1]
        if (last && last.cursor === cursor && last.selected === selected && last.kind === kind && last.tone === tone && last.match === match && last.found === found) last.text += text
        else spans.push({ text, cursor, selected, kind, tone, match, found })
      }
      if (props.mono) {
        // The pane draws this row's text, caret and selection as SVG under the Client; here only find and bracket marks.
        const marks: { left: number; width: number; color: string }[] = []
        let x = 0
        for (const span of spans) {
          const n = [...span.text].length
          const color = span.found ? '#515c6aaa' : span.match ? '#3a3f4baa' : ''
          const last = marks[marks.length - 1]
          if (color && last?.color === color && last.left + last.width === x) last.width += n
          else if (color) marks.push({ left: x, width: n, color })
          x += n
        }
        size += 200 + marks.length * 120
        return <Box key={`line:${row}`} flexShrink={0} height={1} overflow="hidden" flexDirection="row">
          <Box width={gutter} flexShrink={0}><Text dimColor>{r.first ? `${String(r.line + 1).padStart(gutter - 1)} ` : ' '.repeat(gutter)}</Text></Box>
          <Box key={`code:${row}`} flexGrow={1} height={1} overflow="hidden" position="relative">
            {marks.map((m, n) => <Box key={`mark:${n}`} position="absolute" top={0} left={m.left} width={m.width} height={1} backgroundColor={m.color} />)}
          </Box>
        </Box>
      }
      size += 260 + spans.reduce((n, span) => n + span.text.length + 80, 0)
      return <Box key={`line:${row}`} flexShrink={0} height={1} overflow="hidden" flexDirection="row" backgroundColor={r.line === caretLine ? '#151b23' : undefined}>
        <Box width={gutter}><Text dimColor>{r.first ? `${String(r.line + 1).padStart(gutter - 1)} ` : ' '.repeat(gutter)}</Text></Box>
        <Text wrap="truncate-end">{spans.map((span, n) => <Text key={`span:${n}`} inverse={span.cursor} color={span.tone ? FAINT : COLORS[span.kind]} bold={span.kind === HEAD || span.match} backgroundColor={span.selected ? '#264f78' : span.found ? FOUND : span.match ? MATCH : undefined}>{span.text}</Text>)}{caret.row === row && caret.col === line.length ? <Text inverse> </Text> : ''}</Text>
      </Box>
  }
  const rows: unknown[] = []
  let to = s.win
  while (to < Math.min(total, s.win + WINDOW) && size < BUDGET) rows.push(draw(to++))
  const geo = `${surface.columns}:${s.left}:${limit}`
  if (props.mono && s.geo !== geo) { s.geo = geo; surface.post({ geo: { request: s.request, columns: surface.columns || 70, left: s.left, limit } }) }
  // A see-through root still takes the pointer only with a background.
  return <Box flexDirection="column" position="relative" backgroundColor={props.mono ? '#00000001' : undefined}>
    {s.win > 0 ? <Box key="pad-top" height={s.win} flexShrink={0} /> : ''}
    {rows}
    {to < total ? <Box key="pad-bottom" height={total - to} flexShrink={0} /> : ''}
  </Box>
}

export default Editor
