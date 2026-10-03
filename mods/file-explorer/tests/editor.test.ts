import { expect, test } from 'claude-code/testing'

const pane = { plugin: 'file-explorer', component: 'Pane', requestId: 'file-explorer', surface: 'desktop',
  viewport: { columns: 100, rows: 40 }, props: { title: 'Files', isFocused: true, bodyColumns: 70,
    placement: 'dock', scroll: { offset: 0, bodyRows: 35 }, view: {} } } as const

async function setup($: any, on: any, name = 'notes.md', initial = '# Original\n', conflict = false) {
  let value: any = { root: 'C:/project', dirs: { 'C:/project': [{ name, kind: 'file' }] }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  let disk = initial
  let writes = 0
  let copied = ''
  let status = ''
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', (_: any, e: any) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.stat', (_: any, e: any) => ({ value: { kind: e.path.replace(/\\/g, '/') === 'C:/project' ? 'dir' : 'file', size: disk.length, realPath: e.path, isLink: false, mtimeMs: 1 } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', (_: any, e: any) => { status = e.text ?? ''; return { value: undefined } })
  on('ui.copy', (_: any, e: any) => { copied = e.text; return { value: { isCopied: true } } })
  on('process.run', (_: any, e: any) => {
    if (e.argv.includes('-Command')) return { value: { exitCode: 0, stdout: JSON.stringify({ text: 'Clipboard\r\ntext' }), stderr: '' } }
    if (e.argv.some((arg: string) => arg.endsWith('/write-file.ps1'))) {
      const input = JSON.parse(e.init.stdin)
      if (conflict) return { value: { exitCode: 0, stdout: JSON.stringify({ ok: false, conflict: true, message: 'File changed on disk. Reload before saving.' }), stderr: '' } }
      disk = input.text
      writes++
      return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, hash: 'b'.repeat(64) }), stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify({ kind: 'text', content: disk, draft: disk,
      editable: true, hash: 'a'.repeat(64), encoding: 'utf8', eol: 'lf', truncated: false }), stderr: '' } }
  })
  const ui = await $.ui.mount(pane)
  const row = `n:C:/project/${name}`
  for (let i = 0; i < 2; i++) {
    await ui.pointer({ in: row, type: 'down', x: 1, y: 0, button: 'left' })
    await ui.pointer({ in: row, type: 'up', x: 1, y: 0, button: 'left' })
    await ui.redraw()
  }
  return { ui, disk: () => disk, writes: () => writes, state: () => value, copied: () => copied, status: () => status }
}

async function back(ui: any) {
  await ui.pointer({ in: 'preview-navigation', type: 'down', x: 1, y: 0, button: 'left' })
  await ui.pointer({ in: 'preview-navigation', type: 'up', x: 1, y: 0, button: 'left' })
  await ui.redraw()
}

test('Back returns from an unfocused preview with a single pointer click', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.redraw({ ...pane.props, isFocused: false })
  await back(ui)
  expect(await ui.find({ key: 'n:C:/project/notes.md' })).toBeDefined()
})

test('multiline edits are drafts until explicit Save; saved Markdown renders the draft', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'a', ctrl: true })
  for (const key of ['#', ' ', 'N', 'e', 'w', 'return', 'return', '*', 'i', 't', 'e', 'm', '*']) await f.ui.key({ in: 'file-editor', key })
  await f.ui.redraw()
  expect(f.disk()).toBe('# Original\n')
  expect(f.state().preview.dirty).toBe(true)
  await f.ui.press({ key: 'preview-save' })
  await f.ui.redraw()
  expect(f.disk()).toBe('# New\n\n*item*')
  expect(f.writes()).toBe(1)
  expect(f.state().preview.dirty).toBe(false)
  await f.ui.press({ key: 'preview-rendered' })
  await f.ui.redraw()
  expect(await f.ui.find({ type: 'Markdown', text: '# New' })).toBeDefined()
})

test('Back protects unsaved changes; cancel keeps the draft and discard leaves disk untouched', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.redraw()
  await back(f.ui)
  expect(await f.ui.find({ key: 'preview-keep-editing' })).toBeDefined()
  expect(f.writes()).toBe(0)
  await f.ui.press({ key: 'preview-keep-editing' })
  await f.ui.redraw()
  expect(f.state().preview.draft).toBe('X# Original\n')
  await back(f.ui)
  await f.ui.press({ key: 'preview-discard' })
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'n:C:/project/notes.md' })).toBeDefined()
  expect(f.disk()).toBe('# Original\n')
})

test('a conflicting save preserves the disk and the editable draft', async ($, on) => {
  const f = await setup($, on, 'notes.md', '# Original\n', true)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.redraw()
  await f.ui.press({ key: 'preview-save' })
  await f.ui.redraw()
  expect(f.disk()).toBe('# Original\n')
  expect(f.state().preview.draft).toBe('X# Original\n')
  expect(f.state().preview.dirty).toBe(true)
  expect(await f.ui.find({ type: 'Text', text: /changed on disk/ })).toBeDefined()
})

test('undo restores the original buffer and removes the unsaved marker', async ($, on) => {
  const f = await setup($, on, 'hello.ts', 'const x = 1\n')
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.key({ in: 'file-editor', key: 'z', ctrl: true })
  await f.ui.redraw()
  expect(f.state().preview.draft).toBe('const x = 1\n')
  expect(f.state().preview.dirty).toBe(false)
})

test('Markdown passes headings, emphasis, lists, tables, links and code fences to the renderer unchanged', async ($, on) => {
  const markdown = '# Title\n\n**bold** and *italic*\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[link](https://example.com)\n\n```ts\nconst x = 1\n```\n'
  const { ui } = await setup($, on, 'styled.md', markdown)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(markdown)
})

test('clipboard shortcuts edit the draft and Ctrl+S explicitly saves it', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'a', ctrl: true })
  await f.ui.key({ in: 'file-editor', key: 'c', ctrl: true })
  await f.ui.redraw()
  expect(f.copied()).toBe('# Original\n')
  await f.ui.key({ in: 'file-editor', key: 'x', ctrl: true })
  await f.ui.redraw()
  expect(f.state().preview.draft).toBe('')
  await f.ui.key({ in: 'file-editor', key: 'v', ctrl: true })
  await f.ui.redraw()
  expect(f.state().preview.draft).toBe('Clipboard\ntext')
  expect(f.writes()).toBe(0)
  await f.ui.key({ in: 'file-editor', key: 's', ctrl: true })
  await f.ui.redraw()
  expect(f.disk()).toBe('Clipboard\ntext')
  expect(f.state().preview.dirty).toBe(false)
})

test('Save and return writes the draft before restoring the tree', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.redraw()
  await back(f.ui)
  await f.ui.press({ key: 'preview-save-back' })
  await f.ui.redraw()
  expect(f.disk()).toBe('X# Original\n')
  expect(f.writes()).toBe(1)
  expect(await f.ui.find({ key: 'n:C:/project/notes.md' })).toBeDefined()
})

test('long Markdown and source previews retain the complete document', async ($, on) => {
  const markdown = '# Heading\n\nParagraph with **bold**.\n\n'.repeat(350)
  const { ui } = await setup($, on, 'long.md', markdown)
  expect((await ui.findAll({ type: 'Markdown' })).map((node: { text: string }) => node.text).join('')).toBe(markdown)
  await ui.press({ key: 'preview-source' })
  await ui.redraw()
  expect((await ui.findAll({ type: 'Code' })).map((node: { text: string }) => node.text).join('')).toBe(markdown)
  await ui.press({ key: 'preview-edit' })
  await ui.redraw()
  expect(await ui.find({ key: 'file-editor' })).toBeDefined()
})

test('stale editor packets cannot change or save the current file', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.redraw()
  await f.ui.post({ request: f.state().preview.request - 1, instance: 'stale', seq: 1,
    text: 'overwrite', action: 'save', from: 0, to: 0 }, { in: 'file-editor' })
  await f.ui.redraw()
  expect(f.state().preview.draft).toBe('X# Original\n')
  expect(f.writes()).toBe(0)
})

test('switching between preview and editing retains the unsaved draft', async ($, on) => {
  const f = await setup($, on)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'X' })
  await f.ui.redraw()
  await f.ui.press({ key: 'preview-rendered' })
  await f.ui.redraw()
  expect((await f.ui.find({ type: 'Markdown' }))?.text).toBe('X# Original\n')
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.key({ in: 'file-editor', key: 'a', ctrl: true })
  await f.ui.key({ in: 'file-editor', key: 'c', ctrl: true })
  await f.ui.redraw()
  expect(f.copied()).toBe('X# Original\n')
  expect(f.state().preview.dirty).toBe(true)
  expect(f.writes()).toBe(0)
})

test('Edit displays several document lines together in the available pane', async ($, on) => {
  const f = await setup($, on, 'lines.md', 'First line\nSecond line\nThird line\nFourth line')
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  await f.ui.resize({ in: 'file-editor', columns: 62, rows: 1 })
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'Second line' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'Fourth line' })).toBeDefined()
})

async function editing($: any, on: any, text: string, name = 'code.ts') {
  const f = await setup($, on, name, text)
  await f.ui.press({ key: 'preview-edit' })
  await f.ui.redraw()
  return f
}
const GUTTER = 4
async function click(f: any, col: number, row: number, times = 1, extra: any = {}) {
  for (let i = 0; i < times; i++) {
    await f.ui.pointer({ in: 'file-editor', type: 'down', x: GUTTER + col, y: row, button: 'left', ...extra })
    await f.ui.pointer({ in: 'file-editor', type: 'up', x: GUTTER + col, y: row, button: 'left', ...extra })
  }
  await f.ui.redraw()
}
const typeKeys = async (f: any, ...keys: any[]) => {
  for (const k of keys) await f.ui.key({ in: 'file-editor', ...(typeof k === 'string' ? { key: k } : k) })
  await f.ui.redraw()
}
async function selection(f: any) {
  await typeKeys(f, { key: 'c', ctrl: true })
  return f.copied()
}

test('double-click selects the word under the pointer, triple-click selects the whole line', async ($, on) => {
  const f = await editing($, on, 'hello world;\nsecond line\n')
  await click(f, 7, 0, 2)
  expect(await selection(f)).toBe('world')
  await click(f, 11, 0, 2)
  expect(await selection(f)).toBe(';')
  await click(f, 5, 0, 2)
  expect(await selection(f)).toBe(' ')
  await click(f, 3, 0, 3)
  expect(await selection(f)).toBe('hello world;\n')
})

test('a single click only places the caret', async ($, on) => {
  const f = await editing($, on, 'hello world')
  await click(f, 7, 0, 1)
  expect(await selection(f)).toBe('')
  await typeKeys(f, 'X')
  expect(f.state().preview.draft).toBe('hello wXorld')
})

test('Ctrl+Left/Right jump over words and Ctrl+Shift extends the selection by words', async ($, on) => {
  const f = await editing($, on, 'foo.bar baz')
  await typeKeys(f, { key: 'right', ctrl: true }, { key: 'right', ctrl: true }, 'X')
  expect(f.state().preview.draft).toBe('foo.barX baz')
  await typeKeys(f, { key: 'left', ctrl: true }, 'Y')
  expect(f.state().preview.draft).toBe('foo.YbarX baz')
  await typeKeys(f, { key: 'home', ctrl: true }, { key: 'right', ctrl: true, shift: true })
  expect(await selection(f)).toBe('foo')
})

test('Ctrl+Backspace and Ctrl+Delete remove one word', async ($, on) => {
  const f = await editing($, on, 'foo bar')
  await typeKeys(f, { key: 'end', ctrl: true }, { key: 'backspace', ctrl: true })
  expect(f.state().preview.draft).toBe('foo ')
  await typeKeys(f, { key: 'backspace', ctrl: true })
  expect(f.state().preview.draft).toBe('')
})

test('Ctrl+Delete removes the word after the caret', async ($, on) => {
  const g = await editing($, on, 'foo bar')
  await typeKeys(g, { key: 'home', ctrl: true }, { key: 'delete', ctrl: true })
  expect(g.state().preview.draft).toBe(' bar')
})

test('Enter keeps the indentation and adds a level after an opening bracket', async ($, on) => {
  const f = await editing($, on, '  foo')
  await typeKeys(f, { key: 'end', ctrl: true }, 'return', 'x')
  expect(f.state().preview.draft).toBe('  foo\n  x')
})

test('Enter adds one level after an opening bracket', async ($, on) => {
  const g = await editing($, on, '  if (a) {')
  await typeKeys(g, { key: 'end', ctrl: true }, 'return', 'y')
  expect(g.state().preview.draft).toBe('  if (a) {\n    y')
})

test('Tab indents every selected line and Shift+Tab outdents them', async ($, on) => {
  const f = await editing($, on, 'a\nb\nc')
  await typeKeys(f, { key: 'a', ctrl: true }, 'tab')
  expect(f.state().preview.draft).toBe('  a\n  b\n  c')
  await typeKeys(f, { key: 'tab', shift: true })
  expect(f.state().preview.draft).toBe('a\nb\nc')
})

test('Shift+Tab outdents the current line without a selection', async ($, on) => {
  const f = await editing($, on, '    deep')
  await typeKeys(f, { key: 'end', ctrl: true }, { key: 'tab', shift: true })
  expect(f.state().preview.draft).toBe('  deep')
})

test('Home goes to the first non-blank character, a second Home to column 0', async ($, on) => {
  const f = await editing($, on, '  foo')
  await typeKeys(f, { key: 'end', ctrl: true }, 'home', 'X')
  expect(f.state().preview.draft).toBe('  Xfoo')
  await typeKeys(f, 'home', 'home', 'Y')
  expect(f.state().preview.draft).toBe('Y  Xfoo')
})

test('Ctrl+D duplicates the line, Ctrl+K deletes it, Ctrl+L selects it', async ($, on) => {
  const f = await editing($, on, 'a\nb\nc')
  await typeKeys(f, { key: 'd', ctrl: true })
  expect(f.state().preview.draft).toBe('a\na\nb\nc')
  await typeKeys(f, { key: 'k', ctrl: true })
  expect(f.state().preview.draft).toBe('a\nb\nc')
  await typeKeys(f, { key: 'l', ctrl: true })
  expect(await selection(f)).toBe('b\n')
})

test('Ctrl+/ comments and uncomments the selected lines by file type', async ($, on) => {
  const f = await editing($, on, 'a\n  b', 'code.ts')
  await typeKeys(f, { key: 'a', ctrl: true }, { key: '/', ctrl: true })
  expect(f.state().preview.draft).toBe('// a\n  // b')
  await typeKeys(f, { key: '/', ctrl: true })
  expect(f.state().preview.draft).toBe('a\n  b')
})

test('Ctrl+/ uses # for PowerShell files', async ($, on) => {
  const f = await editing($, on, 'Get-Item', 'run.ps1')
  await typeKeys(f, { key: '/', ctrl: true })
  expect(f.state().preview.draft).toBe('# Get-Item')
})

test('typing a run of characters is one undo step', async ($, on) => {
  const f = await editing($, on, 'x')
  await typeKeys(f, 'a', 'b', 'c')
  expect(f.state().preview.draft).toBe('abcx')
  await typeKeys(f, { key: 'z', ctrl: true })
  expect(f.state().preview.draft).toBe('x')
})

test('the status row shows encoding and line ending', async ($, on) => {
  const f = await editing($, on, 'ab\ncd')
  expect(await f.ui.find({ type: 'Text', text: /UTF-8 · LF/ })).toBeDefined()
})

test('the status row shows line, column and selection size', async ($, on) => {
  const f = await editing($, on, 'ab\ncd')
  expect(await f.ui.find({ type: 'Text', text: /Ln 1, Col 1/ })).toBeDefined()
  await typeKeys(f, { key: 'end', ctrl: true })
  expect(await f.ui.find({ type: 'Text', text: /Ln 2, Col 3/ })).toBeDefined()
  await typeKeys(f, { key: 'left', shift: true })
  expect(await f.ui.find({ type: 'Text', text: /1 selected/ })).toBeDefined()
})

test('a drag selects to the row under the pointer, whatever the pane scroll position', async ($, on) => {
  const f = await editing($, on, Array.from({ length: 60 }, (_, i) => `L${i}`).join('\n'))
  await f.ui.pointer({ in: 'file-editor', type: 'down', x: GUTTER, y: 0, button: 'left' })
  await f.ui.pointer({ in: 'file-editor', type: 'move', x: GUTTER, y: 10, button: 'left' })
  await f.ui.pointer({ in: 'file-editor', type: 'up', x: GUTTER, y: 10, button: 'left' })
  await f.ui.redraw()
  expect((await selection(f)).split('\n').length).toBe(11)
})

test('a long file draws a window of lines and spacers that keep the full height', async ($, on) => {
  const f = await editing($, on, Array.from({ length: 400 }, (_, i) => `L${i}`).join('\n'))
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'L0' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'L399' })).toBeUndefined()
  await typeKeys(f, { key: 'end', ctrl: true })
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'L399' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'L0' })).toBeUndefined()
})

const KW = '#569cd6', CTL = '#c586c0', STR = '#ce9178', COM = '#6a9955', NUM = '#b5cea8', TYPE = '#4ec9b0', FN = '#dcdcaa', PROP = '#9cdcfe'
async function colorAt(f: any, line: RegExp, col: number) {
  const t: any = await f.ui.find({ in: 'file-editor', type: 'Text', text: line })
  const chars: (string | undefined)[] = []
  for (const child of t.children) if (typeof child === 'object') for (const _ of [...child.children.join('')]) chars.push(child.props.color)
  return chars[col]
}

test('TypeScript: keywords, strings, comments, calls and numbers get their own colours', async ($, on) => {
  const f = await editing($, on, 'const x = "a" // c\nif (x) return foo(1)', 'a.ts')
  expect(await colorAt(f, /const x/, 0)).toBe(KW)
  expect(await colorAt(f, /const x/, 10)).toBe(STR)
  expect(await colorAt(f, /const x/, 14)).toBe(COM)
  expect(await colorAt(f, /if \(x\)/, 0)).toBe(CTL)
  expect(await colorAt(f, /if \(x\)/, 7)).toBe(CTL)
  expect(await colorAt(f, /if \(x\)/, 14)).toBe(FN)
  expect(await colorAt(f, /if \(x\)/, 18)).toBe(NUM)
})

test('JSON: keys, numbers and literals', async ($, on) => {
  const f = await editing($, on, '{"a": 1, "b": true}', 'a.json')
  expect(await colorAt(f, /"a"/, 1)).toBe(PROP)
  expect(await colorAt(f, /"a"/, 6)).toBe(NUM)
  expect(await colorAt(f, /"a"/, 9)).toBe(PROP)
  expect(await colorAt(f, /"a"/, 14)).toBe(KW)
})

test('Markdown: headings, inline code and fenced code in its own language', async ($, on) => {
  const f = await editing($, on, '# Title\n\n`code` and text\n\n```ts\nconst y = 1\n```', 'a.md')
  expect(await colorAt(f, /Title/, 0)).toBe(KW)
  expect(await colorAt(f, /and text/, 0)).toBe(STR)
  expect(await colorAt(f, /const y/, 0)).toBe(KW)
})

test('PowerShell: comments, cmdlets and variables', async ($, on) => {
  const f = await editing($, on, '# note\nGet-Item $x', 'a.ps1')
  expect(await colorAt(f, /note/, 0)).toBe(COM)
  expect(await colorAt(f, /Get-Item/, 0)).toBe(FN)
  expect(await colorAt(f, /Get-Item/, 9)).toBe(PROP)
})

test('Python: keywords, comments and triple-quoted strings across lines', async ($, on) => {
  const f = await editing($, on, 'def f(): # c\n  """doc\nmore"""', 'a.py')
  expect(await colorAt(f, /def f/, 0)).toBe(KW)
  expect(await colorAt(f, /def f/, 9)).toBe(COM)
  expect(await colorAt(f, /"""doc/, 2)).toBe(STR)
  expect(await colorAt(f, /more/, 0)).toBe(STR)
})

test('a block comment keeps its colour across lines and ends at the closer', async ($, on) => {
  const f = await editing($, on, '/* a\nb */ x', 'a.ts')
  expect(await colorAt(f, /b \*\//, 0)).toBe(COM)
  expect(await colorAt(f, /b \*\//, 5)).toBeUndefined()
})

test('plain text files are not coloured', async ($, on) => {
  const f = await editing($, on, 'const x = "a" // c', 'notes.txt')
  expect(await colorAt(f, /const/, 0)).toBeUndefined()
  expect(await colorAt(f, /const/, 10)).toBeUndefined()
})

test('CSS properties and colours, YAML keys and comments, HTML tags and attributes', async ($, on) => {
  const css = await editing($, on, 'a { color: #fff; }', 'a.css')
  expect(await colorAt(css, /color/, 4)).toBe(PROP)
  expect(await colorAt(css, /color/, 11)).toBe(NUM)
})

test('YAML keys and comments', async ($, on) => {
  const f = await editing($, on, 'name: x # c', 'a.yml')
  expect(await colorAt(f, /name/, 0)).toBe(PROP)
  expect(await colorAt(f, /name/, 8)).toBe(COM)
})

test('HTML tags, attributes and strings', async ($, on) => {
  const f = await editing($, on, '<div class="a">hi</div>', 'a.html')
  expect(await colorAt(f, /div/, 1)).toBe(TYPE)
  expect(await colorAt(f, /div/, 5)).toBe(PROP)
  expect(await colorAt(f, /div/, 11)).toBe(STR)
})

test('desktop lines carry more characters than cells so the host clips them at the pixel edge', async ($, on) => {
  const f = await editing($, on, 'abcdefghij'.repeat(8) + '\n')
  await f.ui.resize({ in: 'file-editor', columns: 40, rows: 1 })
  await f.ui.redraw()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'abcdefghij'.repeat(4) })).toBeDefined()
  await typeKeys(f, 'end')
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'ghij' })).toBeDefined()
})

test('Edit draws the whole file so the pane scrolls it natively', async ($, on) => {
  const f = await editing($, on, Array.from({ length: 100 }, (_, i) => `L${i}`).join('\n'))
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'L99' })).toBeDefined()
})

test('the caret position reaches the pane state, one row per vertical move', async ($, on) => {
  const f = await editing($, on, Array.from({ length: 100 }, (_, i) => `L${i}`).join('\n'))
  await typeKeys(f, 'down', 'down', 'right')
  expect(f.state().preview.editorRow).toBe(2)
  expect(f.state().preview.editorCol).toBe(1)
})

const PROSE = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'
async function narrow(f: any) {
  await f.ui.resize({ in: 'file-editor', columns: 30, rows: 1 })
  await f.ui.redraw()
}
const seen = async (f: any, text: string) => (await f.ui.find({ in: 'file-editor', type: 'Text', text })) !== undefined

test('Markdown soft-wraps at spaces, numbers each line once and keeps Ln/Col logical', async ($, on) => {
  const f = await editing($, on, PROSE + '\nB', 'a.md')
  await narrow(f)
  expect(await seen(f, 'delta epsilon')).toBe(false)
  expect(await seen(f, 'epsilon zeta')).toBe(true)
  expect(await seen(f, 'kappa lambda mu')).toBe(true)
  expect((await f.ui.findAll({ in: 'file-editor', type: 'Text', text: /^ *\d+ $/ })).length).toBe(2)
  await typeKeys(f, 'down')
  expect(await f.ui.find({ type: 'Text', text: /Ln 1, Col 24/ })).toBeDefined()
  await typeKeys(f, { key: 'end', ctrl: true })
  expect(await f.ui.find({ type: 'Text', text: /Ln 2, Col 2/ })).toBeDefined()
})

test('the Wrap button flips wrapping; source files start unwrapped, prose files wrapped', async ($, on) => {
  const code = await editing($, on, PROSE, 'a.ts')
  await narrow(code)
  expect(await seen(code, 'delta epsilon')).toBe(true)
  await code.ui.press({ key: 'preview-wrap' })
  await code.ui.redraw()
  expect(await seen(code, 'delta epsilon')).toBe(false)
  await code.ui.press({ key: 'preview-wrap' })
  await code.ui.redraw()
  expect(await seen(code, 'delta epsilon')).toBe(true)
})

test('a click on a wrapped continuation row places the caret in that row', async ($, on) => {
  const f = await editing($, on, PROSE, 'a.md')
  await narrow(f)
  await click(f, 2, 1)
  await typeKeys(f, 'X')
  expect(f.state().preview.draft).toBe(PROSE.slice(0, 25) + 'X' + PROSE.slice(25))
})

const MATCH = '#3a3f4b'
async function bgAt(f: any, line: RegExp, col: number) {
  const t: any = await f.ui.find({ in: 'file-editor', type: 'Text', text: line })
  const chars: (string | undefined)[] = []
  for (const child of t.children) if (typeof child === 'object') for (const _ of [...child.children.join('')]) chars.push(child.props.backgroundColor)
  return chars[col]
}

test('the bracket next to the caret and its partner are highlighted, brackets in strings are skipped', async ($, on) => {
  const f = await editing($, on, 'f(a[1])\ng(")")', 'a.ts')
  await typeKeys(f, 'right')
  expect(await bgAt(f, /f\(a/, 1)).toBe(MATCH)
  expect(await bgAt(f, /f\(a/, 6)).toBe(MATCH)
  expect(await bgAt(f, /f\(a/, 3)).toBeUndefined()
  await typeKeys(f, 'down', 'home', 'right')
  expect(await bgAt(f, /g\(/, 1)).toBe(MATCH)
  expect(await bgAt(f, /g\(/, 5)).toBe(MATCH)
  expect(await bgAt(f, /g\(/, 3)).toBeUndefined()
})

test('leading indent shows a guide per level, trailing spaces and tabs show as dim marks', async ($, on) => {
  const f = await editing($, on, '    x\nab  \n\tc\na  b', 'a.ts')
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: '│ │ x' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'ab··' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: '→c' })).toBeDefined()
  expect(await f.ui.find({ in: 'file-editor', type: 'Text', text: 'a  b' })).toBeDefined()
})

const FIND = '#515c6a'

test('Ctrl+F finds as you type, Enter and Shift+Enter step through matches, all matches are marked', async ($, on) => {
  const f = await editing($, on, 'alpha beta alpha\nalpha', 'a.ts')
  await typeKeys(f, { key: 'f', ctrl: true }, 'a', 'l', 'p', 'h', 'a')
  expect(await selection(f)).toBe('alpha')
  expect(await bgAt(f, /alpha beta/, 12)).toBe(FIND)
  expect(f.status()).toMatch(/1\/3/)
  await typeKeys(f, 'return')
  expect(f.status()).toMatch(/2\/3/)
  await typeKeys(f, 'return', { key: 'return', shift: true }, { key: 'f', ctrl: true })
  expect(f.status()).toBe('')
  await typeKeys(f, 'X')
  expect(f.state().preview.draft).toBe('alpha beta X\nalpha')
})

test('Ctrl+H replaces the current match with Enter and every match with Ctrl+Enter, as one undo step', async ($, on) => {
  const f = await editing($, on, 'foo bar foo foo', 'a.ts')
  await typeKeys(f, { key: 'h', ctrl: true }, 'f', 'o', 'o', 'tab', 'b', 'a', 'z', 'return')
  expect(f.state().preview.draft).toBe('baz bar foo foo')
  await typeKeys(f, { key: 'return', ctrl: true })
  expect(f.state().preview.draft).toBe('baz bar baz baz')
  await typeKeys(f, { key: 'h', ctrl: true }, { key: 'z', ctrl: true })
  expect(f.state().preview.draft).toBe('baz bar foo foo')
})

test('the toolbar icons carry hover labels that say what they do', async ($, on) => {
  const f = await setup($, on)
  await back(f.ui)
  expect(await f.ui.find({ type: 'Text', text: 'Collapse all folders' })).toBeDefined()
  expect(await f.ui.find({ type: 'Text', text: 'Refresh' })).toBeDefined()
})

test('row highlights are drawn with rounded corners where SVG is available', async ($, on) => {
  const f = await setup($, on)
  await back(f.ui)
  const layer: any = await f.ui.find({ key: 'n:C:/project/notes.md' })
  expect(layer).toBeDefined()
  const caps = (await f.ui.findAll({ type: 'Svg' })).filter((n: any) => n.props?.alt === 'row-cap')
  expect(caps.length).toBe(2)
})

const LONG = Array.from({ length: 60 }, (_, i) => `L${i}`).join('\n')
async function dragTo(f: any, y: number) {
  await f.ui.pointer({ in: 'file-editor', type: 'down', x: GUTTER, y: 0, button: 'left' })
  await f.ui.pointer({ in: 'file-editor', type: 'move', x: GUTTER, y, button: 'left' })
}

test('a drag held past the visible rows keeps extending the selection until the button is released', async ($, on) => {
  const f = await editing($, on, LONG)
  await dragTo(f, 50)
  expect(await selection(f)).not.toContain('L40\n')
  await f.ui.advance(180)
  await f.ui.redraw()
  expect(await selection(f)).toContain('L40\n')
  await f.ui.pointer({ in: 'file-editor', type: 'up', x: GUTTER, y: 50, button: 'left' })
  await f.ui.redraw()
  const held = await selection(f)
  await f.ui.advance(300)
  await f.ui.redraw()
  expect(await selection(f)).toBe(held)
})

test('a drag inside the visible rows does not auto-scroll', async ($, on) => {
  const f = await editing($, on, LONG)
  await dragTo(f, 10)
  await f.ui.advance(300)
  await f.ui.redraw()
  expect((await selection(f)).split('\n').length).toBe(11)
})
