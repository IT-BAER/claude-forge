import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, HOME, OPEN, PANE, world } from './world'

const start = async ($: Engine) => {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)

  return $.ui.mount({ ...PANE, surface: 'desktop' })
}

const SKILLS = `${HOME}\\.claude\\skills`

test('counts a skill run live and keeps the last-used time', async ($, on) => {
  const { store } = world(on)
  const ui = await start($)
  expect((await ui.find({ key: 'row:user:alpha' }))?.text).toMatch(/^alpha\s*–\s*–$/)

  await $.skill.prompt({ skill: 'alpha', text: 'body', source: 'userSettings' })
  await $.skill.prompt({ skill: 'alpha', text: 'body', source: 'userSettings' })

  expect((await ui.find({ key: 'row:user:alpha' }))?.text).toMatch(/^alpha\s*2\s*\d+m$/)
  const stored = store.usage as Record<string, { count: number }> | undefined
  expect(stored?.alpha?.count).toBe(2)
})

test('delete needs a second press and moves the folder to .trash', async ($, on) => {
  const { ran } = world(on)
  const ui = await start($)

  await ui.press({ key: 'open:user:alpha' })
  expect((await ui.find({ key: 'detail-path' }))?.text).toContain(`${SKILLS}\\alpha`)
  await ui.press({ key: 'delete' })
  expect(ran).toHaveLength(0)
  expect(await ui.find({ key: 'confirm-delete' })).toBeDefined()

  await ui.press({ key: 'confirm-delete' })
  const move = ran.find(run => run.argv.some(arg => arg.endsWith('trash.mjs')))
  expect(move?.argv.slice(0, 1)).toEqual(['node'])
  expect(move?.argv.slice(2)).toEqual([SKILLS, 'alpha'])
})

test('a plugin skill offers a plugin update and no delete', async ($, on) => {
  const { ran } = world(on)
  const ui = await start($)

  await ui.press({ key: 'open:plugin:tools:delta' })
  expect(await ui.find({ key: 'delete' })).toBeUndefined()
  await ui.press({ key: 'update' })

  expect(ran.at(-1)?.argv).toEqual(['claude', 'plugin', 'update', 'tools@market'])
})

test('a GitHub skill updates through the skills CLI', async ($, on) => {
  const { ran } = world(on)
  const ui = await start($)

  await ui.press({ key: 'open:user:beta' })
  expect((await ui.find({ key: 'detail-source' }))?.text).toContain('acme/skills')
  await ui.press({ key: 'update' })

  expect(ran.at(-1)?.argv).toEqual(['cmd', '/d', '/c', 'npx', '-y', 'skills', 'update', 'beta', '-g', '-y'])
  expect(ran.at(-1)?.cwd).toBe(HOME)
})

test('a local skill without a source has no update button', async ($, on) => {
  world(on)
  const ui = await start($)

  await ui.press({ key: 'open:user:alpha' })
  expect(await ui.find({ key: 'update' })).toBeUndefined()
})

test('check updates compares the GitHub tree SHA with the lock hash', async ($, on) => {
  const { fetched, ran } = world(on, {
    http: {
      'https://api.github.com/repos/acme/skills/contents/skills': [
        { name: 'beta', type: 'dir', sha: 'ccc333' },
      ],
    },
  })
  const ui = await start($)

  await ui.press({ key: 'check-updates' })

  expect(fetched).toEqual(['https://api.github.com/repos/acme/skills/contents/skills'])
  expect(await ui.find({ key: 'update:user:alpha' })).toBeUndefined()
  await ui.press({ key: 'update:user:beta' })
  expect(ran.at(-1)?.argv).toContain('update')
  expect(ran.at(-1)?.argv).toContain('beta')
})

test('import history merges transcript counts, slash commands included', async ($, on) => {
  const { ran, store } = world(on, {
    stdout: argv =>
      argv.some(arg => arg.endsWith('usage-scan.mjs'))
        ? JSON.stringify({
            skills: { alpha: { count: 5, last: '2026-10-01T00:00:00.000Z' } },
            commands: {
              gamma: { count: 2, last: '2026-10-02T00:00:00.000Z' },
              clear: { count: 9, last: '2026-10-03T00:00:00.000Z' },
            },
          })
        : '{}',
  })
  const ui = await start($)

  await ui.press({ key: 'import-history' })

  const scan = ran.find(run => run.argv.some(arg => arg.endsWith('usage-scan.mjs')))
  expect(scan?.argv.at(-1)).toBe(`${HOME}\\.claude\\projects`)
  expect((await ui.find({ key: 'row:user:alpha' }))?.text).toMatch(/^alpha\s*5\s*\d+d$/)
  expect((await ui.find({ key: 'row:project:gamma' }))?.text).toMatch(/^gamma\s*2\s*\d+d$/)
  const stored = store.usage as Record<string, unknown> | undefined
  expect(stored?.clear).toBeUndefined()
})

test('column headers sort, a second click reverses, an arrow marks the column', async ($, on) => {
  world(on, {
    http: {
      'https://api.github.com/repos/acme/skills/contents/skills': [{ name: 'beta', type: 'dir', sha: 'ccc333' }],
    },
  })
  const ui = await start($)
  const order = async () =>
    (await ui.findAll({ type: 'Button' }))
      .map(button => button.key ?? '')
      .filter(key => key.startsWith('open:user:'))
  const label = async (key: string) => String((await ui.find({ key }))?.props.label)

  expect(await ui.find({ key: 'sort' })).toBeUndefined()
  expect(await label('sort:uses')).toMatch(/Uses ▼/)
  await ui.press({ key: 'check-updates' })
  expect(await order()).toEqual(['open:user:alpha', 'open:user:beta'])

  await ui.press({ key: 'sort:updates' })
  expect(await order()).toEqual(['open:user:beta', 'open:user:alpha'])
  expect(await label('sort:updates')).toMatch(/▼/)
  expect(await label('sort:uses')).not.toMatch(/[▲▼]/)

  await ui.press({ key: 'sort:name' })
  expect(await order()).toEqual(['open:user:alpha', 'open:user:beta'])
  expect(await label('sort:name')).toMatch(/Name ▲/)
  await ui.press({ key: 'sort:name' })
  expect(await order()).toEqual(['open:user:beta', 'open:user:alpha'])
  expect(await label('sort:name')).toMatch(/Name ▼/)
})
