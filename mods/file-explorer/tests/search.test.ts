import { expect, test } from 'claude-code/testing'

const pane = { plugin: 'file-explorer', component: 'Pane', requestId: 'file-explorer', surface: 'desktop',
  viewport: { columns: 100, rows: 40 }, props: { title: 'Files', isFocused: true, bodyColumns: 70,
    placement: 'dock', scroll: { offset: 0, bodyRows: 35 }, view: {} } } as const

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })
const FS: Record<string, any[]> = {
  'C:/project': [entry('src', 'dir'), entry('node_modules', 'dir'), entry('top.ts', 'file')],
  'C:/project/src': [entry('deep', 'dir'), entry('lib.ts', 'file')],
  'C:/project/src/deep': [entry('needle.ts', 'file')],
  'C:/project/node_modules': [entry('needle-dep.js', 'file')],
}

async function mountSearch($: any, on: any) {
  let value: any = { root: 'C:/project', dirs: { 'C:/project': FS['C:/project']!.map(e => ({ name: e.name, kind: e.kind })) }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  const listed: string[] = []
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', (_: any, e: any) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_: any, e: any) => { const dir = e.path.replace(/\\/g, '/'); listed.push(dir); return { value: FS[dir] ?? [] } })
  on('ui.invalidate', () => ({ value: undefined }))
  const ui = await $.ui.mount(pane)
  return { ui, listed, state: () => value }
}

test('search finds files inside collapsed subfolders', async ($, on) => {
  const f = await mountSearch($, on)
  await f.ui.input({ key: 'filter', text: 'needle', kind: 'change' })
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'n:C:/project/src/deep/needle.ts' })).toBeDefined()
})

test('search does not crawl node_modules', async ($, on) => {
  const f = await mountSearch($, on)
  await f.ui.input({ key: 'filter', text: 'needle', kind: 'change' })
  await f.ui.redraw()
  expect(f.listed).not.toContain('C:/project/node_modules')
  expect(await f.ui.find({ key: 'n:C:/project/node_modules/needle-dep.js' })).toBeUndefined()
})

test('clearing the search restores the folder tree', async ($, on) => {
  const f = await mountSearch($, on)
  await f.ui.input({ key: 'filter', text: 'needle', kind: 'change' })
  await f.ui.redraw()
  await f.ui.input({ key: 'filter', text: '', kind: 'change' })
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'n:C:/project/top.ts' })).toBeDefined()
  expect(await f.ui.find({ key: 'n:C:/project/src/deep/needle.ts' })).toBeUndefined()
})
