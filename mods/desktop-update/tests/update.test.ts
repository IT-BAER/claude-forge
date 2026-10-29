import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'desktop-update', component: 'AbovePrompt', props: {} } as const
const NOW = 1_000_000
const HOUR = 3_600_000

function feed(version: string) {
  const url = `https://downloads.claude.ai/releases/win32/x64/${version}/Claude-abc.msix`
  return JSON.stringify({ currentRelease: version, releases: [{ version, updateTo: { version, url, sha256: 'ab'.repeat(32), size: 1 } }] })
}

async function start($: any, on: any, set: (w: any) => void = () => {}) {
  const w = {
    installed: '4.4212.0.0' as string | null,
    feed: { status: 200, text: feed('4.4300.0') },
    installExit: 0,
    fetched: [] as string[],
    ran: [] as string[][],
    toasts: [] as string[],
  }
  set(w)
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('process.run', (_: any, e: any) => {
    w.ran.push([...e.argv])
    if (e.argv.some((a: string) => a.endsWith('install-update.ps1'))) return { value: { exitCode: w.installExit, stdout: '4242', stderr: w.installExit ? 'boom' : '' } }
    if (w.installed === null) return { value: { exitCode: 1, stdout: '', stderr: 'no package' } }
    return { value: { exitCode: 0, stdout: JSON.stringify({ version: w.installed, os: '10.0.26300.0' }), stderr: '' } }
  })
  on('http.fetch', (_: any, e: any) => {
    w.fetched.push(e.url)
    return { value: { status: w.feed.status, ok: w.feed.status === 200, headers: {}, text: w.feed.text } }
  })
  // Stands for the engine's own band beneath the mod
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => { w.toasts.push(e.text); return { value: undefined } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'D:\\p', surface: 'desktop', isInteractive: true })
  return { w, clock }
}

async function line($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const found = await ui.find({ type: 'Text', text: /Claude Desktop/ })
  return { ui, text: found?.text as string | undefined }
}

test('a newer version on the feed shows the update line', async ($, on) => {
  await start($, on)
  const { text } = await line($)
  expect(text).toBe('Claude Desktop 4.4300.0 is available (installed 4.4212.0)')
})

for (const [name, set] of [
  ['the same version', (w: any) => { w.feed.text = feed('4.4212.0') }],
  ['an older version (staged rollout)', (w: any) => { w.feed.text = feed('4.29.0') }],
  ['an HTTP error', (w: any) => { w.feed.status = 500 }],
  ['an answer that is not the known shape', (w: any) => { w.feed.text = '{"currentRelease":"4.4300.0","releases":[]}' }],
  ['no Claude package', (w: any) => { w.installed = null }],
] as const) {
  test(`no line for ${name}`, async ($, on) => {
    await start($, on, set)
    expect((await line($)).text).toBeUndefined()
  })
}

test('the feed query names a stable device id, the 3-part installed version and the OS build', async ($, on) => {
  const { w, clock } = await start($, on)
  await clock.advance(7 * HOUR)
  expect(w.fetched).toHaveLength(2)
  const q = new URL(w.fetched[0]!).searchParams
  expect(q.get('device_id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(q.get('version')).toBe('4.4212.0')
  expect(q.get('os_version')).toBe('10.0.26300.0')
  expect(new URL(w.fetched[1]!).searchParams.get('device_id')).toBe(q.get('device_id'))
})

test('a session started within 6 hours of the last fetch reuses it', async ($, on) => {
  const { w, clock } = await start($, on)
  await clock.advance(HOUR)
  await $.session.start({ cwd: 'D:\\p', surface: 'desktop', isInteractive: true })
  expect(w.fetched).toHaveLength(1)
  expect((await line($)).text).toBe('Claude Desktop 4.4300.0 is available (installed 4.4212.0)')
})

test('a release that appears later shows at the next 6-hour check', async ($, on) => {
  const { w, clock } = await start($, on, (w) => { w.feed.text = feed('4.4212.0') })
  expect((await line($)).text).toBeUndefined()
  w.feed.text = feed('4.4300.0')
  await clock.advance(6 * HOUR)
  expect((await line($)).text).toBe('Claude Desktop 4.4300.0 is available (installed 4.4212.0)')
})

test('later hides this version, and a newer one shows again', async ($, on) => {
  const { w, clock } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'later' })
  expect((await line($)).text).toBeUndefined()
  w.feed.text = feed('4.4400.0')
  await clock.advance(6 * HOUR)
  expect((await line($)).text).toBe('Claude Desktop 4.4400.0 is available (installed 4.4212.0)')
})

test('update asks first; cancel goes back without installing', async ($, on) => {
  const { w } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  expect((await ui.find({ type: 'Text', text: /closes/ }))?.text).toBe('Installing closes every Claude Desktop window and its sessions.')
  await ui.press({ key: 'cancel' })
  expect(await ui.find({ key: 'update' })).toBeDefined()
  expect(w.ran.some((a) => a.some((x) => x.endsWith('install-update.ps1')))).toBe(false)
})

test('install starts the detached installer with the release and the relaunch command', async ($, on) => {
  const { w } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  await ui.press({ key: 'install' })
  const argv = w.ran.find((a) => a.some((x) => x.endsWith('install-update.ps1')))!
  const arg = (name: string) => argv[argv.indexOf(name) + 1]
  expect(argv).toContain('-Detach')
  expect(arg('-Url')).toBe('https://downloads.claude.ai/releases/win32/x64/4.4300.0/Claude-abc.msix')
  expect(arg('-Sha256')).toBe('ab'.repeat(32))
  expect(arg('-Version')).toBe('4.4300.0')
  expect(arg('-Relaunch')).toBe('explorer.exe shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude')
  expect((await ui.find({ type: 'Text', text: /Claude Desktop/ }))?.text).toBe('Installing Claude Desktop 4.4300.0. Desktop closes and starts again.')
  expect(await ui.find({ key: 'install' })).toBeUndefined()
})

test('the relaunch setting replaces the default command', { options: { relaunch: 'wscript.exe "C:\\x\\Launch.vbs" A & wscript.exe "C:\\x\\Launch.vbs" B' } }, async ($, on) => {
  const { w } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  await ui.press({ key: 'install' })
  const argv = w.ran.find((a) => a.some((x) => x.endsWith('install-update.ps1')))!
  expect(argv[argv.indexOf('-Relaunch') + 1]).toBe('wscript.exe "C:\\x\\Launch.vbs" A & wscript.exe "C:\\x\\Launch.vbs" B')
})

test('an installer that does not start says so and offers the update again', async ($, on) => {
  const { w } = await start($, on, (w) => { w.installExit = 1 })
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  await ui.press({ key: 'install' })
  expect(w.toasts[0]).toBe('Could not start the Claude Desktop installer: boom')
  expect(await ui.find({ key: 'update' })).toBeDefined()
})

for (const [name, text] of [
  ['an answer that is not JSON', '<html>gateway</html>'],
  ['a release without updateTo', '{"currentRelease":"4.4300.0","releases":[{"version":"4.4300.0"}]}'],
  ['a download URL on another host', feed('4.4300.0').replace('https://downloads.claude.ai/', 'https://example.com/')],
  ['a download URL with a quote', feed('4.4300.0').replace('Claude-abc.msix', 'Claude-abc.msix\\" -Evil x')],
] as const) {
  test(`no line for ${name}`, async ($, on) => {
    await start($, on, (w) => { w.feed.text = text })
    expect((await line($)).text).toBeUndefined()
  })
}

test('a second install press while installing starts nothing', async ($, on) => {
  const { w } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  const install = ui.press({ key: 'install' })
  await ui.press({ key: 'install' }).catch(() => {})
  await install
  expect(w.ran.filter((a) => a.some((x) => x.endsWith('install-update.ps1')))).toHaveLength(1)
})

test('the installing line clears once the installed version caught up', async ($, on) => {
  const { w, clock } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  await ui.press({ key: 'install' })
  w.installed = '4.4300.0.0'
  await clock.advance(6 * 3_600_000)
  expect((await line($)).text).toBeUndefined()
})

test('an install that never lands offers the update again after 30 minutes', async ($, on) => {
  const { w, clock } = await start($, on)
  const { ui } = await line($)
  await ui.press({ key: 'update' })
  await ui.press({ key: 'install' })
  await clock.advance(10 * 60_000)
  await $.session.start({ cwd: 'D:\\p', surface: 'desktop', isInteractive: true })
  expect((await line($)).text).toMatch(/^Installing/)
  await clock.advance(25 * 60_000)
  await $.session.start({ cwd: 'D:\\p', surface: 'desktop', isInteractive: true })
  expect((await line($)).text).toBe('Claude Desktop 4.4300.0 is available (installed 4.4212.0)')
  expect(w.installed).toBe('4.4212.0.0')
})
