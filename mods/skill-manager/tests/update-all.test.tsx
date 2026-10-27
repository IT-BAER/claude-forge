import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { baseFiles, CWD, HOME, OPEN, PANE, world } from './world'

const LOCK = `${HOME}\\.agents\\.skill-lock.json`
const CONTENTS = 'https://api.github.com/repos/acme/skills/contents/skills'
const UPSTREAM = { [CONTENTS]: [{ name: 'beta', type: 'dir', sha: 'new1' }, { name: 'epsilon', type: 'dir', sha: 'new2' }] }

/** beta and epsilon come from acme/skills; both have a newer tree upstream. */
const twoGithubSkills = () => {
  const files = baseFiles()
  const lock = JSON.parse(String(files[LOCK]))
  lock.skills.epsilon = { ...lock.skills.beta, skillPath: 'skills/epsilon/SKILL.md', skillFolderHash: 'eee555' }
  files[LOCK] = JSON.stringify(lock)
  files[`${HOME}\\.claude\\skills\\epsilon`] = null
  files[`${HOME}\\.claude\\skills\\epsilon\\SKILL.md`] = '---\nname: epsilon\ndescription: Epsilon from GitHub\n---\n'

  return files
}

const isSkillsCli = (argv: readonly string[]) => argv.includes('skills')

const openChecked = async ($: Engine) => {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'check-updates' })

  return ui
}

test('update all updates every pending skill of a lock in one CLI run and reports failures', async ($, on) => {
  const { ran } = world(on, {
    files: twoGithubSkills(),
    http: UPSTREAM,
    stdout: argv => (isSkillsCli(argv) ? '  ✓ Updated beta\n  ✗ Failed to update epsilon\n' : '{}'),
    exit: argv => (isSkillsCli(argv) ? 1 : 0),
  })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ key: 'update-all' })).toBeUndefined()
  await ui.press({ key: 'check-updates' })
  await ui.press({ key: 'update-all' })

  const runs = ran.filter(run => isSkillsCli(run.argv))
  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv).toEqual(['cmd', '/d', '/c', 'npx', '-y', 'skills', 'update', 'beta', 'epsilon', '-g', '-y'])
  expect((await ui.find({ key: 'message' }))?.text).toBe('Updated 1 of 2, failed: epsilon (exit 1).')
  expect(await ui.find({ key: 'update:user:beta' })).toBeUndefined()
  expect(await ui.find({ key: 'update:user:epsilon' })).toBeDefined()
  await ui.unmount()
})

test('check updates compares upstream with the lock on disk, not the lock seen when the pane opened', async ($, on) => {
  const files = baseFiles()
  files[LOCK] = String(files[LOCK]).replace('aaa111', 'new1')
  const { files: disk } = world(on, { files, http: UPSTREAM })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The skills CLI or another tool rewrites the lock while the pane is open.
  disk[LOCK] = String(disk[LOCK]).replace('new1', 'old0')
  await ui.press({ key: 'check-updates' })

  expect((await ui.find({ key: 'message' }))?.text).toBe('Update check done: 1 update(s) available.')
  expect(await ui.find({ key: 'update:user:beta' })).toBeDefined()
  await ui.unmount()
})

test('update runs fail fast on a missing repo: no git login prompt, a clone limit and a run limit', async ($, on) => {
  const { ran } = world(on, { files: twoGithubSkills(), http: UPSTREAM, stdout: argv => (isSkillsCli(argv) ? '✓ Updated beta\n✓ Updated epsilon' : '{}') })
  const ui = await openChecked($)
  await ui.press({ key: 'update-all' })

  const run = ran.find(one => isSkillsCli(one.argv))
  expect(run?.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', SKILLS_CLONE_TIMEOUT_MS: '60000' })
  // One source repo: 30 s for npx plus 60 s for its clone.
  expect(run?.timeoutMs).toBe(90_000)
  expect((await ui.find({ key: 'message' }))?.text).toBe('Updated 2 of 2.')
  await ui.unmount()
})

test('a run that times out marks its skills failed and keeps their Update buttons', async ($, on) => {
  world(on, {
    files: twoGithubSkills(),
    http: UPSTREAM,
    stdout: argv => (isSkillsCli(argv) ? Promise.reject(new Error('timed out after 90000 ms')) : '{}'),
  })
  const ui = await openChecked($)
  await ui.press({ key: 'update-all' })

  expect((await ui.find({ key: 'message' }))?.text).toMatch(/^Updated 0 of 2, failed: beta, epsilon \(.*timed out after 90000 ms.*\)\.$/)
  expect(await ui.find({ key: 'update:user:beta' })).toBeDefined()
  expect(await ui.find({ key: 'update:user:epsilon' })).toBeDefined()
  await ui.unmount()
})

test('while update all runs, every pending row shows Updating and other actions wait', async ($, on) => {
  let release: (text: string) => void = () => {}
  const gate = new Promise<string>(resolve => (release = resolve))
  const { ran } = world(on, { files: twoGithubSkills(), http: UPSTREAM, stdout: argv => (isSkillsCli(argv) ? gate : '{}') })
  const ui = await openChecked($)

  const pressing = ui.press({ key: 'update-all' })
  for (let i = 0; i < 50; i++) await Promise.resolve()

  expect((await ui.find({ key: 'updating:user:beta' }))?.text).toBe('Updating…')
  expect((await ui.find({ key: 'updating:user:epsilon' }))?.text).toBe('Updating…')
  await ui.press({ key: 'refresh' })
  release('✓ Updated beta\n✓ Updated epsilon')
  await pressing
  expect(ran.filter(run => isSkillsCli(run.argv))).toHaveLength(1)
  expect(await ui.find({ key: 'update-all' })).toBeUndefined()
  await ui.unmount()
})
