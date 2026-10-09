const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readLive, pickSession, render, boardItems, handoffItem, writeCommand, readVscodeSessions, accountLimits, groups } = require('../status')

const MIN = 60000
const NOW = 10_000_000_000

function hb(over = {}) {
  return {
    id: 'a', label: 'demo', cwd: 'd:\\VSC\\demo', model: 'claude-opus-5-5', state: 'idle',
    ctx: 184382, ttlMin: 60, lastActivity: NOW - 18 * MIN, keepWarm: false, costUsd: 3.31,
    rewriteUsd: 1.2, bigTokens: 150000, masked: false, surfaces: ['vscode'], ended: false,
    rateLimits: [{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 24 }],
    updatedAt: NOW - MIN, ...over,
  }
}

const colors = (r) => Object.fromEntries(r.segments.map((g) => [g.key, g.color]))

test('warm cache shows the same parts as the band, only the cache coloured', () => {
  const r = render(hb(), NOW)
  assert.equal(r.text, '● c 42m · ctx 184k · rwc ≈ $1.20 · sc $3.31 · 5h 40% · w 24%')
  assert.deepEqual(colors(r), { cache: 'green', ctx: null, rwc: null, sc: null, limits: null })
})

test('cooling cache turns only the cache yellow', () => {
  const r = render(hb({ lastActivity: NOW - 57 * MIN }), NOW)
  assert.match(r.text, /^◐ c 3m/)
  assert.deepEqual(colors(r), { cache: 'yellow', ctx: null, rwc: null, sc: null, limits: null })
})

test('cold big cache turns cache and rewrite red, cold small cache is dim', () => {
  const big = render(hb({ lastActivity: NOW - 72 * MIN }), NOW)
  assert.match(big.text, /^○ c cold 12m/)
  assert.equal(colors(big).cache, 'red')
  assert.equal(colors(big).rwc, 'red')
  const small = colors(render(hb({ lastActivity: NOW - 72 * MIN, ctx: 9000 }), NOW))
  assert.equal(small.cache, 'dim')
  assert.equal(small.rwc, null)
})

test('plan limits at 80 % turn only the limits yellow, at 95 % red', () => {
  const warn = colors(render(hb({ rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] }), NOW))
  assert.equal(warn.limits, 'yellow')
  assert.equal(warn.cache, 'green')
  assert.equal(colors(render(hb({ rateLimits: [{ kind: 'five_hour', percentUsed: 96 }] }), NOW)).limits, 'red')
})

test('kept warm and masked money', () => {
  const r = render(hb({ keepWarm: true, masked: true }), NOW)
  assert.match(r.text, /^◆ kept warm/)
  assert.equal(colors(r).cache, 'cyan')
  assert.match(r.text, /rwc ≈ \$••• · sc \$•••/)
})

test('picks the newest vscode session of this workspace, any case of drive letter', () => {
  const list = [
    hb({ id: 'desktop', cwd: 'D:\\VSC\\demo', surfaces: ['desktop'], lastActivity: NOW }),
    hb({ id: 'old', cwd: 'D:\\VSC\\demo\\', lastActivity: NOW - 30 * MIN }),
    hb({ id: 'new', cwd: 'd:/VSC/demo', lastActivity: NOW - 2 * MIN }),
    hb({ id: 'other', cwd: 'd:\\VSC\\other', lastActivity: NOW }),
  ]
  assert.equal(pickSession(list, ['D:\\VSC\\demo'], NOW).id, 'new')
  assert.equal(pickSession(list.slice(0, 1), ['d:\\vsc\\demo'], NOW).id, 'desktop')
  assert.equal(pickSession(list, ['d:\\VSC\\none'], NOW), undefined)
})

test('readLive skips ended, stale and broken files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-status-'))
  try {
    fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify(hb({ id: 'live' })))
    fs.writeFileSync(path.join(dir, 'ended.json'), JSON.stringify(hb({ id: 'ended', ended: true })))
    fs.writeFileSync(path.join(dir, 'stale.json'), JSON.stringify(hb({ id: 'stale', updatedAt: NOW - 61 * MIN })))
    fs.writeFileSync(path.join(dir, 'broken.json'), '{')
    assert.deepEqual(readLive(dir, NOW).map((s) => s.id), ['live'])
    assert.deepEqual(readLive(path.join(dir, 'missing'), NOW), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('board lists waiting first, then working, then by cache time left', () => {
  const items = boardItems([
    hb({ id: 'idle-late', lastActivity: NOW - 50 * MIN }),
    hb({ id: 'work', state: 'working' }),
    hb({ id: 'idle-fresh', lastActivity: NOW - 1 * MIN }),
    hb({ id: 'wait', state: 'waiting' }),
  ], NOW)
  assert.deepEqual(items.map((i) => i.id), ['wait', 'work', 'idle-late', 'idle-fresh'])
})

test('handoff item follows the mod state like the band button', () => {
  assert.deepEqual(handoffItem(hb({ handoff: 'idle' })), { text: 'handoff', cmd: 'handoff' })
  assert.equal(handoffItem(hb({})), null)
  assert.deepEqual(handoffItem(hb({ handoff: 'queued' })), { text: 'handoff queued', cmd: null })
  assert.deepEqual(handoffItem(hb({ handoff: 'running' })), { text: '$(sync~spin) handoff running', cmd: null })
  assert.deepEqual(handoffItem(hb({ handoff: 'ready' })), { text: 'clear and continue', cmd: 'continue' })
  assert.deepEqual(handoffItem(hb({ handoff: 'clearing' })), { text: '$(sync~spin) clearing', cmd: null })
})

test('writeCommand leaves one command file per session for the mod', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-status-'))
  try {
    writeCommand(path.join(dir, 'commands'), 'sess-1', 'continue', NOW)
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'commands', 'sess-1.json'), 'utf8'))
    assert.deepEqual(c, { cmd: 'continue', at: NOW })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('a session that stopped writing its file loses to a live one, even with newer activity', () => {
  const list = [
    hb({ id: 'dead', lastActivity: NOW - 1 * MIN, updatedAt: NOW - 3 * MIN }),
    hb({ id: 'alive', lastActivity: NOW - 20 * MIN, updatedAt: NOW - 10000 }),
  ]
  assert.equal(pickSession(list, ['d:\\VSC\\demo'], NOW).id, 'alive')
  assert.equal(pickSession(list.slice(0, 1), ['d:\\VSC\\demo'], NOW), undefined)
})
test('readVscodeSessions lists the chats the VS Code extension started, with their names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-status-'))
  try {
    fs.writeFileSync(path.join(dir, '1.json'), JSON.stringify({ sessionId: 'vs', entrypoint: 'claude-vscode', name: 'demo-d5' }))
    fs.writeFileSync(path.join(dir, '2.json'), JSON.stringify({ sessionId: 'desk', entrypoint: 'claude-desktop', name: 'Remote git update' }))
    fs.writeFileSync(path.join(dir, '3.json'), '{')
    const m = readVscodeSessions(dir)
    assert.deepEqual([...m.entries()], [['vs', 'demo-d5']])
    assert.equal(readVscodeSessions(path.join(dir, 'missing')).size, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a VS Code chat wins over a newer Desktop chat in the same folder', () => {
  const list = [
    hb({ id: 'desk', cwd: 'D:\\VSC\\demo', lastActivity: NOW - 1 * MIN }),
    hb({ id: 'vs', cwd: 'd:\\VSC\\demo', lastActivity: 0 }),
  ]
  assert.equal(pickSession(list, ['d:\\VSC\\demo'], NOW, new Map([['vs', 'demo-d5']])).id, 'vs')
  assert.equal(pickSession(list, ['d:\\VSC\\demo'], NOW, new Map()).id, 'desk')
})
test('plan limits: per kind the open window with the latest reset, its highest value across chats', () => {
  const at = (m) => new Date(NOW + m * MIN).toISOString()
  const five = (p, resetsAt) => ({ kind: 'five_hour', percentUsed: p, resetsAt })
  const week = { kind: 'seven_day', percentUsed: 27, resetsAt: at(9000) }
  const own = hb({ id: 'own', rateLimits: [] })
  const old = hb({ id: 'old', rateLimits: [five(42, at(20))] })
  const fresh = hb({ id: 'fresh', rateLimits: [five(81, at(20)), week] })
  assert.deepEqual(accountLimits([own, old, fresh], NOW), [five(81, at(20)), week])
  const ended = hb({ id: 'ended', rateLimits: [five(99, at(-1))] })
  const next = hb({ id: 'next', rateLimits: [five(3, at(299))] })
  assert.deepEqual(accountLimits([own, ended], NOW), [])
  assert.deepEqual(accountLimits([fresh, next], NOW), [five(3, at(299)), week])
})

test('segments of one colour share a status item, every dot has a 16 px gap on both sides', () => {
  const G = '\u2003\u2005\u200a' // em + four-per-em + hair space at 12 px: the 16 px VS Code puts between items
  const g = groups(render(hb({ rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] }), NOW).segments)
  assert.deepEqual(g, [
    { text: '● c 42m', color: 'green' },
    { text: `·${G}ctx 184k${G}·${G}rwc ≈ $1.20${G}·${G}sc $3.31`, color: null },
    { text: `·${G}5h 85%`, color: 'yellow' },
  ])
})
