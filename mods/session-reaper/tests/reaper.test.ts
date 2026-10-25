import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-11T20:00:00Z')
const MIN = 60_000
const TICK = 5 * MIN

type Row = { pid: number; ppid: number; name: string; created: string; cpu: number }
// desk: false is a host without the app's ccd_session_mgmt server (CLI, VS Code).
// app: the desktop app's main claude.exe above the session's own (null: none, as under CLI or VS Code).
// me: what get_session reports for the session the mod runs in (list_sessions leaves it out).
type World = { id?: string; self?: Row; app?: Row | null; store?: Record<string, unknown>; sessions?: unknown[]; procs?: Row[]; desk?: boolean; me?: Record<string, unknown> }

// Windows FILETIME (100 ns since 1601) as procs.ps1 prints it.
const ft = (ms: number) => String((ms + 11_644_473_600_000) * 10_000)
const row = (pid: number, ppid: number, name: string, ageMin: number, cpu = 0): Row =>
  ({ pid, ppid, name, created: ft(NOW - ageMin * MIN), cpu })
const ago = (min: number) => new Date(NOW - min * MIN).toISOString()
const owned = (r: Row) => ({ pid: r.pid, created: r.created })
const session = (sessionId: string, idleMin: number, extra: Record<string, unknown> = {}) =>
  ({ sessionId, isArchived: false, isRunning: false, lastActivityAt: ago(idleMin), ...extra })
const APP = row(2, 0, 'claude.exe', 300)
const appKey = (r: Row) => `${r.pid}:${r.created}`

async function start($: any, on: any, w: World) {
  const clock = mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = JSON.parse(JSON.stringify(w.store ?? {}))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(store[e.key])) }))
  on('store.set', (_: any, e: any) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_: any, e: any) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  const archived: string[] = []
  const killed: string[] = []
  const runs: { exe: string; cwd?: string }[] = []
  const self = w.self ?? row(1, 0, 'claude.exe', 200)
  const app = w.app === undefined ? APP : w.app
  mock.env(on, { SystemRoot: String.raw`C:\work\evil` })
  on('session.id', () => ({ value: w.id ?? 'me' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.log', () => ({ value: undefined }))
  on('mcp.call', (_: any, e: any) => {
    const reply = (text: string) => ({ value: { isError: false, content: [{ type: 'text', text }] } })
    if (w.desk === false) return { value: { isError: true, content: [] } }
    if (e.tool === 'list_sessions') return reply(JSON.stringify(w.sessions ?? []))
    if (e.tool === 'get_session') return reply(JSON.stringify({ sessionId: w.id ?? 'me', ...w.me }))
    archived.push(e.args.session_id)
    return reply('Archived')
  })
  on('process.run', (_: any, e: any) => {
    runs.push({ exe: e.argv[0], cwd: e.init?.cwd })
    const i = e.argv.indexOf('-Kill')
    if (i >= 0) killed.push(...String(e.argv[i + 1]).split(','))
    const stdout = i >= 0 ? '[]' : e.argv.includes('-Self') ? JSON.stringify({ ...owned(self), app: app && owned(app) }) : JSON.stringify(w.procs ?? [])
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: 'C:/work', surface: null, isInteractive: true })
  return { clock, store, archived, killed, runs, pids: () => killed.map(k => Number(k.split(':')[0])).sort((a, b) => a - b) }
}

// The activity record a VS Code or CLI session keeps under its own claude.exe.
const cli = (r: Row) => `cli:${r.pid}:${r.created}`
const active = (idleMin: number, extra: Record<string, unknown> = {}) => ({ at: NOW - idleMin * MIN, busy: false, hold: false, ...extra })

test('releases a VS Code or CLI session idle past idleMinutes, its claude.exe included; keeps busy, held and recent ones', async ($, on) => {
  const procs = [
    row(10, 5, 'claude.exe', 120), row(11, 10, 'node.exe', 120), row(12, 11, 'chrome.exe', 120), row(13, 10, 'claude.exe', 120),
    row(20, 5, 'claude.exe', 120), row(21, 20, 'node.exe', 120),
    row(30, 5, 'claude.exe', 120), row(31, 30, 'node.exe', 120),
    row(40, 5, 'claude.exe', 120), row(41, 40, 'node.exe', 120),
  ]
  const w: World = {
    desk: false, app: null, procs,
    store: { [cli(procs[0])]: active(90), [cli(procs[4])]: active(30), [cli(procs[6])]: active(90, { busy: true }), [cli(procs[8])]: active(90, { hold: true }) },
  }
  const { clock, pids, store } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11, 13])
  expect(store[cli(procs[0])]).toBeUndefined()
  expect(store[cli(procs[4])]).toBeDefined()
})

test('a desktop leader releases idle VS Code and CLI sessions too', async ($, on) => {
  const procs = [row(10, 5, 'claude.exe', 120), row(11, 10, 'node.exe', 120)]
  const { clock, pids } = await start($, on, { procs, store: { [cli(procs[0])]: active(90) } })
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11])
})

test('forgets the record of a VS Code or CLI session whose claude.exe ended or whose PID was reused', async ($, on) => {
  const self = row(1, 0, 'claude.exe', 200)
  const gone = { pid: 99, created: ft(NOW - 120 * MIN) }
  const reused = { pid: 10, created: ft(NOW - 120 * MIN) }
  const w: World = {
    desk: false, app: null, self, procs: [self, row(10, 5, 'node.exe', 30)],
    store: { [`cli:${gone.pid}:${gone.created}`]: active(10), [`cli:${reused.pid}:${reused.created}`]: active(90) },
  }
  const { clock, killed, store } = await start($, on, w)
  await clock.advance(TICK)
  expect(killed).toEqual([])
  expect(Object.keys(store).filter(k => k.startsWith('cli:'))).toEqual([cli(self)])
})

test('a VS Code or CLI session records its activity: busy during a turn, held by background work or a wakeup', async ($, on) => {
  const self = row(50, 5, 'claude.exe', 10)
  const w: World = { desk: false, app: null, self, procs: [self] }
  const { clock, store } = await start($, on, w)
  await clock.advance(TICK)
  expect(store[cli(self)]).toEqual({ at: NOW, busy: false, hold: false })

  await clock.advance(TICK)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(store[cli(self)]).toEqual({ at: NOW + 2 * TICK, busy: true, hold: false })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'dev server' }], session_crons: [] })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(store[cli(self)]).toEqual({ at: NOW + 2 * TICK, busy: false, hold: true })

  await clock.advance(TICK)
  await $.turn.start({ text: '', turnId: 't2' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [{ id: 'c1', schedule: '0 * * * *', recurring: true, prompt: 'check' }] })
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(store[cli(self)]).toEqual({ at: NOW + 3 * TICK, busy: false, hold: true })

  await $.turn.start({ text: '', turnId: 't3' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await $.turn.complete({ turnId: 't3', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(store[cli(self)]).toEqual({ at: NOW + 3 * TICK, busy: false, hold: false })
})

test('a subagent turn does not change the activity record', async ($, on) => {
  const self = row(50, 5, 'claude.exe', 10)
  const { clock, store } = await start($, on, { desk: false, app: null, self, procs: [self] })
  await clock.advance(TICK)
  await $.turn.start({ text: 'task', turnId: 'a1', agentId: 'agent-1' })
  expect(store[cli(self)]).toEqual({ at: NOW, busy: false, hold: false })
})

test('a VS Code or CLI session never releases itself', async ($, on) => {
  const self = row(50, 5, 'claude.exe', 200)
  const w: World = { desk: false, app: null, self, procs: [self, row(51, 50, 'node.exe', 200)] }
  const { clock, killed } = await start($, on, w)
  await clock.advance(20 * TICK)
  expect(killed).toEqual([])
})

test('a desktop session keeps no activity record', async ($, on) => {
  const { clock, store } = await start($, on, { procs: [] })
  await clock.advance(TICK)
  expect(Object.keys(store).filter(k => k.startsWith('cli:'))).toEqual([])
})

test('releases idle sessions, pinned included; keeps chrome, running, recent ones and parents of a working side session', async ($, on) => {
  const procs = [
    row(10, 1, 'claude.exe', 120), row(11, 10, 'cmd.exe', 120), row(12, 11, 'node.exe', 120), row(13, 12, 'chrome.exe', 120), row(14, 10, 'claude.exe', 120),
    row(20, 1, 'claude.exe', 120), row(21, 20, 'node.exe', 120),
    row(30, 1, 'claude.exe', 120), row(31, 30, 'node.exe', 120),
    row(40, 1, 'claude.exe', 120), row(41, 40, 'node.exe', 120),
    row(60, 1, 'claude.exe', 120), row(61, 60, 'node.exe', 120),
  ]
  const w: World = {
    procs,
    store: { owned: { old: owned(procs[0]), recent: owned(procs[5]), busy: owned(procs[7]), parent: owned(procs[9]), pinned: owned(procs[11]) } },
    sessions: [
      session('old', 90), session('recent', 30), session('busy', 90, { isRunning: true }),
      session('parent', 90), session('side', 90, { isRunning: true, startedBy: 'parent' }),
      session('pinned', 90, { pinned: true }),
    ],
  }
  const { clock, pids, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11, 12, 14, 60, 61])
  expect(archived).toEqual([])
})

test('never releases the session it runs in while that session is active', async ($, on) => {
  const self = row(50, 1, 'claude.exe', 120)
  const w: World = {
    id: 'me', self,
    procs: [self, row(51, 50, 'node.exe', 120)],
    sessions: [session('me', 90)],
    me: { lastActivityAt: ago(30) },
  }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  expect(killed).toEqual([])
})

test('an idle leader releases the others, then hands the lead on and releases itself last', async ($, on) => {
  const self = row(50, 1, 'claude.exe', 120)
  const procs = [self, row(51, 50, 'node.exe', 120), row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120)]
  const w: World = {
    id: 'me', self, procs,
    store: { owned: { old: owned(procs[2]) } },
    sessions: [session('old', 90)],
    me: { lastActivityAt: ago(90) },
  }
  const { clock, killed, store } = await start($, on, w)
  await clock.advance(TICK)
  expect(killed.map(k => Number(k.split(':')[0]))).toEqual([10, 11, 51, 50])
  expect(store.apps).toEqual({})
})

test('an idle leader keeps itself while running or while its side session works', async ($, on) => {
  const self = row(50, 1, 'claude.exe', 120)
  const w: World = {
    id: 'me', self,
    procs: [self, row(51, 50, 'node.exe', 120)],
    sessions: [session('side', 90, { isRunning: true, startedBy: 'me' })],
    me: { lastActivityAt: ago(90), isRunning: true },
  }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  w.me = { lastActivityAt: ago(90) }
  await clock.advance(TICK)
  expect(killed).toEqual([])
})

test('releases a session stuck at running past stuckMinutes; keeps a running one with recent activity', async ($, on) => {
  const procs = [row(10, 1, 'claude.exe', 900), row(11, 10, 'node.exe', 900), row(20, 1, 'claude.exe', 900), row(21, 20, 'node.exe', 900)]
  const w: World = {
    procs,
    store: { owned: { stuck: owned(procs[0]), running: owned(procs[2]) } },
    sessions: [session('stuck', 800, { isRunning: true }), session('running', 90, { isRunning: true })],
  }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11])
})

test('with stuckMinutes 0, never releases a running session', { options: { stuckMinutes: 0 } }, async ($, on) => {
  const procs = [row(10, 1, 'claude.exe', 900), row(11, 10, 'node.exe', 900)]
  const w: World = { procs, store: { owned: { stuck: owned(procs[0]) } }, sessions: [session('stuck', 800, { isRunning: true })] }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  expect(killed).toEqual([])
})

test('leaves a session alone when its recorded process is gone or its PID was reused', async ($, on) => {
  const w: World = {
    procs: [row(10, 1, 'claude.exe', 30), row(11, 10, 'node.exe', 30)],
    store: { owned: { gone: { pid: 99, created: ft(NOW - 120 * MIN) }, reused: { pid: 10, created: ft(NOW - 120 * MIN) } } },
    sessions: [session('gone', 90), session('reused', 90)],
  }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  expect(killed).toEqual([])
})

test('does not archive unless archiveMinutes is set', async ($, on) => {
  const w: World = { sessions: [session('old', 90)] }
  const { clock, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(archived).toEqual([])
})

test('with archiveMinutes, archives sessions idle past it, never running, pinned or recent ones', { options: { archiveMinutes: 60 } }, async ($, on) => {
  const w: World = {
    sessions: [session('old', 90), session('recent', 30), session('busy', 90, { isRunning: true }), session('pinned', 90, { pinned: true })],
  }
  const { clock, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(archived).toEqual(['old'])
})

test('a second session leaves the work to a live leader of its app and takes over a stale one', { options: { archiveMinutes: 60 } }, async ($, on) => {
  const w: World = {
    id: 'second',
    store: { apps: { [appKey(APP)]: { id: 'first', at: NOW } } },
    sessions: [session('old', 90)],
  }
  const { clock, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(archived).toEqual([])
  await clock.advance(3 * TICK)
  expect(archived).toContain('old')
})

test('releases idle sessions of its own app while another app instance has a live leader', async ($, on) => {
  const other = row(3, 0, 'claude.exe', 300)
  const procs = [row(10, 2, 'claude.exe', 120), row(11, 10, 'node.exe', 120)]
  const w: World = {
    id: 'mine', procs,
    store: { leader: { id: 'theirs', at: NOW, desk: true }, apps: { [appKey(other)]: { id: 'theirs', at: NOW } }, owned: { old: owned(procs[0]) } },
    sessions: [session('old', 90)],
  }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11])
})

test('a desktop session with no app process above it still releases idle sessions', async ($, on) => {
  const procs = [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120)]
  const w: World = { app: null, procs, store: { owned: { old: owned(procs[0]) } }, sessions: [session('old', 90)] }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11])
})

test('a desktop session takes over a live leader that cannot reach the app', async ($, on) => {
  const procs = [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120)]
  const w: World = {
    id: 'desktop',
    procs,
    store: { leader: { id: 'vscode', at: NOW }, owned: { old: owned(procs[0]) } },
    sessions: [session('old', 90)],
  }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  expect(pids()).toEqual([10, 11])
})

test('a session that cannot reach the app leaves a live desktop leader alone, and leads once it is stale', async ($, on) => {
  const w: World = {
    id: 'vscode', desk: false,
    procs: [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120), row(12, 11, 'node.exe', 120)],
    store: { leader: { id: 'desktop', at: NOW, desk: true } },
  }
  const { clock, pids } = await start($, on, w)
  await clock.advance(3 * TICK)
  w.procs = w.procs!.filter(r => r.pid !== 10)
  await clock.advance(TICK)
  expect(pids()).toEqual([11, 12])
})

test('stops an idle tree whose claude.exe ended, keeping chrome.exe', async ($, on) => {
  const w: World = {
    procs: [
      row(10, 1, 'claude.exe', 120), row(11, 10, 'cmd.exe', 120), row(12, 11, 'node.exe', 120, 500),
      row(13, 12, 'bash.exe', 120), row(14, 12, 'chrome.exe', 120),
    ],
  }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  w.procs = w.procs!.filter(r => r.pid !== 10)
  await clock.advance(TICK)
  expect(pids()).toEqual([11, 12, 13])
})

test('keeps trees whose claude.exe still runs', async ($, on) => {
  const w: World = { procs: [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120)] }
  const { clock, killed } = await start($, on, w)
  await clock.advance(3 * TICK)
  expect(killed).toEqual([])
})

test('keeps an orphaned tree younger than the minimum age', async ($, on) => {
  const w: World = { procs: [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120), row(12, 11, 'node.exe', 30)] }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  w.procs = w.procs!.filter(r => r.pid !== 10)
  await clock.advance(2 * TICK)
  expect(killed).toEqual([])
})

test('keeps an orphaned tree that still uses CPU, stops it once idle', async ($, on) => {
  const w: World = { procs: [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120, 0)] }
  const { clock, pids } = await start($, on, w)
  await clock.advance(TICK)
  w.procs = [row(11, 10, 'node.exe', 120, 50_000_000)]
  await clock.advance(TICK)
  expect(pids()).toEqual([])
  await clock.advance(TICK)
  expect(pids()).toEqual([11])
})

test('a reused PID is not taken for a tracked process', async ($, on) => {
  const w: World = { procs: [row(10, 1, 'claude.exe', 120), row(11, 10, 'node.exe', 120)] }
  const { clock, killed } = await start($, on, w)
  await clock.advance(TICK)
  w.procs = [row(11, 999, 'node.exe', 90)]
  await clock.advance(2 * TICK)
  expect(killed).toEqual([])
})

test('runs PowerShell by its fixed System32 path, ignoring SystemRoot and the session folder', async ($, on) => {
  const { clock, runs } = await start($, on, { procs: [] })
  await clock.advance(TICK)
  expect(runs.length).toBeGreaterThan(0)
  for (const r of runs) {
    expect(r.exe).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    expect(r.cwd).toBeDefined()
    expect(r.cwd).not.toBe('C:/work')
  }
})
