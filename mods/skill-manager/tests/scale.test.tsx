import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { baseFiles, CWD, HOME, OPEN, PANE, world } from './world'

// A surface unmounts a tree past 100,000 serialized characters ("Nothing to show yet").
const TREE_BOUND = 100_000
const desc = 'Use when the user asks for this kind of task; covers the workflow, the gotchas and the checks.'

const bigInventory = (user: number, plugins: number) => {
  const files: Record<string, string | null> = { ...baseFiles() }
  for (let i = 0; i < user; i++) {
    const name = `user-skill-number-${String(i).padStart(3, '0')}-workflow`
    files[`${HOME}\\.claude\\skills\\${name}`] = null
    files[`${HOME}\\.claude\\skills\\${name}\\SKILL.md`] = `---\nname: ${name}\ndescription: ${desc}\n---\n`
  }
  const installed: Record<string, unknown> = {}
  for (let i = 0; i < plugins; i++) {
    const plugin = `plugin-with-long-name-${i}`
    const dir = `${HOME}\\.claude\\plugins\\cache\\m\\${plugin}\\1`
    installed[`${plugin}@m`] = [{ scope: 'user', installPath: dir, version: '1', lastUpdated: '2026-10-01T00:00:00.000Z' }]
    files[`${dir}\\skills`] = null
    files[`${dir}\\skills\\skill-${i}-debugging-tools`] = null
    files[`${dir}\\skills\\skill-${i}-debugging-tools\\SKILL.md`] = `---\nname: skill-${i}-debugging-tools\n---\n`
  }
  files[`${HOME}\\.claude\\plugins\\installed_plugins.json`] = JSON.stringify({ version: 2, plugins: installed })

  return files
}

const mountBig = async ($: Engine, bodyRows = 54) => {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const props = (offset: number) => ({ ...PANE.props, scroll: { offset, bodyRows } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: props(0) })
  const size = async () => JSON.stringify(await ui.drawn()).length
  const height = async (key: string) => Number((await ui.find({ key }))?.props.height ?? 0)
  const drawnRows = async () => (await ui.findAll({ type: 'Box' })).filter(box => /^(row|section):/.test(String(box.key))).length

  return { ui, size, height, drawnRows, scrollTo: (offset: number) => ui.redraw(props(offset)) }
}

test('a large inventory draws only the rows around the scroll offset, with no pages', async ($, on) => {
  world(on, { files: bigInventory(400, 40) })
  const { ui, size, scrollTo } = await mountBig($)

  expect(await size()).toBeLessThan(TREE_BOUND)
  expect((await ui.find({ key: 'section:user' }))?.text).toBe('User (402)')
  expect(await ui.find({ key: 'row:user:alpha' })).toBeDefined()
  expect(await ui.find({ key: 'row:user:user-skill-number-399-workflow' })).toBeUndefined()
  expect(await ui.find({ key: 'page-next' })).toBeUndefined()

  for (let offset = 0; offset <= 600; offset += 37) {
    await scrollTo(offset)
    expect(await size()).toBeLessThan(TREE_BOUND)
  }
  expect(await ui.find({ key: 'row:plugin:plugin-with-long-name-9:skill-9-debugging-tools' })).toBeDefined()
  expect(await ui.find({ key: 'row:user:alpha' })).toBeUndefined()

  await scrollTo(0)
  expect(await ui.find({ key: 'row:user:alpha' })).toBeDefined()
  await ui.unmount()
})

test('spacers keep the list the same height wherever the window sits', async ($, on) => {
  world(on, { files: bigInventory(400, 40) })
  const { ui, height, drawnRows, scrollTo } = await mountBig($)
  const total = async () => (await height('spacer-above')) + (await drawnRows()) + (await height('spacer-below'))

  const atTop = await total()
  expect(await height('spacer-above')).toBe(0)
  expect(await height('spacer-below')).toBeGreaterThan(300)
  await scrollTo(250)
  expect(await height('spacer-above')).toBeGreaterThan(0)
  expect(await total()).toBe(atTop)
  await ui.unmount()
})

test('a very tall pane still stays under the tree bound', async ($, on) => {
  world(on, { files: bigInventory(400, 40) })
  const { ui, size } = await mountBig($, 400)

  expect(await size()).toBeLessThan(TREE_BOUND)
  await ui.unmount()
})
