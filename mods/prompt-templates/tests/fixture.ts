import { mock } from 'claude-code/testing'

// Each UI test mounts the pane and its surface modules; under machine load that passes the kit's 5 s default.
export const SLOW = { timeoutMs: 20000 }
export const SURFACES = ['terminal', 'desktop'] as const
export const pane = { plugin: 'prompt-templates', component: 'Pane', requestId: 'prompt-templates',
  viewport: { columns: 100, rows: 40 }, props: { title: 'Prompts', isFocused: true, bodyColumns: 70,
    placement: 'dock', scroll: { offset: 0, bodyRows: 35 }, view: {} } } as const

export const T = (id: string, name: string, body: string, tags: string[] = []) => ({ id, name, tags, body, updatedAt: 1 })
export const LIB = [T('1', 'Review', 'Review {{file}} for {{topic}}', ['dev']), T('2', 'Mail', 'Write a short mail', ['comms']), T('3', 'Deploy', 'Ship it', ['dev', 'ops'])]

// Hooks beneath the plugin are registered once per test, before the first $ call; mount() then draws per surface.
export function setup($: any, on: any, templates: unknown = LIB) {
  mock.clock(on)
  let value: any
  let version = 0
  const store: Record<string, unknown> = { templates }
  const filled: { text: string; mode?: string }[] = []
  const sent: string[] = []
  const files: Record<string, string> = { 'C:/in.json': JSON.stringify({ templates: [{ name: 'mail', body: 'NEW', tags: [] }, { name: 'Extra', body: 'x' }] }) }
  let copied = ''
  let opened = 0
  let closed = 0
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', (_: any, e: any) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('prompt.fill', (_: any, e: any) => { filled.push({ text: e.text, mode: e.mode }); return { isFilled: true, text: e.text } })
  on('prompt.submit', (_: any, e: any) => { sent.push(e.text); return { text: e.text } })
  on('ui.copy', (_: any, e: any) => { copied = e.text; return { value: { isCopied: true } } })
  on('ui.open', () => { opened++; return { value: { isPlaced: true } } })
  on('ui.close', () => { closed++; return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.scroll', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ text: 'Clipboard\r\ntext' }), stderr: '' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('env.get', () => ({ value: 'C:/Users/me' }))
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('fs.read', (_: any, e: any) => { if (!(norm(e.path) in files)) throw new Error('missing'); return { value: files[norm(e.path)] } })
  on('fs.write', (_: any, e: any) => { files[norm(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_: any, e: any) => ({ value: norm(e.path) in files }))
  const mount = (surface: (typeof SURFACES)[number]) => $.ui.mount({ ...pane, surface })
  return { mount, store, filled, sent, files, copied: () => copied, opened: () => opened, closed: () => closed, view: () => value }
}

