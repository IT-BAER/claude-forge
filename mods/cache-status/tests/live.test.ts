import { expect, mock, test } from 'claude-code/testing'

const LIVE = 'D:/home/t/.claude/mods-data/cache-status/live/sess-1.json'

async function start($: any, on: any, surfaces: string[] = ['vscode']) {
  const writes: Record<string, string> = {}
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'D:\\home\\t' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: 'd:\\VSC\\demo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('fs.write', (_: any, e: any) => { writes[e.path.replace(/\\/g, '/')] = e.text; return { value: undefined } })
  await $.session.start({ cwd: 'd:\\VSC\\demo', surface: null, isInteractive: true })
  return writes
}

test('heartbeat writes a live status file', async ($, on) => {
  const writes = await start($, on)
  expect(writes[LIVE]).toBeDefined()
  const live = JSON.parse(writes[LIVE]!)
  expect(live.id).toBe('sess-1')
  expect(live.cwd).toBe('d:\\VSC\\demo')
  expect(live.surfaces).toEqual(['vscode'])
  expect(live.rateLimits).toEqual([])
  expect(typeof live.rewriteUsd).toBe('number')
  expect(live.ended).toBe(false)
})

test('session end marks the live file as ended', async ($, on) => {
  const writes = await start($, on)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as any)
  expect(JSON.parse(writes[LIVE]!).ended).toBe(true)
})
