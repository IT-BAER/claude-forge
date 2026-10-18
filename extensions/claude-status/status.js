// Pure logic: reads the session-band mod's live files and formats them.
// No vscode import here, so node --test covers it.
const fs = require('node:fs')
const path = require('node:path')

const MIN = 60000
const STALE_MS = 60 * MIN // the mod drops heartbeats older than this too
const ALIVE_MS = 2 * MIN // a running session rewrites its file at least every 30 seconds
const LIMIT_LABEL = { five_hour: '5h', seven_day: 'w', spend_limit: 'spend' }
// a per-model weekly window from the mod takes its model's initial ("fw" for Fable)
const limitLabel = (l) => LIMIT_LABEL[l.kind] || (l.model ? `${l.model[0].toLowerCase()}w` : l.kind)

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

// The mod never deletes live files: none at all means it has never run here
function modMissing(dir) {
  try {
    return !fs.readdirSync(dir).some((n) => n.endsWith('.json'))
  } catch {
    return true
  }
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Chats the VS Code extension started, sessionId -> name, from Claude Code's
// per-process session files (entrypoint claude-vscode, claude-desktop, cli).
function readVscodeSessions(dir) {
  const map = new Map()
  let names
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return map
  }
  for (const name of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (s && s.sessionId && s.entrypoint === 'claude-vscode') map.set(s.sessionId, s.name || '')
    } catch {
      // half-written or broken file: skip
    }
  }
  return map
}

// This window's session: cwd equals a workspace folder and the file is still
// being written (a reload kills a chat without marking its file ended). A chat
// the VS Code extension started wins over a Desktop or terminal one in the same
// folder; then the newest activity.
function pickSession(list, folders, now, vscode = new Map()) {
  const want = new Set(folders.map(normPath))
  let mine = list.filter((s) => want.has(normPath(s.cwd)) && now - (s.updatedAt || 0) <= ALIVE_MS)
  if (mine.some((s) => vscode.has(s.id))) mine = mine.filter((s) => vscode.has(s.id))
  const rank = (s) => [(s.surfaces || []).includes('vscode') ? 1 : 0, s.lastActivity || 0, s.updatedAt || 0]
  mine.sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]
    return 0
  })
  return mine[0]
}

// Plan limits are the account's, and within one window they only grow: per kind,
// the newest open window's highest value across all chats is the current one
// (a reopened chat has none until its first turn ends).
function accountLimits(list, now) {
  const best = new Map()
  const end = (l) => (l.resetsAt ? Date.parse(l.resetsAt) : Infinity)
  for (const s of list) {
    for (const l of s.rateLimits || []) {
      if (end(l) <= now) continue
      const b = best.get(l.kind)
      if (!b || end(l) > end(b) || (end(l) === end(b) && (l.percentUsed || 0) > (b.percentUsed || 0))) best.set(l.kind, l)
    }
  }
  return [...best.values()]
}

// VS Code puts 16 px between two items (3 px margin, 5 px padding each side, 12 px
// font): em + four-per-em + hair space match it, so every dot sits centred.
const GAP = '\u2003\u2005\u200a'

// Consecutive segments of one colour share a status item: VS Code pads every
// item, so a separate item per dot spaces the dots too far apart.
function groups(segments) {
  const out = []
  for (const g of segments) {
    const last = out[out.length - 1]
    if (last && last.color === g.color) last.text += GAP + '·' + GAP + g.text
    else out.push({ text: (out.length ? '·' + GAP : '') + g.text, color: g.color })
  }
  return out
}

function cacheState(s, now) {
  if (!s.lastActivity) return { kind: 'unknown', left: 0 }
  const left = (s.ttlMin || 60) * MIN - (now - s.lastActivity)
  if (s.keepWarm) return { kind: 'kept', left }
  if (left <= 0) return { kind: 'cold', left }
  if (left <= 5 * MIN) return { kind: 'cooling', left }
  return { kind: 'warm', left }
}

// As in the band: a weekly window's budget up to the end of today is day n of 7 (counted
// from its reset) times 1/7. Red at that budget, yellow at 80 % of it; other windows 95 / 80 %.
function weekBudget(l, now) {
  if ((l.kind !== 'seven_day' && !l.model) || !l.resetsAt) return null
  const daysLeft = Math.min(6, Math.max(0, Math.floor((Date.parse(l.resetsAt) - now) / (24 * 60 * MIN))))
  return ((7 - daysLeft) / 7) * 100
}

function limitColor(l, now) {
  const used = l.percentUsed || 0
  const budget = weekBudget(l, now)
  const [red, yellow] = budget === null ? [95, 80] : [budget, 0.8 * budget]
  return used >= red ? 'red' : used >= yellow ? 'yellow' : null
}

function limitsText(limits) {
  return limits.map((l) => `${limitLabel(l)} ${Math.round(l.percentUsed || 0)}%`).join(' · ')
}

// One segment per band part, each with the band's colour for it (null: plain)
function render(s, now) {
  const st = cacheState(s, now)
  const coldBig = st.kind === 'cold' && (s.ctx || 0) >= (s.bigTokens || 150000)
  const money = (v) => (s.masked ? '$•••' : usd(v))
  const [head, color] = {
    kept: ['◆ kept warm', 'cyan'],
    warm: [`● c ${minutes(st.left)}`, 'green'],
    cooling: [`◐ c ${minutes(st.left)}`, 'yellow'],
    cold: [`○ c cold ${minutes(-st.left)}`, coldBig ? 'red' : 'dim'],
    unknown: ['○ c –', 'dim'],
  }[st.kind]
  const segments = [
    { key: 'cache', text: head, color },
    { key: 'ctx', text: `ctx ${tokens(s.ctx)}`, color: null },
    { key: 'rwc', text: `rwc ≈ ${money(s.rewriteUsd)}`, color: coldBig ? 'red' : null },
    { key: 'sc', text: `sc ${money(s.costUsd)}`, color: null },
  ]
  const limits = s.rateLimits || []
  if (limits.length) {
    const tones = limits.map((l) => limitColor(l, now))
    segments.push({ key: 'limits', text: limitsText(limits), color: tones.includes('red') ? 'red' : tones.includes('yellow') ? 'yellow' : null })
  }
  return { text: segments.map((g) => g.text).join(' · '), segments, state: st }
}

function clock(ts) {
  const d = new Date(ts)
  const h = d.getHours()
  return (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (h >= 12 ? 'pm' : 'am')
}

// When each window resets: "5h resets 1:50pm (in 2h15m) · w resets Fri 9:00am (in 3d21h)", as in the band
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function resetsText(limits, now) {
  const DAY = 24 * 60 * MIN
  return limits.filter((l) => l.resetsAt).map((l) => {
    const t = Date.parse(l.resetsAt)
    const left = t - now
    const day = left >= DAY ? DAYS[new Date(t).getDay()] + ' ' : ''
    const span = left <= 0 ? 'due' : left >= DAY ? `in ${Math.floor(left / DAY)}d${Math.floor((left % DAY) / (60 * MIN))}h` : `in ${minutes(left)}`
    const budget = weekBudget(l, now)
    return `${limitLabel(l)} resets ${day}${clock(t)} (${span})${budget === null ? '' : `, budget today ${+budget.toFixed(1)}%`}`
  }).join(' · ')
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
  const resets = resetsText(s.rateLimits || [], now)
  if (resets) lines.push(resets)
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

// The Claude Code config dir this VS Code window's account uses
function claudeDir(env, home) {
  return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
}

module.exports = { claudeDir, GAP, readLive, readVscodeSessions, pickSession, accountLimits, groups, render, tooltip, boardItems, cacheState, handoffItem, writeCommand, modMissing }
