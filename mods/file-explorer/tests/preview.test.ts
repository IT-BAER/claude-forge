import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'file-explorer', component: 'Pane', requestId: 'file-explorer',
  viewport: { columns: 100, rows: 40 },
  props: { title: 'Files', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('single click selects, double-click previews code without changing the composer', async ($, on) => {
  let value: any = { root: 'C:/project', dirs: { 'C:/project': [{ name: 'hello.ts', kind: 'file' }] }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  let composer = 'existing draft'
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', ($, e) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('theme.json') ? '{}' : 'export const hello = 42\n' }))
  on('fs.stat', ($, e) => ({ value: { kind: e.path === 'C:/project' ? 'dir' : 'file', size: 24, mtimeMs: 1, isLink: false, realPath: e.path } }))
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify({ kind: 'text', content: 'export const hello = 42\n', truncated: false }), stderr: '' } })) as any)
  on('ui.invalidate', () => ({ value: undefined }))
  on('prompt.fill', ($, e) => { composer += e.text; return { isFilled: true } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await click(ui, 'hello.ts')
  await ui.redraw()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(value.picked).toBe('C:/project/hello.ts')
  expect(composer).toBe('existing draft')
  await click(ui, 'hello.ts')
  await ui.redraw()
  expect(await ui.find({ type: 'Code', text: /export const hello = 42/ })).toBeDefined()
  expect(composer).toBe('existing draft')
  expect(await ui.find({ key: 'preview-add' })).toBeUndefined()
  await ui.pointer({ in: 'preview-navigation', type: 'down', button: 'left', x: 1, y: 0 }); await ui.pointer({ in: 'preview-navigation', type: 'up', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  expect(await ui.find({ key: 'n:C:/project/hello.ts' })).toBeDefined()
  await click(ui, 'hello.ts', true)
  expect(composer).toBe('existing draft@hello.ts ')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

async function click(ui: any, name: string, ctrl = false, redraw = true) {
  const inRow = `n:C:/project/${name}`
  await ui.pointer({ in: inRow, type: 'down', x: 1, y: 0, button: 'left', ...(ctrl ? { ctrl: true } : {}) })
  await ui.pointer({ in: inRow, type: 'up', x: 1, y: 0, button: 'left', ...(ctrl ? { ctrl: true } : {}) })
  if (redraw) await ui.redraw()
}
function fixture($: any, on: any, name: string, content: string, size = content.length, realPath = `C:/project/${name}`, stat?: (e: any) => any, image = false, entries = [{ name, kind: 'file' }]) {
  let value: any = { root: 'C:/project', dirs: { 'C:/project': entries }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', ($: any, e: any) => {
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    value = e.value
    return { value: { isSet: true, version: ++version } }
  })
  on('fs.read', ($: any, e: any) => ({ value: e.path.endsWith('theme.json') ? '{}' : content }))
  on('fs.stat', ($: any, e: any) => stat ? stat(e) : ({ value: { kind: e.path.replace(/\\/g, '/') === 'C:/project' ? 'dir' : 'file', size, mtimeMs: 1, isLink: false, realPath: e.path.replace(/\\/g, '/') === 'C:/project' ? e.path : realPath } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: image ? '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA=="/></svg>' : JSON.stringify(content.includes('\0') ? { kind: 'unsupported', content: 'Binary file. Text preview is not available.', truncated: false } : { kind: 'text', content: content.slice(0, 9500), truncated: content.length > 9500 }), stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  return () => $.ui.mount({ ...PANE, surface: 'desktop' })
}

test('separated clicks select without opening; a following double-click opens', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  await click(ui, 'hello.ts')
  await ui.advance(600)
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code', text: 'hello' })).toBeDefined()
})

test('clicking another file resets the double-click pair', async ($, on) => {
  const ui = await fixture($, on, 'a.ts', 'hello', 5, undefined, undefined, false,
    [{ name: 'a.ts', kind: 'file' }, { name: 'b.ts', kind: 'file' }])()
  await click(ui, 'a.ts', false, false)
  await click(ui, 'b.ts', false, false)
  await click(ui, 'a.ts', false, false)
  await ui.redraw()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'a.ts')
  expect(await ui.find({ type: 'Code' })).toBeDefined()
})

test('leaving a file breaks the pair even before another row message arrives', async ($, on) => {
  const ui = await fixture($, on, 'a.ts', 'hello')()
  await click(ui, 'a.ts', false, false)
  await ui.pointer({ in: 'n:C:/project/a.ts', type: 'leave', x: 1, y: 0 })
  await ui.pointer({ in: 'n:C:/project/a.ts', type: 'enter', x: 1, y: 0 })
  await click(ui, 'a.ts', false, false)
  await ui.redraw()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'a.ts')
  expect(await ui.find({ type: 'Code' })).toBeDefined()
})

const picked = async (ui: any) => (await ui.findAll({ type: 'Svg' })).some((n: any) => n.props?.alt === 'row-cap-picked')

test('clicking blank pane space clears selection and starts a new click pair', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  await click(ui, 'hello.ts')
  expect(await picked(ui)).toBe(true)
  await ui.pointer({ in: 'tree-empty', type: 'down', x: 1, y: 2, button: 'left' })
  await ui.pointer({ in: 'tree-empty', type: 'up', x: 1, y: 2, button: 'left' })
  await ui.redraw()
  expect(await picked(ui)).toBe(false)
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeDefined()
})

test('leaving the Files pane clears selection permanently until another row click', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  await click(ui, 'hello.ts')
  await ui.redraw({ ...PANE.props, isFocused: false })
  expect(await picked(ui)).toBe(false)
  await ui.redraw({ ...PANE.props, isFocused: true })
  expect(await picked(ui)).toBe(false)
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})

test('clicking the tree header clears selection', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  await click(ui, 'hello.ts')
  expect(await picked(ui)).toBe(true)
  await ui.pointer({ in: 'tree-title', type: 'down', x: 1, y: 0, button: 'left' })
  await ui.redraw()
  expect(await picked(ui)).toBe(false)
})

test('a drag and a bare release do not count as file clicks', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  const inRow = 'n:C:/project/hello.ts'
  await ui.pointer({ in: inRow, type: 'up', x: 1, y: 0, button: 'left' })
  await ui.pointer({ in: inRow, type: 'down', x: 1, y: 0, button: 'left' })
  await ui.pointer({ in: inRow, type: 'move', x: 8, y: 0, button: 'left' })
  await ui.pointer({ in: inRow, type: 'up', x: 1, y: 0, button: 'left' })
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await click(ui, 'hello.ts')
  expect(await ui.find({ type: 'Code' })).toBeDefined()
})

test('a coalesced Ctrl-click is preserved and replayed messages do not duplicate mentions', async ($, on) => {
  let composer = 'draft '
  on('prompt.fill', ($, e) => { composer += e.text; return { isFilled: true } })
  const ui = await fixture($, on, 'two words.ts', 'hello')()
  const packet = { path: 'C:/project/two words.ts', instance: 'coalesced-clicks', clicks: [
    { seq: 1, ctrl: true, canDouble: false }, { seq: 2, ctrl: false, canDouble: false },
  ] }
  await ui.post(packet, { in: 'n:C:/project/two words.ts' })
  await ui.post(packet, { in: 'n:C:/project/two words.ts' })
  await ui.redraw()
  expect(composer).toBe('draft @"two words.ts" ')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})

test('a coalesced double-click still opens, and forged paths are ignored', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  await ui.post({ path: 'C:/elsewhere/hello.ts', instance: 'forged', clicks: [{ seq: 1, ctrl: true, canDouble: false }] }, { in: 'n:C:/project/hello.ts' })
  await ui.redraw()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.post({ path: 'C:/project/hello.ts', instance: 'coalesced-double', clicks: [
    { seq: 1, ctrl: false, canDouble: false }, { seq: 2, ctrl: false, canDouble: true },
  ] }, { in: 'n:C:/project/hello.ts' })
  await ui.redraw()
  expect(await ui.find({ type: 'Code', text: 'hello' })).toBeDefined()
})

test('Markdown toggles rendered and source views', async ($, on) => {
  const ui = await fixture($, on, 'notes.md', '# Preview\n\nHello **world**.')()
  await click(ui, 'notes.md')
  await click(ui, 'notes.md')
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /Cannot preview file/ }))?.text).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: /Hello \*\*world\*\*/ })).toBeDefined()
  await ui.press({ key: 'preview-source' })
  await ui.redraw()
  expect(await ui.find({ type: 'Code', text: /# Preview/ })).toBeDefined()
  await ui.press({ key: 'preview-rendered' })
  await ui.redraw()
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
})

test('long text is truncated and binary text is not rendered', async ($, on) => {
  const ui = await fixture($, on, 'large.txt', 'x'.repeat(12000))()
  await click(ui, 'large.txt')
  await click(ui, 'large.txt')
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /Cannot preview file/ }))?.text).toBeUndefined()
  expect((await ui.findAll({ type: 'Code' })).map((node: { text: string }) => node.text).join('').length).toBe(9500)
  expect(await ui.find({ type: 'Text', text: /Preview truncated/ })).toBeDefined()
})

test('binary contents show an unsupported message', async ($, on) => {
  const ui = await fixture($, on, 'data.bin', 'hello\0world')()
  await click(ui, 'data.bin')
  await click(ui, 'data.bin')
  await ui.redraw()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Binary file/ })).toBeDefined()
})

test('a link outside the explorer root is rejected before content is read', async ($, on) => {
  const ui = await fixture($, on, 'link.txt', 'should never render', 20, 'C:/elsewhere/link.txt')()
  await click(ui, 'link.txt')
  await click(ui, 'link.txt')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /outside the explorer root/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})

test('unavailable files show an error and Back still restores the tree', async ($, on) => {
  const mount = fixture($, on, 'gone.txt', '', 0, undefined, () => ({ deny: 'ENOENT' }))
  const ui = await mount()
  await click(ui, 'gone.txt')
  await click(ui, 'gone.txt')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Cannot preview file:.*ENOENT/ })).toBeDefined()
  await ui.pointer({ in: 'preview-navigation', type: 'down', button: 'left', x: 1, y: 0 }); await ui.pointer({ in: 'preview-navigation', type: 'up', button: 'left', x: 1, y: 0 })
  await ui.redraw()
  expect(await ui.find({ key: 'n:C:/project/gone.txt' })).toBeDefined()
})

test('an image becomes an isolated SVG preview', async ($, on) => {
  const mount = fixture($, on, 'picture.png', '', 100, undefined, undefined, true)
  const ui = await mount()
  await click(ui, 'picture.png')
  await click(ui, 'picture.png')
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /Cannot preview file/ }))?.text).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('Back during a pending read prevents a late preview from reopening', async ($, on) => {
  let release: (value: any) => void = () => {}
  let began: () => void = () => {}
  const started = new Promise<void>(resolve => { began = resolve })
  const mount = fixture($, on, 'slow.txt', 'late content', 12, undefined, e => e.path.replace(/\\/g, '/') === 'C:/project' ? { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false, realPath: e.path } } : new Promise(resolve => { release = resolve; began() }))
  const ui = await mount()
  await click(ui, 'slow.txt')
  const pending = click(ui, 'slow.txt')
  await started
  await ui.redraw()
  await ui.pointer({ in: 'preview-navigation', type: 'down', button: 'left', x: 1, y: 0 }); await ui.pointer({ in: 'preview-navigation', type: 'up', button: 'left', x: 1, y: 0 })
  release({ value: { kind: 'file', size: 12, mtimeMs: 1, isLink: false, realPath: 'C:/project/slow.txt' } })
  await pending
  await ui.redraw()
  expect(await ui.find({ key: 'n:C:/project/slow.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})

async function pickItem(ui: any, id: string) { await ui.post({ id }, { in: `m:${id}` }) }
async function openMenu(ui: any, name: string) {
  await ui.post({ path: `C:/project/${name}`, menu: true }, { in: `n:C:/project/${name}` })
  await ui.redraw()
}

test('the "…" button on a file row opens a menu; Copy path copies the absolute path', async ($, on) => {
  let copied = ''
  on('ui.copy', ($, e) => { copied = e.text; return { value: { isCopied: true } } })
  const ui = await fixture($, on, 'hello.ts', 'hello')()
  expect(await ui.find({ key: 'm:copy-path' })).toBeUndefined()
  await openMenu(ui, 'hello.ts')
  expect(await ui.find({ key: 'm:copy-path' })).toBeDefined()
  await pickItem(ui, 'copy-path')
  await ui.redraw()
  expect(copied).toBe('C:/project/hello.ts')
  expect(await ui.find({ key: 'm:copy-path' })).toBeUndefined()
  await ui.unmount()
})

test('menu Add to prompt appends a mention; Copy relative path copies it without the root', async ($, on) => {
  let composer = 'draft '
  let copied = ''
  on('prompt.fill', ($, e) => { composer += e.text; return { isFilled: true } })
  on('ui.copy', ($, e) => { copied = e.text; return { value: { isCopied: true } } })
  const ui = await fixture($, on, 'two words.ts', 'hello')()
  await openMenu(ui, 'two words.ts')
  await pickItem(ui, 'add-prompt')
  await ui.redraw()
  expect(composer).toBe('draft @"two words.ts" ')
  expect(await ui.find({ key: 'm:add-prompt' })).toBeUndefined()
  await openMenu(ui, 'two words.ts')
  await pickItem(ui, 'copy-relative')
  expect(copied).toBe('two words.ts')
  await ui.unmount()
})

test('menu Open previews the file', async ($, on) => {
  const ui = await fixture($, on, 'hello.ts', 'export const hello = 42\n')()
  await openMenu(ui, 'hello.ts')
  await pickItem(ui, 'open')
  await ui.redraw()
  expect(await ui.find({ type: 'Code', text: /export const hello = 42/ })).toBeDefined()
  await ui.unmount()
})

async function menuFixture($: any, on: any, reply: any = { ok: true, message: '' }, theme = '{}') {
  const entries = [{ name: 'sub', kind: 'dir' }, { name: 'hello.ts', kind: 'file' }]
  let value: any = { root: 'C:/project', dirs: { 'C:/project': entries }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  const ops: { op: string; path: string; name?: string }[] = []
  const toasts: string[] = []
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', ($: any, e: any) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('fs.read', ($: any, e: any) => ({ value: e.path.endsWith('theme.json') ? theme : 'hello' }))
  on('fs.list', () => ({ value: entries.map(e => ({ ...e, size: 1, mtimeMs: 1, isLink: false })) }))
  on('fs.stat', ($: any, e: any) => ({ value: { kind: e.path === 'C:/project' || e.path.endsWith('/sub') ? 'dir' : 'file', size: 5, mtimeMs: 1, isLink: false, realPath: e.path } }))
  on('process.run', (($: any, e: any) => {
    const argv: string[] = e.argv ?? e.command
    const at = (flag: string) => argv[argv.indexOf(flag) + 1]
    if (argv.some(a => a.endsWith('file-op.ps1'))) {
      ops.push({ op: at('-Op')!, path: at('-Path')!.replace(/\\/g, '/'), ...(argv.includes('-Name') ? { name: at('-Name') } : {}) })
      return { value: { exitCode: 0, stdout: JSON.stringify(reply), stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify({ kind: 'text', content: 'hello', truncated: false }), stderr: '' } }
  }) as any)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  return { ui, ops, toasts, state: () => value }
}

test('menu Rename edits the name inline and renames through the helper', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'hello.ts')
  await pickItem(f.ui, 'rename')
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'menu-input' })).toBeDefined()
  await f.ui.input({ key: 'menu-input', text: 'renamed.ts', kind: 'change' })
  await f.ui.input({ key: 'menu-input', text: 'renamed.ts', kind: 'submit' })
  await f.ui.redraw()
  expect(f.ops).toEqual([{ op: 'rename', path: 'C:/project/hello.ts', name: 'renamed.ts' }])
  expect(await f.ui.find({ key: 'menu-input' })).toBeUndefined()
  await f.ui.unmount()
})

test('menu Delete asks first; only the confirm button deletes', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'hello.ts')
  await pickItem(f.ui, 'delete')
  await f.ui.redraw()
  expect(f.ops).toEqual([])
  await pickItem(f.ui, 'cancel')
  await f.ui.redraw()
  expect(f.ops).toEqual([])
  expect(await f.ui.find({ key: 'm:delete-confirm' })).toBeUndefined()
  await openMenu(f.ui, 'hello.ts')
  await pickItem(f.ui, 'delete')
  await f.ui.redraw()
  await pickItem(f.ui, 'delete-confirm')
  await f.ui.redraw()
  expect(f.ops).toEqual([{ op: 'delete', path: 'C:/project/hello.ts' }])
  await f.ui.unmount()
})

test('menu Duplicate runs the helper; a failed operation shows its message', async ($, on) => {
  const f = await menuFixture($, on, { ok: false, message: 'An item with that name already exists.' })
  await openMenu(f.ui, 'hello.ts')
  await pickItem(f.ui, 'duplicate')
  await f.ui.redraw()
  expect(f.ops).toEqual([{ op: 'duplicate', path: 'C:/project/hello.ts' }])
  expect(f.toasts).toEqual(['An item with that name already exists.'])
  await f.ui.unmount()
})

test('a left click on a folder row toggles it', async ($, on) => {
  const f = await menuFixture($, on)
  await click(f.ui, 'sub')
  expect(f.state().open).toEqual(['C:/project/sub'])
  await click(f.ui, 'sub')
  expect(f.state().open).toEqual([])
  await f.ui.unmount()
})

test('the "…" button on a folder offers New file and New folder inside it, and opens it', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'sub')
  expect(await f.ui.find({ key: 'm:open' })).toBeUndefined()
  await pickItem(f.ui, 'new-file')
  await f.ui.redraw()
  await f.ui.input({ key: 'menu-input', text: 'x.md', kind: 'change' })
  await f.ui.input({ key: 'menu-input', text: 'x.md', kind: 'submit' })
  await f.ui.redraw()
  expect(f.ops).toEqual([{ op: 'newfile', path: 'C:/project/sub', name: 'x.md' }])
  expect(f.state().open).toEqual(['C:/project/sub'])
  await openMenu(f.ui, 'sub')
  await pickItem(f.ui, 'new-folder')
  await f.ui.redraw()
  await f.ui.input({ key: 'menu-input', text: 'made', kind: 'submit' })
  expect(f.ops[1]).toEqual({ op: 'newfolder', path: 'C:/project/sub', name: 'made' })
  await f.ui.unmount()
})

test('the menu is a styled popup below its row, drawn after every row so nothing paints over it', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'hello.ts')
  const panel: any = await f.ui.find({ key: 'menu-panel' })
  expect(panel.props).toMatchObject({ position: 'absolute', top: 2 })
  expect(panel.props.backgroundColor).toBeTruthy()
  expect(panel.props.borderStyle).toBeTruthy()
  const order = (await f.ui.findAll({})).map((n: any) => n.key)
  expect(order.indexOf('menu-panel')).toBeGreaterThan(order.indexOf('n:C:/project/hello.ts'))
  expect(order.indexOf('menu-panel')).toBeGreaterThan(order.indexOf('n:C:/project/sub'))
  await f.ui.unmount()
})

test('menu colours come from the theme and separators are clipped to the panel', async ($, on) => {
  const f = await menuFixture($, on, undefined, '{"menuBg":"#111112","menuBorder":"#222223"}')
  await openMenu(f.ui, 'hello.ts')
  const panel: any = await f.ui.find({ key: 'menu-panel' })
  expect(panel.props).toMatchObject({ backgroundColor: '#111112', borderColor: '#222223' })
  // The desktop draws ─ 1.15 cells wide; a wrapping Box moved the rule to the top of its cell.
  const seps: any[] = (await f.ui.findAll({ type: 'Text' })).filter((n: any) => /^─+$/.test(n.text ?? ''))
  expect(seps.length).toBe(2)
  for (const s of seps) expect(s.text.length).toBeLessThanOrEqual(Math.floor((28 - 4) / 1.15))
  expect((await f.ui.findAll({ type: 'Box' })).some((b: any) => String(b.key).startsWith('menu-sep-'))).toBe(false)
  await f.ui.unmount()
})


test('the row highlight is built in the row flow, with no full-row absolute layer over the icon', async ($, on) => {
  const f = await menuFixture($, on)
  const boxes: any[] = await f.ui.findAll({ type: 'Box' })
  const layers = boxes.filter(b => b.props?.position === 'absolute' && b.props.top === 0 && b.props.bottom === 0 && b.props.left === 0 && b.props.right === 0)
  expect(layers).toEqual([])
  expect((await f.ui.findAll({ type: 'Svg' })).filter((n: any) => n.props?.alt === 'row-cap').length).toBe(4)
  await f.ui.unmount()
})

test('every row name Client draws the "…" itself, so no extra Client or focusable Button per row', async ($, on) => {
  const f = await menuFixture($, on)
  for (const name of ['hello.ts', 'sub']) expect((await f.ui.find({ key: `n:C:/project/${name}` })).props.props.menu).toBe(true)
  expect((await f.ui.findAll({ type: 'Button' })).some((b: any) => String(b.key).startsWith('menu-btn:'))).toBe(false)
  await f.ui.unmount()
})

test('one "…" message toggles the menu; losing the pane keyboard hides it and one click reopens it', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'hello.ts')
  expect(await f.ui.find({ key: 'menu-panel' })).toBeDefined()
  await openMenu(f.ui, 'hello.ts')
  expect(await f.ui.find({ key: 'menu-panel' })).toBeUndefined()
  await openMenu(f.ui, 'hello.ts')
  await f.ui.redraw({ ...PANE.props, isFocused: false })
  expect(await f.ui.find({ key: 'menu-panel' })).toBeUndefined()
  await f.ui.redraw({ ...PANE.props, isFocused: true })
  expect(await f.ui.find({ key: 'menu-panel' })).toBeUndefined()
  await openMenu(f.ui, 'hello.ts')
  expect(await f.ui.find({ key: 'menu-panel' })).toBeDefined()
  await f.ui.unmount()
})

test('a menu opened while the pane never had the keyboard still shows', async ($, on) => {
  const f = await menuFixture($, on)
  await f.ui.redraw({ ...PANE.props, isFocused: false })
  await f.ui.post({ path: 'C:/project/hello.ts', menu: true }, { in: 'n:C:/project/hello.ts' })
  await f.ui.redraw({ ...PANE.props, isFocused: false })
  expect(await f.ui.find({ key: 'menu-panel' })).toBeDefined()
  await f.ui.unmount()
})

test('popup items are full-width pointer regions, so hover and click cover the whole row', async ($, on) => {
  const f = await menuFixture($, on)
  await openMenu(f.ui, 'hello.ts')
  const item: any = await f.ui.find({ key: 'm:open' })
  expect(item.props.width).toBe('100%')
  await f.ui.unmount()
})

test('popup top converts rows (theme rowH) to cells (theme cellPx), not row index to cells', async ($, on) => {
  const f = await menuFixture($, on, { ok: true, message: '' }, '{"rowH":38.4,"cellPx":19.2}')
  await f.ui.redraw()
  await openMenu(f.ui, 'hello.ts')
  const panel: any = await f.ui.find({ key: 'menu-panel' })
  expect(panel.props.top).toBe(4)
  await f.ui.unmount()
})

test('highlight cap cells hold an in-flow spacer so the coloured cap lines up with the row', async ($, on) => {
  const f = await menuFixture($, on)
  const cells: any[] = (await f.ui.findAll({ type: 'Box' })).filter((b: any) => b.props?.position === 'relative' && b.props.width === 1)
  expect(cells.length).toBe(4)
  for (const cell of cells) {
    // A centred cap cell of zero height starts the absolute cap half a row low.
    expect(cell.props.alignSelf).toBe('flex-start')
    const kids: any[] = cell.children ?? []
    expect(kids.some(c => c.type === 'Svg' && c.props?.alt === '')).toBe(true)
    expect(kids.some(c => c.type === 'Box' && c.props?.position === 'absolute')).toBe(true)
  }
  await f.ui.unmount()
})
