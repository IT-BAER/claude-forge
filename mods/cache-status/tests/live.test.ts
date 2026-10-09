import { expect, mock, test } from 'claude-code/testing'

const BASE = 'D:/home/t/.claude/mods-data/cache-status'
const LIVE = `${BASE}/live/sess-1.json`
const CMD = `${BASE}/commands/sess-1.json`
const NOW = 1_000_000

async function start($: any, on: any, extra: (on: any) => void = () => {}, seed: Record<string, string> = {}) {
  const files: Record<string, string> = { ...seed }
  const ran: string[] = []
  const sid = { value: 'sess-1' }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'D:\\home\\t' })
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('session.id', () => ({ value: sid.value }))
  on('session.cwd', () => ({ value: 'd:\\VSC\\demo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  extra(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('agent.list', () => ({ value: [] }))
  on('command.list', () => ({ value: [{ name: 'session-handoff', description: '', source: 'user' }] }))
  on('command.run', (_: any, e: any) => { ran.push(e.command); return {} })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.exists', (_: any, e: any) => ({ value: norm(e.path) in files }))
  on('fs.read', (_: any, e: any) => ({ value: files[norm(e.path)] ?? '' }))
  on('fs.write', (_: any, e: any) => { files[norm(e.path)] = e.text; return { value: undefined } })
  await $.session.start({ cwd: 'd:\\VSC\\demo', surface: null, isInteractive: true })
  const live = (id = 'sess-1') => JSON.parse(files[`${BASE}/live/${id}.json`]!)
  return { files, ran, clock, live, sid }
}

test('heartbeat writes a live status file', async ($, on) => {
  const { live } = await start($, on)
  expect(live().id).toBe('sess-1')
  expect(live().cwd).toBe('d:\\VSC\\demo')
  expect(live().surfaces).toEqual(['vscode'])
  expect(live().rateLimits).toEqual([])
  expect(typeof live().rewriteUsd).toBe('number')
  expect(live().handoff).toBe('idle')
  expect(live().ended).toBe(false)
})

test('session end marks the live file as ended, and later heartbeats keep it so', async ($, on) => {
  const { clock, live } = await start($, on)
  await $.session.end({ reason: 'other', sessionId: 'sess-1' } as any)
  expect(live().ended).toBe(true)
  await clock.advance(31000)
  expect(live().ended).toBe(true)
})

test('after /clear the live file follows the new session id', async ($, on) => {
  const { files, clock, live, sid } = await start($, on)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as any)
  sid.value = 'sess-2'
  await clock.advance(2000)
  expect(live('sess-2').id).toBe('sess-2')
  expect(live('sess-2').ended).toBe(false)
  await clock.advance(31000)
  expect(live().ended).toBe(true)
  expect(files[`${BASE}/live/sess-2.json`]).toBeDefined()
})

test('a handoff command file starts the handoff and the live file shows it running', async ($, on) => {
  const { files, ran, clock, live } = await start($, on)
  files[CMD] = JSON.stringify({ cmd: 'handoff', at: NOW })
  await clock.advance(2000)
  await clock.advance(2000)
  expect(ran).toContain('session-handoff')
  expect(JSON.parse(files[CMD]!).doneAt).toBeDefined()
  expect(live().handoff).toBe('running')
})

test('a done or old command file runs nothing', async ($, on) => {
  const { files, ran, clock } = await start($, on)
  files[CMD] = JSON.stringify({ cmd: 'handoff', at: NOW, doneAt: NOW })
  await clock.advance(2000)
  files[CMD] = JSON.stringify({ cmd: 'handoff', at: NOW - 60000 })
  await clock.advance(2000)
  expect(ran).not.toContain('session-handoff')
})

test('continue without a ready handoff does not clear', async ($, on) => {
  const { files, ran, clock } = await start($, on)
  files[CMD] = JSON.stringify({ cmd: 'continue', at: NOW })
  await clock.advance(2000)
  expect(ran).not.toContain('clear')
})

// A reopened chat is a process started with --resume: only session.start fires
test('a resumed chat restores context, cost, cache time and a ready handoff', async ($, on) => {
  const transcript = [
    { type: 'assistant', timestamp: new Date(NOW - 8 * 60000).toISOString(), message: { role: 'assistant' } },
    { type: 'bridge-session', timestamp: new Date(NOW - 60000).toISOString() },
  ].map((r) => JSON.stringify(r)).join('\n')
  const { live } = await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200000, breakdown: { categories: [], totalTokens: 90000, maxTokens: 200000, rawMaxTokens: 200000 } }, rateLimits: [{ kind: 'five_hour', percentUsed: 48 }], cost: { usd: 1.08 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: 'D:\\p\\.claude\\session-handoff.md', content: '...' } }] }] }))
  }, {
    'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript,
    'D:/p/.claude/session-handoff.md': '<!-- handoff: 2026-10-09T20:45:45+02:00 | session: sess-1 | status: active -->\n' + 'x'.repeat(300),
  })
  expect(live().ctx).toBe(90000)
  expect(live().costUsd).toBe(1.08)
  expect(live().rateLimits).toEqual([{ kind: 'five_hour', percentUsed: 48 }])
  expect(live().lastActivity).toBe(NOW - 8 * 60000)
  expect(live().handoff).toBe('ready')
})