import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-11T20:00:00Z')
const MIN = 60_000
const TICK = 5 * MIN

type Row = { pid: number; ppid: number; name: string; created: string; cpu: number }
type World = { id?: string; store?: Record<string, unknown>; sessions?: unknown[]; procs?: Row[] }

// Windows FILETIME (100 ns since 1601) as procs.ps1 prints it.
const ft = (ms: number) => String((ms + 11_644_473_600_000) * 10_000)
const row = (pid: number, ppid: number, name: string, ageMin: number, cpu = 0): Row =>
  ({ pid, ppid, name, created: ft(NOW - ageMin * MIN), cpu })
const ago = (min: number) => new Date(NOW - min * MIN).toISOString()

async function start($: any, on: any, w: World) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, w.store ?? {})
  const archived: string[] = []
  const killed: string[] = []
  const runs: { exe: string; cwd?: string }[] = []
  mock.env(on, { SystemRoot: String.raw`C:\Windows` })
  on('session.id', () => ({ value: w.id ?? 'me' }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.log', () => ({ value: undefined }))
  on('mcp.call', (_: any, e: any) => {
    if (e.tool === 'list_sessions') return { value: { isError: false, content: [{ type: 'text', text: JSON.stringify(w.sessions ?? []) }] } }
    archived.push(e.args.session_id)
    return { value: { isError: false, content: [{ type: 'text', text: 'Archived' }] } }
  })
  on('process.run', (_: any, e: any) => {
    runs.push({ exe: e.argv[0], cwd: e.init?.cwd })
    const i = e.argv.indexOf('-Kill')
    if (i >= 0) killed.push(...String(e.argv[i + 1]).split(','))
    const stdout = i >= 0 ? '[]' : JSON.stringify(w.procs ?? [])
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: 'C:/work', surface: null, isInteractive: true })
  return { clock, archived, killed, runs, pids: () => killed.map(k => Number(k.split(':')[0])).sort((a, b) => a - b) }
}

test('archives sessions idle past the limit, never running, pinned or recent ones', async ($, on) => {
  const w: World = {
    sessions: [
      { sessionId: 'old', isArchived: false, isRunning: false, lastActivityAt: ago(90) },
      { sessionId: 'recent', isArchived: false, isRunning: false, lastActivityAt: ago(30) },
      { sessionId: 'busy', isArchived: false, isRunning: true, lastActivityAt: ago(90) },
      { sessionId: 'pinned', isArchived: false, isRunning: false, pinned: true, lastActivityAt: ago(90) },
    ],
  }
  const { clock, archived } = await start($, on, w)
  await clock.advance(TICK)
  expect(archived).toEqual(['old'])
})

test('a second session leaves the work to a live leader and takes over a stale one', async ($, on) => {
  const w: World = {
    id: 'second',
    store: { leader: { id: 'first', at: NOW } },
    sessions: [{ sessionId: 'old', isArchived: false, isRunning: false, lastActivityAt: ago(90) }],
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

test('runs PowerShell by its System32 path, never from the session folder', async ($, on) => {
  const { clock, runs } = await start($, on, { procs: [] })
  await clock.advance(TICK)
  expect(runs.length).toBeGreaterThan(0)
  for (const r of runs) {
    expect(r.exe).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    expect(r.cwd).toBeDefined()
    expect(r.cwd).not.toBe('C:/work')
  }
})
