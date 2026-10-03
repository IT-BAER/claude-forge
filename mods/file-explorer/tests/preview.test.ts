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
  await ui.press({ key: 'preview-back' })
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
  expect((await ui.find({ type: 'Code' }))?.text.length).toBe(9500)
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
  await ui.press({ key: 'preview-back' })
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
  await ui.press({ key: 'preview-back' })
  release({ value: { kind: 'file', size: 12, mtimeMs: 1, isLink: false, realPath: 'C:/project/slow.txt' } })
  await pending
  await ui.redraw()
  expect(await ui.find({ key: 'n:C:/project/slow.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})
