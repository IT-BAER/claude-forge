const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readLive, pickSession, render, boardItems, handoffItem, writeCommand } = require('../status')

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

test('warm cache shows the same parts as the band', () => {
  const r = render(hb(), NOW)
  assert.equal(r.text, '● c 42m │ ctx 184k │ rwc ≈ $1.20 │ sc $3.31 │ 5h 40% · w 24%')
  assert.equal(r.tone, 'normal')
})

test('cooling cache turns the item yellow', () => {
  const r = render(hb({ lastActivity: NOW - 57 * MIN }), NOW)
  assert.match(r.text, /^◐ c 3m/)
  assert.equal(r.tone, 'warning')
})

test('cold big cache turns red, cold small cache stays normal', () => {
  const big = render(hb({ lastActivity: NOW - 72 * MIN }), NOW)
  assert.match(big.text, /^○ c cold 12m/)
  assert.equal(big.tone, 'error')
  assert.equal(render(hb({ lastActivity: NOW - 72 * MIN, ctx: 9000 }), NOW).tone, 'normal')
})

test('plan limits at 80 % warn and at 95 % alert', () => {
  assert.equal(render(hb({ rateLimits: [{ kind: 'five_hour', percentUsed: 85 }] }), NOW).tone, 'warning')
  assert.equal(render(hb({ rateLimits: [{ kind: 'five_hour', percentUsed: 96 }] }), NOW).tone, 'error')
})

test('kept warm and masked money', () => {
  const r = render(hb({ keepWarm: true, masked: true }), NOW)
  assert.match(r.text, /^◆ kept warm/)
  assert.match(r.text, /rwc ≈ \$••• │ sc \$•••/)
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