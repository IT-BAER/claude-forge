import { expect, test } from 'claude-code/testing'

import { CWD, OPEN, PANE, world } from './world'

const CLI_OUTPUT = '\u001b[?25l\u001b[32m◇\u001b[39m  Updated 1 skill\r\n\u001b[2K\u001b[1A\u001b[90m└\u001b[39m  \u001b[32mDone\u001b[39m\n\u001b[?25h'

test('the pane still draws after an update whose CLI output holds ANSI codes', async ($, on) => {
  world(on, { stdout: argv => (argv.includes('skills') ? CLI_OUTPUT : '{}') })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'open:user:beta' })
  await ui.press({ key: 'update' })

  const message = await ui.find({ key: 'message' })
  expect(message?.text).toBe('Updated beta. Done')
  expect(await ui.find({ key: 'detail-path' })).toBeDefined()
  await ui.unmount()
})

test('a running update replaces its button with Updating and blocks other updates', async ($, on) => {
  let release: (text: string) => void = () => {}
  const gate = new Promise<string>(resolve => (release = resolve))
  const { ran } = world(on, {
    stdout: argv => (argv.includes('skills') ? gate : '{}'),
    http: { 'https://api.github.com/repos/acme/skills/contents/skills': [{ name: 'beta', type: 'dir', sha: 'ccc333' }] },
  })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'check-updates' })

  const pressing = ui.press({ key: 'update:user:beta' })
  for (let i = 0; i < 50; i++) await Promise.resolve()

  expect((await ui.find({ key: 'updating:user:beta' }))?.text).toBe('Updating…')
  expect(await ui.find({ key: 'update:user:beta' })).toBeUndefined()
  release('Done')
  await pressing
  expect(await ui.find({ key: 'updating:user:beta' })).toBeUndefined()
  expect(ran.filter(run => run.argv.includes('skills'))).toHaveLength(1)
  await ui.unmount()
})
