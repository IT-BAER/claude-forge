import type { EngineInterface as Engine, Register } from 'claude-code'

type Row = { pid: number; ppid: number; name: string; created: string; cpu: number }
type Tracked = Record<string, { cpu: number }>
type Session = { sessionId: string; title?: string; isArchived?: boolean; isRunning?: boolean; pinned?: boolean; lastActivityAt?: string }

const MIN = 60_000
const SERVER = 'ccd_session_mgmt'
// Never stopped: shared browsers, editors, the app itself and the shell.
const SPARED = new Set(['chrome.exe', 'msedge.exe', 'code.exe', 'claude.exe', 'explorer.exe', 'windowsterminal.exe'])

const key = (r: Row) => `${r.pid}:${r.created}`
// procs.ps1 prints creation as FILETIME (100 ns since 1601); dropping 4 digits keeps the number exact.
const createdMs = (created: string) => Number(created.slice(0, -4)) - 11_644_473_600_000

type Cfg = { idleMs: number; orphanMs: number; cpuIdle: number; intervalMs: number }

function log($: Engine, text: string) {
  return $.ui.log(`session-reaper: ${text}`, { to: 'debug' })
}

// Absolute exe and the plugin's own folder as cwd: a bare name would also resolve from the session's folder.
async function procs($: Engine, args: string[]) {
  const root = (await $.env.get('SystemRoot')) ?? 'C:\\Windows'
  const exe = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  const script = `${$.plugin.root}/hooks/procs.ps1`
  return $.process.run([exe, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { cwd: $.plugin.root, timeoutMs: 60_000 })
}

// shortcut: last writer wins on a simultaneous takeover; harmless, both act on the same state.
async function isLeader($: Engine, now: number, cfg: Cfg) {
  const me = await $.session.id()
  const lead = (await $.store.get('leader')) as { id: string; at: number } | undefined
  if (lead && lead.id !== me && now - lead.at < 2.5 * cfg.intervalMs) return false
  await $.store.set('leader', { id: me, at: now })
  return true
}

async function archiveIdle($: Engine, now: number, cfg: Cfg) {
  const listed = await $.mcp.call(SERVER, 'list_sessions', { limit: 200 })
  const text = listed.content.find(c => c.type === 'text') as { text: string } | undefined
  if (listed.isError || !text) return log($, 'list_sessions failed')
  const sessions = JSON.parse(text.text) as Session[]
  for (const s of sessions) {
    const last = Date.parse(s.lastActivityAt ?? '')
    if (s.isArchived || s.isRunning || s.pinned || !(now - last > cfg.idleMs)) continue
    const done = await $.mcp.call(SERVER, 'archive_session', {
      session_id: s.sessionId,
      reason: `idle for ${Math.round((now - last) / MIN)} min (session-reaper)`,
    })
    log($, `archive ${s.title ?? s.sessionId}: ${done.isError ? 'refused' : 'ok'}`)
  }
}

async function stopOrphans($: Engine, now: number, cfg: Cfg) {
  const snap = await procs($, [])
  if (snap.exitCode !== 0) return log($, `snapshot failed: ${snap.stderr.slice(0, 200)}`)
  const rows = JSON.parse(snap.stdout) as Row[]
  const byPid = new Map(rows.map(r => [r.pid, r]))
  // A parent counts only if it is older than the child; a younger one reused the PID.
  const parent = (r: Row) => {
    const p = byPid.get(r.ppid)
    return p && p.pid !== r.pid && createdMs(p.created) <= createdMs(r.created) ? p : undefined
  }
  const underClaude = (r: Row) => {
    for (let p = parent(r), hops = 0; p && hops < 64; p = parent(p), hops++) if (p.name.toLowerCase() === 'claude.exe') return true
    return false
  }

  const before = ((await $.store.get('tracked')) ?? {}) as Tracked
  const tracked: Tracked = {}
  const orphans = new Map<string, Row>()
  for (const r of rows) {
    if (r.name.toLowerCase() === 'claude.exe') continue
    if (underClaude(r)) tracked[key(r)] = { cpu: r.cpu }
    else if (before[key(r)]) { tracked[key(r)] = { cpu: r.cpu }; orphans.set(key(r), r) }
  }
  await $.store.set('tracked', tracked)

  const children = new Map<number, Row[]>()
  for (const r of orphans.values()) {
    const p = parent(r)
    if (p) children.set(p.pid, [...(children.get(p.pid) ?? []), r])
  }
  const tree = (r: Row): Row[] => [r, ...(children.get(r.pid) ?? []).flatMap(tree)]
  const isIdle = (r: Row) =>
    SPARED.has(r.name.toLowerCase()) ||
    (now - createdMs(r.created) >= cfg.orphanMs && r.cpu - before[key(r)]!.cpu <= cfg.cpuIdle)

  const kill: Row[] = []
  for (const root of orphans.values()) {
    const p = parent(root)
    if (p && orphans.has(key(p))) continue
    const members = tree(root)
    if (members.every(isIdle)) kill.push(...members.filter(m => !SPARED.has(m.name.toLowerCase())))
  }
  if (!kill.length) return
  const res = await procs($, ['-Kill', kill.map(key).join(',')])
  log($, `stopped ${kill.map(r => `${r.name}(${r.pid})`).join(' ')}: ${res.stdout.slice(0, 300)}`)
}

async function tick($: Engine, cfg: Cfg) {
  const now = await $.clock.now()
  if (!(await isLeader($, now, cfg))) return
  try { await archiveIdle($, now, cfg) } catch (err) { log($, `archive failed: ${String(err).slice(0, 200)}`) }
  try { await stopOrphans($, now, cfg) } catch (err) { log($, `orphans failed: ${String(err).slice(0, 200)}`) }
}

export const register: Register = (on, options) => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  const idleMs = num(options.idleMinutes, 60) * MIN
  const orphanMs = num(options.orphanMinutes, 60) * MIN
  const cpuIdle = num(options.cpuIdleMs, 1000) * 10_000
  const intervalMs = num(options.intervalMinutes, 5) * MIN
  const cfg: Cfg = { idleMs, orphanMs, cpuIdle, intervalMs }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(intervalMs, () => void tick($, cfg))
    return started
  })
}
