// Pure logic: reads the cache-status mod's live files and formats them.
// No vscode import here, so node --test covers it.
const fs = require('node:fs')
const path = require('node:path')

const MIN = 60000
const STALE_MS = 60 * MIN // the mod drops heartbeats older than this too
const ALIVE_MS = 2 * MIN // a running session rewrites its file at least every 30 seconds
const LIMIT_LABEL = { five_hour: '5h', seven_day: 'w', spend_limit: 'spend' }

function tokens(n) {
  const v = Number(n) || 0
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'k'
  return String(Math.round(v))
}

function usd(n) {
  const v = Number(n) || 0
  if (v === 0) return '$0'
  if (v < 0.01) return '<$0.01'
  if (v < 10) return '$' + v.toFixed(2)
  return '$' + v.toFixed(0)
}

function minutes(ms) {
  const m = Math.round((Number(ms) || 0) / MIN)
  if (m <= 60) return m + 'm'
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'
}

function readLive(dir, now) {
  let names
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const list = []
  for (const name of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (!s || !s.id || s.ended || now - (s.updatedAt || 0) > STALE_MS) continue
      list.push(s)
    } catch {
      // half-written or broken file: skip until the next read
    }
  }
  return list
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// This window's session: cwd equals a workspace folder and the file is still
// being written (a reload kills a chat without marking its file ended); a VS
// Code session wins over a terminal or desktop one, then the newest activity.
function pickSession(list, folders, now) {
  const want = new Set(folders.map(normPath))
  const mine = list.filter((s) => want.has(normPath(s.cwd)) && now - (s.updatedAt || 0) <= ALIVE_MS)
  const rank = (s) => [(s.surfaces || []).includes('vscode') ? 1 : 0, s.lastActivity || 0, s.updatedAt || 0]
  mine.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]
    return 0
  })
  return mine[0]
}

function cacheState(s, now) {
  if (!s.lastActivity) return { kind: 'unknown', left: 0 }
  const left = (s.ttlMin || 60) * MIN - (now - s.lastActivity)
  if (s.keepWarm) return { kind: 'kept', left }
  if (left <= 0) return { kind: 'cold', left }
  if (left <= 5 * MIN) return { kind: 'cooling', left }
  return { kind: 'warm', left }
}

function limitsText(limits) {
  return limits.map((l) => `${LIMIT_LABEL[l.kind] || l.kind} ${Math.round(l.percentUsed || 0)}%`).join(' · ')
}

function render(s, now) {
  const st = cacheState(s, now)
  const big = (s.ctx || 0) >= (s.bigTokens || 150000)
  const money = (v) => (s.masked ? '$•••' : usd(v))
  const head = {
    kept: '◆ kept warm',
    warm: `● c ${minutes(st.left)}`,
    cooling: `◐ c ${minutes(st.left)}`,
    cold: `○ c cold ${minutes(-st.left)}`,
    unknown: '○ c –',
  }[st.kind]
  const parts = [head, `ctx ${tokens(s.ctx)}`, `rwc ≈ ${money(s.rewriteUsd)}`, `sc ${money(s.costUsd)}`]
  const limits = s.rateLimits || []
  if (limits.length) parts.push(limitsText(limits))
  const top = Math.max(0, ...limits.map((l) => l.percentUsed || 0))
  let tone = 'normal'
  if (st.kind === 'cooling' || top >= 80) tone = 'warning'
  if ((st.kind === 'cold' && big) || top >= 95) tone = 'error'
  return { text: parts.join(' │ '), tone, state: st }
}

function tooltip(s, now) {
  const st = cacheState(s, now)
  const ttl = s.ttlMin || 60
  const left = st.kind === 'unknown' ? '' : st.left > 0 ? `, ${minutes(st.left)} left` : `, ${minutes(-st.left)} since expiry`
  const lines = [
    `**${s.masked ? 'session' : s.label || s.id}** · ${s.model || 'model unknown'} · ${s.state || 'idle'}`,
    '',
    `c: prompt cache ${st.kind}${left} (${ttl}m TTL)`,
    `ctx: ${tokens(s.ctx)} tokens in context`,
    'rwc: cost to write the context into the cache again if it expires',
    'sc: session cost so far, at API list prices',
  ]
  if ((s.rateLimits || []).length) lines.push(`plan limits used: ${limitsText(s.rateLimits)}`)
  lines.push('', `updated ${minutes(now - (s.updatedAt || now))} ago · click for all sessions`)
  return lines.join('  \n')
}

// The /board order: waiting on you, working, then the cache that cools soonest.
function boardItems(list, now) {
  const rank = { waiting: 0, working: 1 }
  return [...list]
    .sort((a, b) => {
      const r = (rank[a.state] ?? 2) - (rank[b.state] ?? 2)
      if (r !== 0) return r
      return cacheState(a, now).left - cacheState(b, now).left
    })
    .map((s) => ({
      id: s.id,
      label: `${s.masked ? 'session ' + s.id.slice(0, 8) : s.label || s.id}`,
      description: `${s.state || 'idle'} · ${render(s, now).text}`,
      detail: s.masked ? '' : s.cwd,
    }))
}

// The band's handoff button: label per mod state, and the command a click sends
const HANDOFF = {
  idle: { text: 'handoff', cmd: 'handoff' },
  queued: { text: 'handoff queued', cmd: null },
  running: { text: '$(sync~spin) handoff running', cmd: null },
  ready: { text: 'clear and continue', cmd: 'continue' },
  clearing: { text: '$(sync~spin) clearing', cmd: null },
}

// null: the session runs a mod version without command files, so no button
function handoffItem(s) {
  if (s.handoff === undefined) return null
  return { ...(HANDOFF[s.handoff] || HANDOFF.idle) }
}

function writeCommand(dir, id, cmd, now) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ cmd, at: now }))
}

module.exports = { readLive, pickSession, render, tooltip, boardItems, cacheState, handoffItem, writeCommand }
