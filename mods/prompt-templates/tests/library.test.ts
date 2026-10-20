import { expect, test } from 'claude-code/testing'

import { LIB, SLOW, T, setup } from './fixture'

const FILE = 'C:/Users/me/.claude/prompt-templates.json'
const LIBRARY = { ...SLOW, options: { libraryFile: '~/.claude/prompt-templates.json' } }
const names = (text: string | undefined) => JSON.parse(text!).templates.map((t: any) => t.name)

test('with libraryFile set and no file yet, the store templates are written to the file once and kept in the store', LIBRARY, async ($, on) => {
  const f = setup($, on)
  const ui = await f.mount('desktop')
  expect(names(f.files[FILE])).toEqual(['Deploy', 'Mail', 'Review'])
  const saved = JSON.parse(f.files[FILE]!)
  expect(saved.version).toBe(1)
  expect(saved.templates[0]).toEqual({ id: '3', name: 'Deploy', tags: ['dev', 'ops'], body: 'Ship it', updatedAt: 1 })
  expect(f.store.templates).toHaveLength(3)
  expect(await ui.find({ key: 'fill:1' })).toBeDefined()
})

test('with libraryFile set, the pane reads the file and changes go to the file, not the store', LIBRARY, async ($, on) => {
  const f = setup($, on)
  f.files[FILE] = JSON.stringify({ version: 1, templates: [T('9', 'Only', 'From file'), T('8', 'Other', 'x')] })
  const ui = await f.mount('terminal')
  expect(await ui.find({ key: 'fill:9' })).toBeDefined()
  expect(await ui.find({ key: 'fill:1' })).toBeUndefined()
  await ui.press({ key: 'delete:8' })
  await ui.redraw()
  await ui.press({ key: 'delete-confirm' })
  await ui.redraw()
  expect(names(f.files[FILE])).toEqual(['Only'])
  expect(f.store.templates).toEqual(LIB)
})

test('an invalid library file shows an error and is never overwritten', LIBRARY, async ($, on) => {
  const f = setup($, on)
  f.files[FILE] = '{ "templates": [ { "name": "x" '
  const ui = await f.mount('desktop')
  expect(await ui.find({ type: 'Text', text: /prompt-templates\.json.*not valid JSON/ })).toBeDefined()
  expect(f.files[FILE]).toBe('{ "templates": [ { "name": "x" ')
})

test('without libraryFile, the store stays the library and no file is written', SLOW, async ($, on) => {
  const f = setup($, on)
  const ui = await f.mount('desktop')
  await ui.press({ key: 'delete:2' })
  await ui.redraw()
  await ui.press({ key: 'delete-confirm' })
  expect(FILE in f.files).toBe(false)
  expect(f.store.templates).toHaveLength(2)
})
