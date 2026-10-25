import type { EngineInterface as Engine, Register } from 'claude-code'

type Row = { pid: number; ppid: number; name: string; created: string; cpu: number }
type Proc = { pid: number; created: string }
type Tracked = Record<string, { cpu: number }>
// The app's session id -> the claude.exe that session runs in, reported by that session's own mod instance.
type Owned = Record<string, Proc>
type Session = { sessionId: string; isArchived?: boolean; isRunning?: boolean; pinned?: boolean; lastActivityAt?: string; startedBy?: string; title?: string }

const MIN = 60_000
const SERVER = 'ccd_session_mgmt'
// Never stopped: shared browsers, editors, the app itself and the shell.
const SPARED = new Set(['chrome.exe', 'msedge.exe', 'code.exe', 'claude.exe', 'explorer.exe', 'windowsterminal.exe'])
// A released session loses its own claude.exe (the session process and its claude-in-chrome helper).
const SPARED_IN_SESSION = new Set([...SPARED].filter(n => n !== 'claude.exe'))

const key = (r: Proc) => `${r.pid}:${r.created}`
// procs.ps1 prints creation as FILETIME (100 ns since 1601); dropping 4 digits keeps the number exact.
const createdMs = (created: string) => Number(created.slice(0, -4)) - 11_644_473_600_000

type Cfg = { idleMs: number; archiveMs: number; orphanMs: number; cpuIdle: number; intervalMs: number; stuckMs: number }

function log($: Engine, text: string) {
  return $.ui.log(`session-reaper: ${text}`, { to: 'debug' })
}

// Fixed exe path (not SystemRoot, which a project's settings env can set) and the plugin folder as cwd.
// shortcut: assumes Windows in C:\Windows; elsewhere the process steps fail and only archiving runs.
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

function procs($: Engine, args: string[]) {
  const script = `${$.plugin.root}/hooks/procs.ps1`
  return $.process.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { cwd: $.plugin.root, timeoutMs: 60_000 })
}

function text(res: { isError?: boolean; content: readonly unknown[] }) {
  const t = res.content.find(c => (c as { type: string }).type === 'text') as { text: string } | undefined
  return res.isError || !t ? undefined : t.text
}

// Leader for orphan cleanup, shared by every host. desk: the session reaches the app's session tools; a desk
// session takes over a live leader without them. shortcut: last writer wins on a simultaneous takeover.
async function isLeader($: Engine, now: number, cfg: Cfg, desk: boolean) {
  const me = await $.session.id()
  const lead = (await $.store.get('leader')) as { id: string; at: number; desk?: boolean } | undefined
  if (lead && lead.id !== me && now - lead.at < 2.5 * cfg.intervalMs && (lead.desk || !desk)) return false
  await $.store.set('leader', { id: me, at: now, desk })
  return true
}

// Leader for releasing and archiving, one per app instance: list_sessions only returns the caller's own
// app's sessions. app is the instance's main claude.exe; entries of closed instances are pruned on write.
async function isAppLeader($: Engine, now: number, cfg: Cfg, app: string) {
  const me = await $.session.id()
  const apps = ((await $.store.get('apps')) ?? {}) as Record<string, { id: string; at: number }>
  const lead = apps[app]
  if (lead && lead.id !== me && now - lead.at < 2.5 * cfg.intervalMs) return false
  for (const [k, v] of Object.entries(apps)) if (now - v.at >= 2.5 * cfg.intervalMs) delete apps[k]
  apps[app] = { id: me, at: now }
  await $.store.set('apps', apps)
  return true
}

// A session without the app's session tools (VS Code, CLI) keeps its own activity record under
// `cli:<its claude.exe>`, one store key per session so concurrent writers never overwrite each other.
// hold: background tasks or scheduled wakeups that will wake the session later.
type Activity = { at: number; busy: boolean; hold: boolean }
type Me = { proc?: Proc; app?: string; sessionId?: string; act: Activity; saved?: string }
const CLI = 'cli:'

async function saveActivity($: Engine, me: Me) {
  if (!me.proc || me.sessionId) return
  const json = JSON.stringify(me.act)
  if (json === me.saved) return
  await $.store.set(CLI + key(me.proc), me.act)
  me.saved = json
}

async function note($: Engine, me: Me, change: Partial<Activity>) {
  me.act = { ...me.act, ...change, at: await $.clock.now() }
  await saveActivity($, me).catch(err => log($, `activity save failed: ${String(err).slice(0, 200)}`))
}

// Each session publishes its own claude.exe once; the leader needs it to release the session later.
async function reportSelf($: Engine, me: Me) {
  if (!me.proc) {
    const who = await procs($, ['-Self'])
    if (who.exitCode !== 0) return log($, 'self report failed')
    const { pid, created, app } = JSON.parse(who.stdout) as Proc & { app?: Proc | null }
    me.proc = { pid, created }
    me.app = app ? key(app) : 'desk'
  }
  if (!me.sessionId) {
    const got = text(await $.mcp.call(SERVER, 'get_session', { session_id: 'self' }))
    if (!got) return saveActivity($, me)
    me.sessionId = (JSON.parse(got) as Session).sessionId
    // A desktop session whose app tools answered late may have written a record already.
    if (me.saved) await $.store.delete(CLI + key(me.proc))
  }
  const owned = ((await $.store.get('owned')) ?? {}) as Owned
  const have = owned[me.sessionId]
  if (have && have.pid === me.proc.pid && have.created === me.proc.created) return
  owned[me.sessionId] = me.proc
  await $.store.set('owned', owned)
}

async function listSessions($: Engine) {
  const got = text(await $.mcp.call(SERVER, 'list_sessions', { limit: 200 }))
  if (!got) { await log($, 'list_sessions failed'); return [] }
  return JSON.parse(got) as Session[]
}

const idle = (s: Session, now: number, ms: number) => now - Date.parse(s.lastActivityAt ?? '') > ms
// Releasable: idle past the limit; a session the app still shows as running only once stuck past stuckMs (0: never).
const quiet = (s: Session, now: number, cfg: Cfg) =>
  idle(s, now, cfg.idleMs) && (!s.isRunning || (cfg.stuckMs > 0 && idle(s, now, cfg.stuckMs)))

async function archiveIdle($: Engine, now: number, cfg: Cfg, sessions: Session[]) {
  for (const s of sessions) {
    if (s.isArchived || s.isRunning || s.pinned || !idle(s, now, cfg.archiveMs)) continue
    const done = await $.mcp.call(SERVER, 'archive_session', {
      session_id: s.sessionId,
      reason: `idle for ${Math.round((now - Date.parse(s.lastActivityAt ?? '')) / MIN)} min (session-reaper)`,
    })
    log($, `archive ${s.title ?? s.sessionId}: ${done.isError ? 'refused' : 'ok'}`)
  }
}

type Snap = { rows: Row[]; parent: (r: Row) => Row | undefined; tree: (r: Row) => Row[] }
async function snapshot($: Engine): Promise<Snap | undefined> {
  const snap = await procs($, [])
  if (snap.exitCode !== 0) { await log($, `snapshot failed: ${snap.stderr.slice(0, 200)}`); return }
  const rows = JSON.parse(snap.stdout) as Row[]
  const byPid = new Map(rows.map(r => [r.pid, r]))
  // A parent counts only if it is older than the child; a younger one reused the PID.
  const parent = (r: Row) => {
    const p = byPid.get(r.ppid)
    return p && p.pid !== r.pid && createdMs(p.created) <= createdMs(r.created) ? p : undefined
  }
  const children = new Map<number, Row[]>()
  for (const r of rows) {
    const p = parent(r)
    if (p) children.set(p.pid, [...(children.get(p.pid) ?? []), r])
  }
  const tree = (r: Row): Row[] => [r, ...(children.get(r.pid) ?? []).flatMap(tree)]
  return { rows, parent, tree }
}

// Stops the process tree of each idle session. The session stays in the sidebar; the app starts
// a fresh process when it is opened again.
async function releaseIdle($: Engine, now: number, cfg: Cfg, sessions: Session[], me: string | undefined) {
  const owned = ((await $.store.get('owned')) ?? {}) as Owned
  const snap = await snapshot($)
  if (!snap) return
  const live = new Map(snap.rows.map(r => [key(r), r]))
  // A session whose side session still works is kept: the side session reports back to it.
  const parents = new Set(sessions.filter(s => s.isRunning && s.startedBy).map(s => s.startedBy))
  const kill: Row[] = []
  let changed = false
  for (const [id, proc] of Object.entries(owned)) {
    const root = live.get(key(proc))
    if (!root || root.name.toLowerCase() !== 'claude.exe') { delete owned[id]; changed = true; continue }
    const s = sessions.find(x => x.sessionId === id)
    if (!s || id === me || s.isArchived || parents.has(id) || !quiet(s, now, cfg)) continue
    const members = snap.tree(root).filter(r => !SPARED_IN_SESSION.has(r.name.toLowerCase()))
    kill.push(...members)
    delete owned[id]
    changed = true
    log($, `release ${s.title ?? id}: ${members.length} processes`)
  }
  if (changed) await $.store.set('owned', owned)
  if (!kill.length) return
  const res = await procs($, ['-Kill', kill.map(key).join(',')])
  log($, `released ${kill.map(r => `${r.name}(${r.pid})`).join(' ')}: ${res.stdout.slice(0, 300)}`)
}

// list_sessions leaves out the caller, so the app leader judges itself by get_session. Once idle it hands the
// lead on and stops its own tree, its claude.exe last; the next active session of the app leads.
async function releaseSelf($: Engine, now: number, cfg: Cfg, sessions: Session[], me: Me) {
  if (me.act.busy || !me.proc || !me.app || !me.sessionId) return
  if (sessions.some(s => s.isRunning && s.startedBy === me.sessionId)) return
  const got = text(await $.mcp.call(SERVER, 'get_session', { session_id: 'self' }))
  if (!got) return
  const s = JSON.parse(got) as Session
  if (s.isArchived || !quiet(s, now, cfg)) return
  const snap = await snapshot($)
  const root = snap?.rows.find(r => key(r) === key(me.proc!))
  if (!snap || !root) return
  const apps = ((await $.store.get('apps')) ?? {}) as Record<string, unknown>
  delete apps[me.app]
  await $.store.set('apps', apps)
  const owned = ((await $.store.get('owned')) ?? {}) as Owned
  delete owned[me.sessionId]
  await $.store.set('owned', owned)
  const members = snap.tree(root).slice(1).filter(r => !SPARED_IN_SESSION.has(r.name.toLowerCase()))
  await log($, `release self ${s.title ?? me.sessionId}: ${members.length + 1} processes`)
  await procs($, ['-Kill', [...members, root].map(key).join(',')])
}

// Stops the whole tree of each VS Code or CLI session idle past the limit, its claude.exe included:
// those hosts have no sidebar that keeps the session, so the conversation continues only by resuming it.
async function releaseCli($: Engine, now: number, cfg: Cfg, snap: Snap, mine: Proc | undefined) {
  const live = new Map(snap.rows.map(r => [key(r), r]))
  const kill: Row[] = []
  for (const k of (await $.store.keys()).filter(k => k.startsWith(CLI))) {
    const id = k.slice(CLI.length)
    const root = live.get(id)
    if (!root || root.name.toLowerCase() !== 'claude.exe') { await $.store.delete(k); continue }
    const a = (await $.store.get(k)) as Activity | undefined
    if (!a || a.busy || a.hold || (mine && id === key(mine)) || now - a.at < cfg.idleMs) continue
    const members = snap.tree(root).filter(r => !SPARED_IN_SESSION.has(r.name.toLowerCase()))
    kill.push(...members)
    await $.store.delete(k)
    log($, `release cli ${id}: ${members.length} processes, idle ${Math.round((now - a.at) / MIN)} min`)
  }
  if (!kill.length) return
  const res = await procs($, ['-Kill', kill.map(key).join(',')])
  log($, `released ${kill.map(r => `${r.name}(${r.pid})`).join(' ')}: ${res.stdout.slice(0, 300)}`)
}

async function stopOrphans($: Engine, now: number, cfg: Cfg, snap: Snap) {
  const { rows, parent, tree } = snap
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

async function tick($: Engine, cfg: Cfg, me: Me) {
  const now = await $.clock.now()
  try { await reportSelf($, me) } catch (err) { log($, `self report failed: ${String(err).slice(0, 200)}`) }
  if (me.sessionId && me.app && (await isAppLeader($, now, cfg, me.app))) {
    const sessions = await listSessions($)
    if (cfg.archiveMs) try { await archiveIdle($, now, cfg, sessions) } catch (err) { log($, `archive failed: ${String(err).slice(0, 200)}`) }
    try { await releaseIdle($, now, cfg, sessions, me.sessionId) } catch (err) { log($, `release failed: ${String(err).slice(0, 200)}`) }
    try { await releaseSelf($, now, cfg, sessions, me) } catch (err) { log($, `self release failed: ${String(err).slice(0, 200)}`) }
  }
  if (!(await isLeader($, now, cfg, !!me.sessionId))) return
  const snap = await snapshot($)
  if (!snap) return
  try { await releaseCli($, now, cfg, snap, me.proc) } catch (err) { log($, `cli release failed: ${String(err).slice(0, 200)}`) }
  try { await stopOrphans($, now, cfg, snap) } catch (err) { log($, `orphans failed: ${String(err).slice(0, 200)}`) }
}

export const register: Register = (on, options) => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  const idleMs = num(options.idleMinutes, 60) * MIN
  const archiveMs = num(options.archiveMinutes, 0) * MIN
  const orphanMs = num(options.orphanMinutes, 60) * MIN
  const cpuIdle = num(options.cpuIdleMs, 1000) * 10_000
  const intervalMs = num(options.intervalMinutes, 5) * MIN
  const stuckMs = (typeof options.stuckMinutes === 'number' && options.stuckMinutes >= 0 ? options.stuckMinutes : 720) * MIN
  const cfg: Cfg = { idleMs, archiveMs, orphanMs, cpuIdle, intervalMs, stuckMs }
  const me: Me = { act: { at: 0, busy: false, hold: false } }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    me.act.at = await $.clock.now()
    void reportSelf($, me).catch(err => log($, `self report failed: ${String(err).slice(0, 200)}`))
    $.clock.every(intervalMs, () => void tick($, cfg, me))
    return started
  })
  // Main loop only: a subagent's run happens inside a main turn or is a background task Stop reports.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await note($, me, { busy: true })
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await note($, me, { busy: false })
    return done
  })
  on('classic.Stop', async ($, e, next) => {
    await note($, me, { hold: !!(e.background_tasks?.length || e.session_crons?.length) })
    return next(e)
  })
}
