import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { baseFiles, CWD, HOME, OPEN, PANE, world } from './world'

const start = async ($: Engine) => {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
}

test('groups skills by scope, plugin skills under their plugin', async ($, on) => {
  world(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ key: 'section:user' }))?.text).toBe('User (2)')
    expect((await ui.find({ key: 'section:project' }))?.text).toBe('Project (1)')
    expect((await ui.find({ key: 'section:plugin:tools' }))?.text).toBe('Plugin tools (1)')
    expect((await ui.find({ key: 'open:user:alpha' }))?.props.label).toBe('alpha')
    expect((await ui.find({ key: 'open:plugin:tools:delta' }))?.props.label).toBe('delta')
    expect((await ui.find({ key: 'row:user:alpha' }))?.text).not.toMatch(/user|local/)
    expect(await ui.find({ key: 'row:user:old' })).toBeUndefined()
    expect(await ui.find({ key: 'row:user:synced' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a narrow pane cuts long names so a row stays one line', async ($, on) => {
  const long = 'a-very-long-skill-name-that-does-not-fit-the-pane'
  const files = {
    ...baseFiles(),
    [`${HOME}\\.claude\\skills\\${long}`]: null,
    [`${HOME}\\.claude\\skills\\${long}\\SKILL.md`]: `---\nname: ${long}\n---\n`,
  }
  world(on, { files })
  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30 } })
  const label = String((await ui.find({ key: `open:user:${long}` }))?.props.label)

  expect(label.length).toBeLessThanOrEqual(22)
  expect(label.endsWith('…')).toBe(true)
  await ui.unmount()
})
