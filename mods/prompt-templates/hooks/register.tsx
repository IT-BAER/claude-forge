import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Action, Editor, Template, View } from '../types'
import { COLORS, HEAD, highlight, layout } from './editor'
import type { EditorProps } from './editor'
import { exportJson, filterTemplates, findByName, mergeImport, parseImport, parseTags, parseVars, renderTemplate, tagsOf, validateTemplate } from './templates'

const PANE = 'prompt-templates'
const TITLE = 'Prompts'
const KEY = 'templates'
const VARS_KEY = 'lastVars'
// $.store rejects past 4 MiB in all; the margin leaves room for lastVars.
const STORE_LIMIT = 4 * 1024 * 1024 - 256 * 1024
const ACTIONS: Action[] = ['fill', 'insert', 'send', 'copy']
const LABEL: Record<Action, string> = { fill: 'Fill', insert: 'Insert', send: 'Send', copy: 'Copy' }
const DONE: Record<Action, string> = { fill: 'Filled', insert: 'Inserted', send: 'Sent', copy: 'Copied' }
const CONTROL = /[\x00-\x1f\x7f-\x9f]/
const EMPTY: View = { mode: 'list', query: '', tag: '', selected: '', vars: {}, ioPath: '', notice: '', error: '', tick: 0 }
const view = atom({ plugin: 'prompt-templates', key: 'view' } as const, EMPTY)
let paneOpen = false

const clean = (error: unknown) => String((error as Error)?.message ?? error).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 300)
const current = async ($: any): Promise<View> => ({ ...EMPTY, ...(await read($, view)) })
const setView = ($: any, patch: Partial<View> | ((v: View) => Partial<View>)) =>
  update($, view, (cur: View) => { const v = { ...EMPTY, ...cur }; return { ...v, ...(typeof patch === 'function' ? patch(v) : patch) } })
const isTemplate = (t: any): t is Template =>
  !!t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.body === 'string' && Array.isArray(t.tags)
const firstLine = (body: string) => body.split('\n').find(l => l.trim())?.trim().slice(0, 200) ?? ''

async function loadAll($: any): Promise<Template[]> {
  const value = await $.store.get(KEY)
  return Array.isArray(value) ? value.filter(isTemplate) : []
}

// Read-modify-write on the store, so a save from another session is not overwritten by a stale copy.
async function mutate($: any, fn: (list: Template[]) => Template[]) {
  const next = fn(await loadAll($))
  if (JSON.stringify(next).length > STORE_LIMIT) throw new Error('The template library would exceed the 4 MiB store limit.')
  await $.store.set(KEY, next)
  await setView($, v => ({ tick: v.tick + 1 }))
}

async function openPane($: any) {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  paneOpen = true
  if (!opened.isPlaced) $.ui.toast(`Prompts pane not drawn: ${opened.reason}`)
}

async function closePane($: any) {
  if (!(await leaveEditor($))) return false
  await $.ui.close({ id: PANE })
  paneOpen = false
  return true
}

async function runAction($: any, t: Template, action: Action, values: Record<string, string>, surface?: string) {
  const text = renderTemplate(t.body, values)
  try {
    if (action === 'copy') {
      const copied = await $.ui.copy(surface ? { text, surface } : { text })
      if (!copied.isCopied) throw new Error(`Copy failed (${copied.reason}).`)
    } else if (action === 'send') {
      await $.prompt.submit({ text })
    } else {
      const filled = await $.prompt.fill({ text, mode: action === 'insert' ? 'insert' : 'replace' })
      if (!filled.isFilled) throw new Error(`The prompt box is not available (${filled.refusal ?? 'unknown'}).`)
    }
    await setView($, { mode: 'list', selected: '', action: undefined, notice: `${DONE[action]} "${t.name}".`, error: '' })
    return true
  } catch (error) {
    await setView($, { notice: '', error: clean(error) })
    return false
  }
}

async function start($: any, id: string, action: Action, surface?: string) {
  const t = (await loadAll($)).find(x => x.id === id)
  if (!t) return setView($, { mode: 'list', selected: '', error: 'This template no longer exists.' })
  const names = parseVars(t.body)
  if (!names.length) return runAction($, t, action, {}, surface)
  const last = await $.store.get(VARS_KEY) as Record<string, unknown> | undefined
  const vars = Object.fromEntries(names.map(n => [n, typeof last?.[n] === 'string' ? last[n] as string : '']))
  await setView($, { mode: 'vars', selected: t.id, action, vars, notice: '', error: '' })
}

async function runVars($: any, action: Action, surface?: string) {
  const v = await current($)
  const t = (await loadAll($)).find(x => x.id === v.selected)
  if (!t) return setView($, { mode: 'list', selected: '', error: 'This template no longer exists.' })
  const last = await $.store.get(VARS_KEY)
  const merged = { ...(last && typeof last === 'object' && !Array.isArray(last) ? last : {}), ...v.vars }
  const kept = Object.entries(merged).filter(([, x]) => typeof x === 'string' && x.length <= 2000).slice(-200)
  await $.store.set(VARS_KEY, Object.fromEntries(kept))
  await runAction($, t, action, v.vars, surface)
}

async function home($: any) {
  const dir = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

async function resolvePath($: any, raw: string) {
  let path = raw.trim().replace(/^["']|["']$/g, '')
  if (/^~[\\/]/.test(path)) path = (await home($)) + path.slice(1)
  if (!path || CONTROL.test(path) || !/\.json$/i.test(path)) throw new Error('The path must name a .json file.')
  return path
}

async function exportAll($: any) {
  try {
    const path = await resolvePath($, (await current($)).ioPath)
    const list = await loadAll($)
    await $.fs.write(path, exportJson(list))
    await setView($, { notice: `Exported ${list.length} templates to ${path}.`, error: '' })
  } catch (error) {
    await setView($, { notice: '', error: `Export failed: ${clean(error)}` })
  }
}

async function importFile($: any, mode: 'replace' | 'skip') {
  try {
    const path = await resolvePath($, (await current($)).ioPath)
    let text: string
    try { text = await $.fs.read(path) } catch (error) { throw new Error(`The file could not be read: ${clean(error)}`) }
    const parsed = parseImport(text)
    if ('error' in parsed) throw new Error(parsed.error)
    let counts = { added: 0, replaced: 0, skipped: 0 }
    await mutate($, list => {
      const merged = mergeImport(list, parsed.templates, mode, Date.now(), () => crypto.randomUUID())
      counts = merged
      return merged.list
    })
    await setView($, { notice: `Imported: ${counts.added} added, ${counts.replaced} replaced, ${counts.skipped} skipped.`, error: '' })
  } catch (error) {
    await setView($, { notice: '', error: `Import failed: ${clean(error)}` })
  }
}

async function openIo($: any) {
  const v = await current($)
  const ioPath = v.ioPath || `${await home($)}/prompt-templates.json`
  await setView($, { mode: 'io', ioPath, notice: '', error: '' })
}

async function deleteTemplate($: any, id: string) {
  try {
    await mutate($, list => list.filter(t => t.id !== id))
    await setView($, { mode: 'list', selected: '', notice: 'Template deleted.', error: '' })
  } catch (error) {
    await setView($, { error: clean(error) })
  }
}

// The body editor is file-explorer's Client editor (editor.tsx, kept identical); the code below is its pane wiring.
const EDITOR_KEY = 'body-editor'
const EDITOR_MODULE = 'hooks/editor.tsx'
const EDITOR_WINDOW = 120
// Desktop geometry measured for file-explorer: CSS px per pointer cell and per row, code font size, baseline, characters per cell.
const G = { cellW: 7.92, cellPx: 19.2, codeFont: 13, codeBase: 0.74, textFit: 4 / 3, mono: true }
const editorGeo = new Map<number, { columns: number; left: number; limit: number }>()
const paneView = { offset: 0, body: 35, content: 0, fit: 1, mono: false }
let editRequest = Date.now()
let findShown = false

const isDirty = (p: Editor) => p.draft !== p.saved || p.name !== p.savedName || p.tags !== p.savedTags

function editorFor(p: Editor, rows: number): EditorProps {
  const total = p.editorTotal ?? p.draft.split('\n').length
  const top = Math.max(0, paneView.offset - Math.max(0, paneView.content - total - 2))
  return { request: p.request, text: p.draft, instance: p.editorInstance ?? '', seq: p.editorSeq ?? 0, refresh: p.editorRefresh ?? 0,
    cursor: p.editorCursor ?? 0, busy: !!p.busy, rows, fit: paneView.fit, top, span: Math.max(8, paneView.body), win: p.editorWin ?? 0,
    wrap: p.editorWrap ?? true, ext: 'md', mono: paneView.mono }
}

// Applies fn to the open editor when it is still the one for `request`; resolves whether it did.
async function updateEdit($: any, request: number, fn: (p: Editor) => Editor | undefined, extra: Partial<View> = {}) {
  let applied = false
  await update($, view, (cur: View) => {
    applied = false
    const v = { ...EMPTY, ...cur }
    const next = v.edit && v.edit.request === request ? fn(v.edit) : undefined
    if (!next) return v
    applied = true
    return { ...v, ...extra, edit: next }
  })
  return applied
}

async function openEditor($: any, id?: string) {
  const t = id ? (await loadAll($)).find(x => x.id === id) : undefined
  if (id && !t) return setView($, { error: 'This template no longer exists.' })
  const tags = t ? t.tags.join(', ') : ''
  const edit: Editor = { ...(t ? { id: t.id } : {}), name: t?.name ?? '', tags, savedName: t?.name ?? '', savedTags: tags,
    draft: t?.body ?? '', saved: t?.body ?? '', request: ++editRequest, editorWrap: true }
  await setView($, { mode: 'edit', edit, selected: '', notice: '', error: '' })
}

// Leaves the editor unless it holds unsaved changes; then it asks first. Resolves whether it left.
async function leaveEditor($: any, discard = false) {
  let left = false
  await update($, view, (cur: View) => {
    const v = { ...EMPTY, ...cur }
    left = false
    const p = v.edit
    if (v.mode !== 'edit' || !p) { left = true; return v }
    if (p.busy) return v
    if (isDirty(p) && !discard) return { ...v, edit: { ...p, confirmBack: true } }
    left = true
    const { edit: _, ...rest } = v
    return { ...rest, mode: 'list' as const, notice: '', error: '' }
  })
  if (left && findShown) { findShown = false; $.ui.status(undefined) }
  return left
}

async function saveEdit($: any, request: number, close: boolean) {
  const p = (await current($)).edit
  if (!p || p.request !== request || p.busy) return false
  const draft = { name: p.name.trim(), tags: parseTags(p.tags), body: p.draft }
  const invalid = validateTemplate(draft)
  if (invalid) { await setView($, { error: invalid, notice: '' }); return false }
  const id = p.id ?? crypto.randomUUID()
  await updateEdit($, request, cur => ({ ...cur, busy: true }))
  try {
    await mutate($, list => {
      if (list.some(t => t.id !== id && t.name.toLowerCase() === draft.name.toLowerCase())) throw new Error(`A template named "${draft.name}" already exists.`)
      const t: Template = { id, ...draft, updatedAt: Date.now() }
      return list.some(x => x.id === id) ? list.map(x => (x.id === id ? t : x)) : [...list, t]
    })
  } catch (error) {
    await updateEdit($, request, cur => ({ ...cur, busy: false }), { error: clean(error), notice: '' })
    return false
  }
  const tags = draft.tags.join(', ')
  await updateEdit($, request, cur => ({ ...cur, id, busy: false, confirmBack: false, saved: p.draft, savedName: p.name, savedTags: p.tags,
    ...(cur.tags === p.tags ? { tags, savedTags: tags } : {}) }), { notice: `Saved "${draft.name}".`, error: '' })
  if (close && (await leaveEditor($))) await setView($, { notice: `Saved "${draft.name}".` })
  return true
}

async function editorMessage($: any, e: any) {
  const data = e.data
  if (data?.geo) {
    const g = data.geo
    if ([g.request, g.columns, g.left, g.limit].every(Number.isSafeInteger) && g.columns >= 8 && g.columns <= 1000 && g.left >= 0 && g.limit >= 0) {
      const prior = editorGeo.get(g.request)
      if (!prior || prior.columns !== g.columns || prior.left !== g.left || prior.limit !== g.limit) { editorGeo.set(g.request, g); $.ui.invalidate('ui.render') }
    }
    return {}
  }
  if (data?.view) {
    const w = data.view
    if (![w.request, w.row, w.line, w.col, w.selected, w.total].every(Number.isSafeInteger) || w.row < 0 || w.line < 0 || w.col < 0 || w.selected < 0 || w.total < 1) return {}
    await updateEdit($, w.request, p => ({ ...p, editorRow: w.row, editorLine: w.line, editorCol: w.col, editorSelected: w.selected, editorTotal: w.total,
      ...(Number.isSafeInteger(w.cursor) && Number.isSafeInteger(w.anchor) && w.cursor >= 0 && w.anchor >= 0 ? { editorCaret: w.cursor, editorAnchor: w.anchor } : {}) }))
    $.clock.after(80, () => $.ui.scroll({ to: { key: 'editor-caret' }, in: PANE }).catch(() => {}))
    return {}
  }
  if (data?.find) {
    const f = data.find
    if (!Number.isSafeInteger(f.request) || typeof f.text !== 'string' || f.text.length > 400) return {}
    if (f.request !== (await current($)).edit?.request) return {}
    findShown = !!f.text
    $.ui.status(f.text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ') || undefined)
    return {}
  }
  if (!data || typeof data.instance !== 'string' || !data.instance || data.instance.length > 100 || !Number.isSafeInteger(data.seq) || data.seq <= 0 || !Number.isSafeInteger(data.request)) return {}
  if (!Number.isSafeInteger(data.rows) || data.rows < 8 || data.rows > 40) return {}
  if (typeof data.text !== 'string' || data.text.length > 30000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(data.text)) return {}
  if (!['change', 'save', 'copy', 'cut', 'paste'].includes(data.action)) return {}
  if (!Number.isSafeInteger(data.from) || !Number.isSafeInteger(data.to) || data.from < 0 || data.to < data.from || data.to > data.text.length) return {}
  const accepted = await updateEdit($, data.request, p => (p.editorInstance === data.instance && data.seq <= (p.editorSeq ?? 0)) ? undefined
    : { ...p, draft: data.text, editorInstance: data.instance, editorSeq: data.seq, editorCursor: data.to, confirmBack: false })
  if (!accepted) return {}
  if (data.action === 'save') await saveEdit($, data.request, false)
  else if (data.action !== 'change') {
    await updateEdit($, data.request, p => ({ ...p, busy: true }))
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
      let changed = true
      await updateEdit($, data.request, p => {
        changed = p.editorSeq === data.seq && p.editorInstance === data.instance
        return changed ? { ...p, draft: text, busy: false, editorRefresh: (p.editorRefresh ?? 0) + (data.action === 'copy' ? 0 : 1), editorCursor: data.from + inserted.length }
          : { ...p, busy: false }
      }, {})
      if (!changed) await setView($, { error: 'The text changed during the clipboard operation. Try again.' })
    } catch (error) {
      await updateEdit($, data.request, p => ({ ...p, busy: false }), { error: clean(error) })
    }
  }
  const p = (await current($)).edit
  return p && p.request === data.request ? { props: editorFor(p, data.rows) } : {}
}

const xmlText = (value: string) => value.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')
// One editor row as an SVG: every character sits at its own cell, so pointer cell N is character N whatever the font.
function rowSvg(text: string, kinds: Uint8Array | undefined, from: number, left: number, cells: number, sel?: [number, number], caret?: number): string {
  const w = cells * G.cellW
  const h = G.cellPx
  const runs: string[] = []
  if (sel && sel[1] > from + left && sel[0] < text.length + 1) {
    const a = Math.max(0, sel[0] - from - left), b = Math.min(cells, sel[1] - from - left)
    if (b > a) runs.push(`<rect x="${+(a * G.cellW).toFixed(2)}" y="0" width="${+((b - a) * G.cellW).toFixed(2)}" height="${h}" fill="#264f78"/>`)
  }
  let x: number[] = []
  let chars = ''
  let color = ''
  let bold = false
  const flush = () => {
    if (chars) runs.push(`<text x="${x.map(v => +v.toFixed(2)).join(' ')}" fill="${color}"${bold ? ' font-weight="700"' : ''}>${xmlText(chars)}</text>`)
    x = []; chars = ''
  }
  const line = text.slice(from + left, from + left + cells)
  for (let i = 0; i < line.length; i++) {
    const c = line[i] === '\t' ? ' ' : line[i]!
    if (c === ' ') continue
    const kind = kinds?.[from + left + i] ?? 0
    const nextColor = COLORS[kind] ?? '#d4d4d4'
    const nextBold = kind === HEAD
    if (nextColor !== color || nextBold !== bold) { flush(); color = nextColor; bold = nextBold }
    x.push(i * G.cellW)
    chars += c
  }
  flush()
  if (caret !== undefined && caret >= from + left && caret - from - left <= cells) runs.push(`<rect x="${+((caret - from - left) * G.cellW).toFixed(2)}" y="1" width="1.6" height="${h - 2}" fill="#aeafad"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g font-family="Cascadia Mono,Consolas,ui-monospace,monospace" font-size="${G.codeFont}">${runs.join('').replace(/<text /g, `<text y="${(h * G.codeBase).toFixed(2)}" `)}</g></svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prompts', description: 'Toggle the prompt templates pane; /prompts <name> fills that template', argumentHint: '[name]' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if ((e as any).id === PANE || (e as any).requestId === PANE) {
      const p = (await current($)).edit
      if (e.origin.kind !== 'unload' && p && (isDirty(p) || p.busy)) { await leaveEditor($); return { value: undefined } }
      paneOpen = false
      if (findShown) { findShown = false; $.ui.status(undefined) }
    }
    return next(e)
  })

  on('command.run', { command: 'prompts' }, async ($, e) => {
    const arg = (e.args ?? '').trim().replace(/^["']|["']$/g, '')
    const busy = 'Save or discard the template draft in the Prompts pane first.'
    if (!arg) {
      if (paneOpen) return { text: (await closePane($)) ? 'Prompts pane closed.' : busy }
      await openPane($)
      return { text: 'Prompts pane opened.' }
    }
    if (!(await leaveEditor($))) { await openPane($); return { text: busy } }
    const t = findByName(await loadAll($), arg)
    if (!t) {
      await setView($, { mode: 'list', query: arg, tag: '', notice: '', error: '' })
      await openPane($)
      return { text: `No template matches "${arg}". The Prompts pane shows the search.` }
    }
    if (parseVars(t.body).length) {
      await start($, t.id, 'fill')
      await openPane($)
      return { text: `"${t.name}" has variables. Fill them in the Prompts pane.` }
    }
    return { text: (await runAction($, t, 'fill', {})) ? `Filled "${t.name}" into the prompt box.` : `Could not fill "${t.name}".` }
  })

  // The pane scrolls the editor natively; the editor draws only a window of lines, centred on the scroll position.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    paneView.offset = e.offset; paneView.body = e.bodyRows; paneView.content = e.contentRows
    const p = (await current($)).edit
    if (p) {
      const total = p.editorTotal ?? p.draft.split('\n').length
      const first = Math.max(0, e.offset - Math.max(0, e.contentRows - total - 2))
      const win = Math.max(0, Math.min(total - EDITOR_WINDOW, first - Math.floor((EDITOR_WINDOW - e.bodyRows) / 2)))
      if (Math.abs(win - (p.editorWin ?? 0)) > 15) updateEdit($, p.request, cur => ({ ...cur, editorWin: win })).catch(() => {})
    }
    return next(e)
  })

  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.element === EDITOR_KEY && e.module === EDITOR_MODULE) return editorMessage($, e)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'desktop' && e.surface !== 'terminal') return $.ui.resolve(e).Text({ children: 'The Prompts pane is available in Claude Desktop and the terminal.' })
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Input, Client } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    try {
      const v = await current($)
      const all = await loadAll($)
      paneView.offset = e.props.scroll.offset; paneView.body = e.props.scroll.bodyRows
      paneView.mono = e.surface === 'desktop' && G.mono; paneView.fit = e.surface === 'desktop' && !paneView.mono ? G.textFit : 1
      const messages = <Box flexDirection="column">
        {v.error ? <Text color="red" wrap="wrap">{v.error}</Text> : null}
        {v.notice ? <Text dimColor wrap="wrap">{v.notice}</Text> : null}
      </Box>

      if (v.mode === 'edit' && v.edit) {
        const p = v.edit
        const request = p.request
        const props = editorFor(p, Math.max(8, Math.min(40, e.props.scroll.bodyRows - 12)))
        const names = parseVars(p.draft)
        const client = <Client key={EDITOR_KEY} module="./editor.tsx" width="100%" props={props} />
        const geo = props.mono && Svg ? editorGeo.get(request) : undefined
        let body
        if (!geo) {
          body = <Box flexDirection="column" position="relative">
            <Box key="editor-caret" position="absolute" top={p.editorRow ?? 0} height={1} width={1} />
            {client}
          </Box>
        } else {
          // Monospace mode: the text is SVG rows here, the Client lies on top for keys, pointer, caret and highlights.
          const text = props.text
          const gutter = Math.max(4, String(text.split('\n').length).length + 2)
          const cells = Math.max(8, geo.columns - gutter)
          const vrows = layout(text, geo.limit)
          const from = Math.max(0, props.top - 20)
          const to = Math.min(vrows.length, props.top + props.span + 20)
          const caretLine = vrows[Math.min(vrows.length - 1, p.editorRow ?? 0)]?.line
          const kinds = highlight(text, props.ext)
          const sel: [number, number] | undefined = p.editorCaret !== undefined && p.editorAnchor !== undefined && p.editorCaret !== p.editorAnchor
            ? [Math.min(p.editorCaret, p.editorAnchor), Math.max(p.editorCaret, p.editorAnchor)] : undefined
          body = <Box flexDirection="column" position="relative" height={vrows.length}>
            {from > 0 && <Box key="code-top" height={from} flexShrink={0} />}
            {vrows.slice(from, to).map((r, i) => {
              const end = text[r.end - 1] === '\n' ? r.end - 1 : r.end
              return <Box key={`code-row:${from + i}`} height={1} flexShrink={0} overflow="hidden" flexDirection="row" backgroundColor={r.line === caretLine ? '#151b23' : undefined}>
                <Box width={gutter} flexShrink={0} />
                <Box flexGrow={1} height={1} overflow="hidden">{Svg && (text.slice(r.start, end).trim() || from + i === p.editorRow || sel) ? <Svg source={rowSvg(text.slice(0, end), kinds, r.start, geo.left, cells, sel, from + i === p.editorRow ? p.editorCaret : undefined)} alt="editor row" width={Math.round(cells * G.cellW)} height={G.cellPx} /> : null}</Box>
              </Box>
            })}
            <Box key="editor-caret" position="absolute" top={p.editorRow ?? 0} height={1} width={1} />
            <Box position="absolute" top={0} left={0} width="100%" height={vrows.length}>{client}</Box>
          </Box>
        }
        const field = (patch: Partial<Editor>) => updateEdit($, request, cur => ({ ...cur, ...patch, confirmBack: false }))
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>{`${p.id ? 'Edit template' : 'New template'}${isDirty(p) ? ' • Unsaved' : ''}`}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key="edit-wrap" label={props.wrap ? 'Wrap: on' : 'Wrap: off'} onPress={() => updateEdit($, request, cur => ({ ...cur, editorWrap: !(cur.editorWrap ?? true) }))} />
                <Button key="edit-cancel" label="Cancel" onPress={() => leaveEditor($)} />
                <Button key="edit-save" label={p.busy ? 'Saving…' : 'Save'} variant="primary" onPress={() => saveEdit($, request, true)} />
              </Box>
            </Box>
            <Input key="edit-name" label="Name" placeholder="Template name" value={p.name} onInput={name => field({ name })} onSubmit={name => field({ name })} />
            <Input key="edit-tags" label="Tags" placeholder="comma separated" value={p.tags} onInput={tags => field({ tags })} onSubmit={tags => field({ tags })} />
            {p.confirmBack && (
              <Box flexDirection="column" gap={1}>
                <Text>Save changes before returning to the list?</Text>
                <Box flexDirection="row" gap={1}>
                  <Button key="edit-save-back" label="Save and return" variant="primary" onPress={() => saveEdit($, request, true)} />
                  <Button key="edit-discard" label="Discard changes" onPress={() => leaveEditor($, true)} />
                  <Button key="edit-keep" label="Keep editing" onPress={() => updateEdit($, request, cur => ({ ...cur, confirmBack: false }))} />
                </Box>
              </Box>
            )}
            {messages}
            <Text dimColor>{`Ln ${(p.editorLine ?? 0) + 1}, Col ${(p.editorCol ?? 0) + 1}${p.editorSelected ? ` (${p.editorSelected} selected)` : ''} · Ctrl+S Save · Ctrl+Z Undo · Ctrl+Y Redo · Ctrl+V Paste`}</Text>
            {body}
            <Text dimColor wrap="wrap">{names.length ? `Variables: ${names.join(', ')}` : 'Write {{name}} for a variable. \\{{ keeps literal braces.'}</Text>
          </Box>
        )
      }

      const selected = all.find(t => t.id === v.selected)
      if (v.mode === 'vars' && selected) {
        const names = parseVars(selected.body)
        const setVar = (name: string, value: string) => setView($, cur => ({ vars: { ...cur.vars, [name]: value } }))
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Text bold>{selected.name}</Text>
            <Text dimColor>Fill in the variables, then choose an action. Enter in the last field runs {LABEL[v.action ?? 'fill']}.</Text>
            {names.map((name, i) => (
              <Input key={`var:${name}`} label={name} value={v.vars[name] ?? ''} {...(i === 0 ? { autoFocus: true as const } : {})}
                onInput={value => setVar(name, value)}
                onSubmit={async (value, ev) => { await setVar(name, value); if (i === names.length - 1) await runVars($, v.action ?? 'fill', (ev as any)?.surface) }} />
            ))}
            <Box borderStyle="round" borderDimColor paddingX={1}>
              <Text dimColor wrap="wrap">{renderTemplate(selected.body, v.vars).slice(0, 2000)}</Text>
            </Box>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {ACTIONS.map(a => <Button key={`vars-${a}`} label={LABEL[a]} variant={a === (v.action ?? 'fill') ? 'primary' : 'secondary'} onPress={press => runVars($, a, press.surface)} />)}
              <Button key="vars-cancel" label="Cancel" onPress={() => setView($, { mode: 'list', selected: '', notice: '', error: '' })} />
            </Box>
            {messages}
          </Box>
        )
      }

      if (v.mode === 'io') {
        const setPath = (ioPath: string) => setView($, { ioPath })
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            <Text bold>Import / Export</Text>
            <Text dimColor wrap="wrap">Export writes all {all.length} templates to a JSON file. Import adds the templates of such a file; a template with the same name is replaced or skipped.</Text>
            <Input key="io-path" label="File" value={v.ioPath} onInput={setPath} onSubmit={setPath} />
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="io-export" label="Export all" variant="primary" onPress={() => exportAll($)} />
              <Button key="io-import-replace" label="Import, replace same names" onPress={() => importFile($, 'replace')} />
              <Button key="io-import-skip" label="Import, skip same names" onPress={() => importFile($, 'skip')} />
              <Button key="io-back" label="Back" onPress={() => setView($, { mode: 'list', notice: '', error: '' })} />
            </Box>
            {messages}
          </Box>
        )
      }

      const tags = tagsOf(all)
      const shown = filterTemplates(all, v.query, tags.includes(v.tag) ? v.tag : '')
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1}>
              <Input key="search" placeholder="Search templates" value={v.query} onInput={query => setView($, { query })} onSubmit={query => setView($, { query })} />
            </Box>
            <Button key="new" label="New" variant="primary" onPress={() => openEditor($)} />
            <Button key="io" label="Import/Export" onPress={() => openIo($)} />
          </Box>
          {tags.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {tags.map(tag => <Button key={`tag:${tag}`} label={`#${tag}`} variant={v.tag === tag ? 'primary' : 'secondary'}
                onPress={() => setView($, cur => ({ tag: cur.tag === tag ? '' : tag }))} />)}
            </Box>
          )}
          {messages}
          {all.length === 0 ? <Text dimColor wrap="wrap">No templates yet. Press New, or import a file.</Text>
            : shown.length === 0 ? <Text dimColor>No template matches.</Text>
            : shown.map(t => (
              <Box key={`row:${t.id}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text bold>{t.name}</Text>
                  {t.tags.length > 0 ? <Text dimColor>{t.tags.map(x => `#${x}`).join(' ')}</Text> : null}
                </Box>
                <Text dimColor wrap="truncate-end">{firstLine(t.body) || '(empty)'}</Text>
                {v.mode === 'delete' && v.selected === t.id ? (
                  <Box flexDirection="row" gap={1} flexWrap="wrap">
                    <Text color="red">{`Delete "${t.name}"?`}</Text>
                    <Button key="delete-confirm" label="Delete" variant="primary" onPress={() => deleteTemplate($, t.id)} />
                    <Button key="delete-cancel" label="Cancel" onPress={() => setView($, { mode: 'list', selected: '' })} />
                  </Box>
                ) : (
                  <Box flexDirection="row" gap={1} flexWrap="wrap">
                    {ACTIONS.map(a => <Button key={`${a}:${t.id}`} label={LABEL[a]} variant={a === 'fill' ? 'primary' : 'secondary'} onPress={press => start($, t.id, a, press.surface)} />)}
                    <Button key={`edit:${t.id}`} label="Edit" onPress={() => openEditor($, t.id)} />
                    <Button key={`delete:${t.id}`} label="Delete" onPress={() => setView($, { mode: 'delete', selected: t.id, notice: '', error: '' })} />
                  </Box>
                )}
              </Box>
            ))}
        </Box>
      )
    } catch (error) {
      return <Text color="red" wrap="wrap">{`Prompts pane failed: ${clean(error)}`}</Text>
    }
  })
}
