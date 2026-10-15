import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-11T20:00:00Z')
const MIN = 60_000
const TICK = 5 * MIN

type Row = { pid: number; ppid: number; name: string; created: string; cpu: number }
type World = { id?: string; self?: Row; store?: Record<string, unknown>; sessions?: unknown[]; procs?: Row[] }

// Windows FILETIME (100 ns since 1601) as procs.ps1 prints it.
const ft = (ms: number) => String((ms + 11_644_473_600_000) * 10_000)
const row = (pid: number, ppid: number, name: string, ageMin: number, cpu = 0): Row =>
  ({ pid, ppid, name, created: ft(NOW - ageMin * MIN), cpu })
const ago = (min: number) => new Date(NOW - min * MIN).toISOString()
const owned = (r: Row) => ({ pid: r.pid, created: r.created })
const session = (sessionId: string, idleMin: number, extra: Record<string, unknown> = {}) =>
  ({ sessionId, isArchived: false, isRunning: false, lastActivityAt: ago(idleMin), ...extra })

async function start($: any, on: any, w: World) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, w.store ?? {})
  const archived: string[] = []
  const killed: string[] = []
  const runs: { exe: string; cwd?: string }[] = []
  const self = w.self ?? row(1, 0, 'claude.exe', 200)
  mock.env(on, { SystemRoot: String.raw`C:\work\evil` })
  on('session.id', () => ({ value: w.id ?? 'me' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.log', () => ({ value: undefined }))
  on('mcp.call', (_: any, e: any) => {
    const reply = (text: string) => ({ value: { isError: false, content: [{ type: 'text', text }] } })
    if (e.tool === 'list_sessions') return reply(JSON.stringify(w.sessions ?? []))
    if (e.tool === 'get_session') return reply(JSON.stringify({ sessionId: w.id ?? 'me' }))
    archived.push(e.args.session_id)
    return reply('Archived')
  })
  on('process.run', (_: any, e: any) => {
    runs.push({ exe: e.argv[0], cwd: e.init?.cwd })
    const i = e.argv.indexOf('-Kill')
    if (i >= 0) killed.push(...String(e.argv[i + 1]).split(','))
    const stdout = i >= 0 ? '[]' : e.argv.includes('-Self') ? JSON.stringify(owned(self)) : JSON.stringify(w.procs ?? [])
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: 'C:/work', surface: null, isInteractive: true })
  return { clock, archived, killed, runs, pids: () => killed.map(k => Number(k.split(':')[0])).sort((a, b) => a - b) }
}

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

test('never releases the session it runs in', async ($, on) => {
  const self = row(50, 1, 'claude.exe', 120)
  const w: World = {
    id: 'me', self,
    procs: [self, row(51, 50, 'node.exe', 120)],
    sessions: [session('me', 90)],
  }
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

test('a second session leaves the work to a live leader and takes over a stale one', { options: { archiveMinutes: 60 } }, async ($, on) => {
  const w: World = {
    id: 'second',
    store: { leader: { id: 'first', at: NOW } },
    sessions: [session('old', 90)],
  }
  const { clock, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(archived).toEqual([])
  await clock.advance(3 * TICK)
  expect(archived).toContain('old')
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
