import { expect, mock, test } from 'claude-code/testing'

async function start($: any, on: any, themeText: () => string) {
  const clock = mock.clock(on)
  let value: any = { root: 'C:/project', dirs: { 'C:/project': [] }, open: [], filter: '', picked: '', git: {}, reveal: { dir: '', n: 0 }, pin: '', tick: 0 }
  let version = 0
  on('state.get', () => ({ value: { value, version } }))
  on('state.set', (_: any, e: any) => { value = e.value; return { value: { isSet: true, version: ++version } } })
  on('fs.read', (_: any, e: any) => ({ value: e.path.endsWith('theme.json') ? themeText() : '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.root', () => ({ value: 'C:/project' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:/project', surface: 'desktop', isInteractive: true })
  return { clock, state: () => value }
}

test('a changed theme.json redraws the pane on the next timer tick', async ($, on) => {
  let theme = '{"bgHover":"#111111"}'
  const f = await start($, on, () => theme)
  await f.clock.advance(1500)
  const before = f.state().tick
  theme = '{"bgHover":"#222222"}'
  await f.clock.advance(1500)
  expect(f.state().tick).toBeGreaterThan(before)
})

test('an unchanged theme.json leaves the tree tick alone', async ($, on) => {
  const f = await start($, on, () => '{"bgHover":"#111111"}')
  await f.clock.advance(1500)
  const before = f.state().tick
  await f.clock.advance(3000)
  expect(f.state().tick).toBe(before)
})
