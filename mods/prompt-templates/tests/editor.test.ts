import { expect, test } from 'claude-code/testing'

import { LIB, SLOW, T, setup } from './fixture'

const ED = 'body-editor'
const typeKeys = async (ui: any, ...keys: any[]) => {
  for (const k of keys) await ui.key({ in: ED, ...(typeof k === 'string' ? { key: k } : k) })
  await ui.redraw()
}
const stored = (f: any, name: string) => (f.store.templates as any[]).find(t => t.name === name)

async function editing($: any, on: any, id = '2', surface: 'terminal' | 'desktop' = 'terminal') {
  const f = setup($, on)
  const ui = await f.mount(surface)
  await ui.press({ key: id ? `edit:${id}` : 'new' })
  await ui.redraw()
  return { ...f, ui }
}

test('New creates a template from name, tags and a multi-line body', SLOW, async ($, on) => {
  const f = await editing($, on, '')
  await f.ui.input({ key: 'edit-name', text: 'Standup', kind: 'change' })
  await f.ui.input({ key: 'edit-tags', text: 'Team, daily', kind: 'change' })
  await typeKeys(f.ui, 'Y', 'e', 's', 'return', 'n', 'o')
  expect(f.store.templates as any[]).toHaveLength(3)
  await f.ui.press({ key: 'edit-save' })
  await f.ui.redraw()
  expect(stored(f, 'Standup')).toMatchObject({ tags: ['team', 'daily'], body: 'Yes\nno' })
  expect(await f.ui.find({ key: 'search' })).toBeDefined()
})

test('Edit loads the template; body edits stay a draft until Save', SLOW, async ($, on) => {
  const f = await editing($, on)
  expect((await f.ui.find({ key: 'edit-name' }))?.props.value).toBe('Mail')
  await typeKeys(f.ui, 'X')
  expect(stored(f, 'Mail').body).toBe('Write a short mail')
  expect(await f.ui.find({ type: 'Text', text: /Unsaved/ })).toBeDefined()
  await f.ui.press({ key: 'edit-save' })
  await f.ui.redraw()
  expect(stored(f, 'Mail').body).toBe('XWrite a short mail')
  expect(stored(f, 'Mail').id).toBe('2')
})

test('Cancel protects unsaved body and name changes; keep editing keeps the draft, discard leaves the store untouched', SLOW, async ($, on) => {
  const f = await editing($, on)
  await f.ui.input({ key: 'edit-name', text: 'Mail 2', kind: 'change' })
  await f.ui.press({ key: 'edit-cancel' })
  await f.ui.redraw()
  await f.ui.press({ key: 'edit-keep' })
  await f.ui.redraw()
  await typeKeys(f.ui, 'X')
  expect(f.view().edit.draft).toBe('XWrite a short mail')
  await f.ui.press({ key: 'edit-cancel' })
  await f.ui.redraw()
  await f.ui.press({ key: 'edit-discard' })
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'search' })).toBeDefined()
  expect(stored(f, 'Mail').body).toBe('Write a short mail')
})

test('Cancel without changes returns at once', SLOW, async ($, on) => {
  const f = await editing($, on)
  await f.ui.press({ key: 'edit-cancel' })
  await f.ui.redraw()
  expect(await f.ui.find({ key: 'search' })).toBeDefined()
})

test('Save refuses an empty or duplicate name and keeps the draft', SLOW, async ($, on) => {
  const f = await editing($, on, '')
  await typeKeys(f.ui, 'B')
  await f.ui.press({ key: 'edit-save' })
  await f.ui.redraw()
  expect(await f.ui.find({ type: 'Text', text: /Name must be/ })).toBeDefined()
  await f.ui.input({ key: 'edit-name', text: 'mail', kind: 'change' })
  await f.ui.press({ key: 'edit-save' })
  await f.ui.redraw()
  expect(await f.ui.find({ type: 'Text', text: /already exists/ })).toBeDefined()
  expect(f.store.templates as any[]).toHaveLength(3)
  expect(f.view().edit.draft).toBe('B')
})

test('clipboard shortcuts edit the draft and Ctrl+S saves without leaving the editor', SLOW, async ($, on) => {
  const f = await editing($, on)
  await typeKeys(f.ui, { key: 'a', ctrl: true }, { key: 'c', ctrl: true })
  expect(f.copied()).toBe('Write a short mail')
  await typeKeys(f.ui, { key: 'x', ctrl: true })
  expect(f.view().edit.draft).toBe('')
  await typeKeys(f.ui, { key: 'v', ctrl: true })
  expect(f.view().edit.draft).toBe('Clipboard\ntext')
  expect(stored(f, 'Mail').body).toBe('Write a short mail')
  await typeKeys(f.ui, { key: 's', ctrl: true })
  expect(stored(f, 'Mail').body).toBe('Clipboard\ntext')
  expect(await f.ui.find({ key: ED })).toBeDefined()
  expect(await f.ui.find({ type: 'Text', text: /Unsaved/ })).toBeUndefined()
})

test('stale editor packets cannot change or save the template', SLOW, async ($, on) => {
  const f = await editing($, on)
  await typeKeys(f.ui, 'X')
  await f.ui.post({ request: f.view().edit.request - 1, instance: 'stale', seq: 1, rows: 20,
    text: 'overwrite', action: 'save', from: 0, to: 0 }, { in: ED })
  await f.ui.redraw()
  expect(f.view().edit.draft).toBe('XWrite a short mail')
  expect(stored(f, 'Mail').body).toBe('Write a short mail')
})

test('closing the pane with unsaved changes asks first', SLOW, async ($, on) => {
  const f = setup($, on)
  const ui = await f.mount('terminal')
  await $.command.run({ command: 'prompts' } as any)
  await ui.press({ key: 'edit:2' })
  await ui.redraw()
  await typeKeys(ui, 'X')
  const toggled = await $.command.run({ command: 'prompts' } as any)
  expect(toggled.text).toMatch(/Save or discard/)
  const filled = await $.command.run({ command: 'prompts', args: 'deploy' } as any)
  expect(filled.text).toMatch(/Save or discard/)
  expect(f.filled).toEqual([])
  await ui.redraw()
  expect(await ui.find({ key: 'edit-discard' })).toBeDefined()
  expect(f.closed()).toBe(0)
})

test('variables found in the body are listed under the editor', SLOW, async ($, on) => {
  const f = await editing($, on, '1')
  expect(await f.ui.find({ type: 'Text', text: /Variables: file, topic/ })).toBeDefined()
})

const PROSE = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'
test('the body starts wrapped; the Wrap button turns wrapping off', SLOW, async ($, on) => {
  const f = setup($, on, [...LIB, T('9', 'Prose', PROSE)])
  const ui = await f.mount('terminal')
  await ui.press({ key: 'edit:9' })
  await ui.redraw()
  await ui.resize({ in: ED, columns: 30, rows: 1 })
  await ui.redraw()
  const seen = async (text: string) => (await ui.find({ in: ED, type: 'Text', text })) !== undefined
  expect(await seen('epsilon zeta')).toBe(true)
  expect(await seen('delta epsilon')).toBe(false)
  await ui.press({ key: 'edit-wrap' })
  await ui.redraw()
  expect(await seen('delta epsilon')).toBe(true)
})

test('desktop draws the body as monospace SVG rows under the editor', SLOW, async ($, on) => {
  const f = await editing($, on, '2', 'desktop')
  await f.ui.redraw()
  expect(await f.ui.find({ type: 'Svg' })).toBeDefined()
  await typeKeys(f.ui, 'X')
  expect(f.view().edit.draft).toBe('XWrite a short mail')
})
