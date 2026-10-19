import { expect, mock, test } from 'claude-code/testing'

const BASE = 'D:/home/t/.claude/mods-data/session-band'
const LIVE = `${BASE}/live/sess-1.json`
const CMD = `${BASE}/commands/sess-1.json`
const NOW = 1_000_000

async function start($: any, on: any, extra: (on: any) => void = () => {}, seed: Record<string, string> = {}, env: Record<string, string> = {}) {
  const files: Record<string, string> = { ...seed }
  const ran: string[] = []
  const toasts: string[] = []
  const sid = { value: 'sess-1' }
  const agents = { value: [] as any[] }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'D:\\home\\t', ...env })
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('session.id', () => ({ value: sid.value }))
  on('session.cwd', () => ({ value: 'd:\\VSC\\demo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  extra(on)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('agent.list', () => ({ value: agents.value }))
  on('command.list', () => ({ value: [{ name: 'session-handoff', description: '', source: 'user' }] }))
  on('command.run', (_: any, e: any) => { ran.push(e.command); return {} })
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.exists', (_: any, e: any) => ({ value: norm(e.path) in files }))
  on('fs.read', (_: any, e: any) => ({ value: files[norm(e.path)] ?? '' }))
  on('fs.write', (_: any, e: any) => { files[norm(e.path)] = e.text; return { value: undefined } })
  await $.session.start({ cwd: 'd:\\VSC\\demo', surface: null, isInteractive: true })
  const live = (id = 'sess-1') => JSON.parse(files[`${BASE}/live/${id}.json`]!)
  return { files, ran, clock, live, sid, toasts, agents }
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

test('CLAUDE_CONFIG_DIR moves the live file into that profile', async ($, on) => {
  const { files } = await start($, on, () => {}, {}, { CLAUDE_CONFIG_DIR: 'D:\\home\\t\\.claude-jeff' })
  expect(JSON.parse(files['D:/home/t/.claude-jeff/mods-data/session-band/live/sess-1.json']!).id).toBe('sess-1')
  expect(files[LIVE]).toBeUndefined()
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

test('the chat after clear and continue does not take over the previous chat\'s handoff', async ($, on) => {
  const handoff = '<!-- handoff: 2026-10-09T20:45:45+02:00 | session: sess-1 | status: active -->\n' + 'x'.repeat(300)
  let messages: any[] = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: 'D:\\p\\.claude\\session-handoff.md', content: '...' } }] }]
  const { files, ran, clock, live, sid } = await start($, on, (on) => {
    on('session.messages', () => ({ value: messages }))
    on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  }, { 'D:/p/.claude/session-handoff.md': handoff })
  expect(live().handoff).toBe('ready')
  files[CMD] = JSON.stringify({ cmd: 'continue', at: NOW })
  await clock.advance(2000)
  expect(ran).toContain('clear')
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as any)
  sid.value = 'sess-2'
  messages = [{ role: 'user', text: 'Continue from session handoff: read D:/p/.claude/session-handoff.md', toolUses: [] }]
  await clock.advance(2000)
  expect(live('sess-2').handoff).toBe('idle')
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

const HF = 'D:/p/.claude/session-handoff.md'
const handoffFile = (status: string) => `<!-- handoff: 2026-10-09T20:45:45+02:00 | session: sess-0 | status: ${status} -->\n` + 'x'.repeat(300)

test('a ready handoff whose file another chat consumed is no longer ready', async ($, on) => {
  const { files, clock, live } = await start($, on, (on) => {
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: HF, content: '...' } }] }] }))
  }, { [HF]: handoffFile('active') })
  expect(live().handoff).toBe('ready')
  files[HF] = handoffFile('consumed')
  await clock.advance(2000)
  expect(live().handoff).toBe('idle')
})

test('consuming a handoff through the skill does not turn the answer into a new handoff', async ($, on) => {
  const { files, live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', (_: any, e: any) => { if (e.tool === 'Edit') files[HF] = handoffFile('consumed'); return { result: { text: '' } } })
  }, { [HF]: handoffFile('active') })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'session-handoff' } as any)
  await $.tool.call({ tool: 'Edit', file_path: HF, old_string: 'status: active', new_string: 'status: consumed' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'Handoff consumed. '.repeat(30), durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('idle')
  expect(Object.keys(files).some((p) => p.includes('/handoffs/'))).toBe(false)
})

test('a handoff the skill writes to a file is ready', async ($, on) => {
  const { files, live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', (_: any, e: any) => { if (e.tool === 'Write') files[HF] = handoffFile('active'); return { result: { text: '' } } })
  })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'session-handoff' } as any)
  await $.tool.call({ tool: 'Write', file_path: HF, content: '...' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'Handoff written.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('ready')
})

test('an answer that offers an out-of-date handoff again makes it ready again', async ($, on) => {
  const path = 'D:/home/t/.claude/handoffs/demo/2026-10-16T204534-PC.md'
  const { live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  }, { [path]: handoffFile('active') })
  await $.prompt.submit({ text: 'still broken?', origin: { kind: 'composer' } } as any)
  await $.turn.start({ turnId: 't1' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'Not built yet. Run /clear, then paste:\n\n```\nContinue from session handoff: read ~/.claude/handoffs/demo/2026-10-16T204534-PC.md, consume it with session-handoff, do not re-explore.\n```', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('ready')
})

for (const reason of ['answer', 'aborted'] as const) {
  test(`a handoff file written mid-turn shows running, and offers clear and continue only once the turn ends (${reason})`, async ($, on) => {
    const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
    const { files, clock, live, toasts } = await start($, on, (on) => {
      on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
      on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
      on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
      on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
      on('tool.call', (_: any, e: any) => { if (e.tool === 'Write') files[HF] = handoffFile('active'); return { result: { text: '' } } })
      on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
    }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
    const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
    const buttons = async () => {
      const ui = await $.ui.mount({ plugin: 'session-band', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
      const labels = all(await ui.drawn()).filter((n) => n.type === 'Button' && n.props.key !== 'auto').map((n) => n.props.label)
      await ui.unmount()
      return labels
    }
    // handoff alone, or clear and continue beside it
    const offered = async () => (await buttons()).length === 2
    await $.turn.start({ turnId: 't1' } as any)
    await $.tool.call({ tool: 'Write', file_path: HF, content: '...' } as any)
    await clock.advance(2000)
    expect(await buttons()).toEqual(['handoff running'])
    expect(live().handoff).toBe('running')
    // a message sent while Claude still works does not drop the handoff
    await $.prompt.submit({ text: 'and then the browser', origin: { kind: 'composer' } } as any)
    await clock.advance(2000)
    expect(await buttons()).toEqual(['handoff running'])
    expect(live().handoff).toBe('running')
    expect(toasts.some((t) => /clear and continue/.test(t))).toBe(false)
    await $.turn.complete({ reason, answer: 'Handoff written.', durationMs: 1, isAborted: reason === 'aborted', turnId: 't1' } as any)
    expect(await offered()).toBe(true)
    expect(live().handoff).toBe('ready')
    expect(toasts.filter((t) => /clear and continue/.test(t)).length).toBe(1)
  })
}

test('a resume turn that calls the skill but never edits the file saves no handoff', async ($, on) => {
  const { files, live } = await start($, on, (on) => {
    on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', () => ({ result: { text: '' } }))
  }, { [HF]: handoffFile('active') })
  await $.prompt.submit({ text: `Continue from session handoff: read ${HF}, consume it with session-handoff, do not re-explore.`, origin: { kind: 'composer' } } as any)
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'session-handoff' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'The read was blocked. '.repeat(20), durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('idle')
  expect(Object.keys(files).some((p) => p.includes('/handoffs/'))).toBe(false)
})

test('the resume turn after clear and continue does not arm a new handoff', async ($, on) => {
  let messages: any[] = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: HF, content: '...' } }] }]
  const { files, clock, live, sid } = await start($, on, (on) => {
    on('session.messages', () => ({ value: messages }))
    on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', () => ({ result: { text: '' } }))
  }, { [HF]: handoffFile('active') })
  expect(live().handoff).toBe('ready')
  files[CMD] = JSON.stringify({ cmd: 'continue', at: NOW })
  await clock.advance(2000)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as any)
  sid.value = 'sess-2'
  messages = [{ role: 'user', text: `Continue from session handoff: read ${HF}`, toolUses: [] }]
  await clock.advance(2000)
  await $.turn.start({ turnId: 't2' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'session-handoff' } as any)
  await clock.advance(2000)
  expect(live('sess-2').handoff).toBe('idle')
  await $.turn.complete({ reason: 'answer', answer: 'Resumed from the handoff. '.repeat(20), durationMs: 1, isAborted: false, turnId: 't2' } as any)
  expect(live('sess-2').handoff).toBe('idle')
  expect(Object.keys(files).some((p) => p.includes('/handoffs/'))).toBe(false)
})

// Shell writes: the Bash or PowerShell tool, relative to the session cwd or after a cd
const shellWrites = [
  { tool: 'Bash', path: 'd:/VSC/demo/.claude/session-handoff.md', command: 'TS=$(date -u +%Y-%m-%dT%H:%M:%SZ) && cat > .claude/session-handoff.md <<EOF\n<!-- handoff: $TS -->\nEOF' },
  { tool: 'Bash', path: 'D:/p/.claude/session-handoff.md', command: 'cd /d/p && printf "%s" "$H" | tee .claude/session-handoff.md >/dev/null' },
  { tool: 'PowerShell', path: 'D:/p/.claude/session-handoff.md', command: "Set-Content -Path 'D:\\p\\.claude\\session-handoff.md' -Value $text" },
]
for (const w of shellWrites) {
  test(`a handoff file written through ${w.tool} is ready (${w.command.slice(0, 24)})`, async ($, on) => {
    const { files, live } = await start($, on, (on) => {
      on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
      on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
      on('tool.call', (_: any, e: any) => { if (e.tool === w.tool) files[w.path] = handoffFile('active'); return { result: { text: '' } } })
    })
    await $.turn.start({ turnId: 't1' } as any)
    await $.tool.call({ tool: w.tool, command: w.command } as any)
    await $.turn.complete({ reason: 'answer', answer: 'Handoff written.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    expect(live().handoff).toBe('ready')
  })
}

test('reading a handoff file through Bash is not a handoff write', async ($, on) => {
  const { live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', () => ({ result: { text: '' } }))
  }, { [HF]: handoffFile('active') })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Bash', command: `cat ${HF} > /tmp/copy.md; grep -n status /d/p/.claude/session-handoff.md 2>/dev/null` } as any)
  await $.turn.complete({ reason: 'answer', answer: 'Read it.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('idle')
})

test('consuming a handoff with sed -i through Bash does not turn the answer into a new handoff', async ($, on) => {
  const { files, live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', (_: any, e: any) => { if (e.tool === 'Bash') files[HF] = handoffFile('consumed'); return { result: { text: '' } } })
  }, { [HF]: handoffFile('active') })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'session-handoff' } as any)
  await $.tool.call({ tool: 'Bash', command: "cd /d/p && sed -i '1s/status: active/status: consumed/' .claude/session-handoff.md && head -1 .claude/session-handoff.md" } as any)
  await $.turn.complete({ reason: 'answer', answer: 'Handoff consumed. '.repeat(30), durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('idle')
  expect(Object.keys(files).some((p) => p.includes('/handoffs/'))).toBe(false)
})

test('a denied edit of a handoff file is not a handoff write', async ($, on) => {
  const { live } = await start($, on, (on) => {
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', () => ({ deny: 'sensitive file' }))
  }, { [HF]: handoffFile('active') })
  await $.turn.start({ turnId: 't1' } as any)
  await $.tool.call({ tool: 'Edit', file_path: HF, old_string: 'status: active', new_string: 'status: consumed' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'The edit was denied.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(live().handoff).toBe('idle')
})
test('hovering the plan limits shows when each window resets', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
  const limits = [
    { kind: 'five_hour', percentUsed: 48, resetsAt: new Date(NOW + 135 * 60000).toISOString() },
    { kind: 'seven_day', percentUsed: 24, resetsAt: new Date(NOW + (3 * 24 + 21) * 60 * 60000).toISOString() },
  ]
  await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 90000, window: 200000 }, rateLimits: limits, cost: { usd: 1 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-band', surface, component: 'AbovePrompt', props: {} as any })
    const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
    const drawn = all(await ui.drawn())
    expect(drawn.find((n) => n.type === 'Text' && n.children.join('') === ' │ 5h 48%')?.hover?.scope).toBe('ck-limits')
    expect(drawn.find((n) => n.type === 'Text' && n.children.join('') === ' w 24%')?.hover?.scope).toBe('ck-limits')
    const help = drawn.find((n) => n.type === 'Box' && n.hover?.scope === 'ck-limits' && n.hover?.display === 'flex')
    expect(all(help).find((n) => n.type === 'Text')?.children.join('')).toMatch(/^plan limits: 5h \(5-hour window\) resets \d{1,2}:\d\d[ap]m \(in 2h15m\) · w \(weekly, all models\) resets [A-Z][a-z]{2} \d{1,2}:\d\d[ap]m \(in 3d21h\), budget today 57\.1%$/)
    await ui.unmount()
  }
})

test('each plan limit gets its own colour, weekly ones by today\'s share of the week', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
  const at = (min: number) => new Date(NOW + min * 60000).toISOString()
  const day1 = at((6 * 24 + 10) * 60) // 6 full days left: budget 1/7 = 14.3 %
  const limits = [
    { kind: 'five_hour', percentUsed: 85, resetsAt: at(135) },
    { kind: 'seven_day', percentUsed: 15, resetsAt: day1 },
    { kind: 'weekly_fable', model: 'Fable', percentUsed: 12, resetsAt: day1 },
    { kind: 'weekly_sonnet', model: 'Sonnet', percentUsed: 30, resetsAt: at((4 * 24 + 1) * 60) },
  ]
  let modes: any[] = []
  await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 90000, window: 200000 }, rateLimits: limits, cost: { usd: 1 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('ui.render', ($: any, e: any) => {
      if (e.component === 'SessionMode') modes = e.props.modes
      return $.ui.resolve(e).Box({ children: [] })
    })
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
  const drawn = all(await ui.drawn())
  const text = (t: string) => drawn.find((n) => n.type === 'Text' && n.children.join('') === t)
  const style = (t: string) => { const n = text(t); return n && { ...n, ...n.props } }
  expect(style(' │ 5h 85%')).toMatchObject({ color: 'yellow' })
  expect(style(' w 15%')).toMatchObject({ color: 'red', bold: true })
  expect(style(' fw 12%')).toMatchObject({ color: 'yellow' })
  expect(style(' sw 30%')).toMatchObject({ dimColor: true })
  expect(text(' w 15%')?.hover?.scope).toBe('ck-limits')
  const help = drawn.find((n) => n.type === 'Box' && n.hover?.scope === 'ck-limits' && n.hover?.display === 'flex')
  expect(all(help).find((n) => n.type === 'Text')?.children.join('')).toMatch(/ · w \(weekly, all models\) resets [A-Z][a-z]{2} \d{1,2}:\d\d[ap]m \(in 6d10h\), budget today 14\.3% · /)
  await ui.unmount()
  // the footer lists the coloured windows
  const footer = await $.ui.mount({ plugin: 'session-band', surface: 'terminal', component: 'SessionMode', props: { modes: [] } as any })
  await footer.drawn()
  await footer.unmount()
  expect(modes).toEqual(['5h 85% · w 15% · fw 12%'])
})

test('per-model weekly windows (Fable) come from the usage endpoint into the band, hover and live file', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
  const fableReset = new Date(NOW + ((2 * 24 + 5) * 60 + 1) * 60000 - 452).toISOString() // the server's reset is off the minute by milliseconds
  const asked: any[] = []
  const { clock, live } = await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 90000, window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 48, resetsAt: new Date(NOW + 135 * 60000).toISOString() }], cost: { usd: 1 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('session.authorize', () => ({ value: { handle: 'h-1', kind: 'bearer' } }))
    on('http.fetch', (_: any, e: any) => {
      asked.push(e)
      const limits = [
        { kind: 'session', group: 'session', percent: 48, resets_at: '2026-10-11T10:30:00+00:00', scope: null },
        { kind: 'weekly_scoped', group: 'weekly', percent: 33, resets_at: fableReset, scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
      ]
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ five_hour: null, limits }) } }
    })
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  await clock.advance(31000)
  expect(asked.length).toBe(1)
  expect(asked[0].url).toBe('https://api.anthropic.com/api/oauth/usage')
  expect(asked[0].init.auth).toBe('h-1')
  expect(live().rateLimits).toEqual([
    { kind: 'five_hour', percentUsed: 48, resetsAt: new Date(NOW + 135 * 60000).toISOString() },
    { kind: 'weekly_fable', model: 'Fable', percentUsed: 33, resetsAt: new Date(Math.round(Date.parse(fableReset) / 60000) * 60000).toISOString() },
  ])
  const ui = await $.ui.mount({ plugin: 'session-band', surface: 'terminal', component: 'AbovePrompt', props: {} as any })
  const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
  const drawn = all(await ui.drawn())
  expect(drawn.some((n) => n.type === 'Text' && n.children.join('') === ' fw 33%')).toBe(true)
  const help = drawn.find((n) => n.type === 'Box' && n.hover?.scope === 'ck-limits' && n.hover?.display === 'flex')
  expect(all(help).find((n) => n.type === 'Text')?.children.join('')).toMatch(/ · fw \(weekly, Fable only\) resets [A-Z][a-z]{2} \d{1,2}:\d\d[ap]m \(in 2d5h\), budget today 71\.4%$/)
  await ui.unmount()
  // within five minutes the endpoint is not asked again
  await $.turn.start({ turnId: 't1' } as any)
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  expect(asked.length).toBe(1)
})

test('the band keeps cooling and cold restarts short and puts the full text in hover help', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 70 * 60000).toISOString(), message: { role: 'assistant' } })
  const { clock } = await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 90000, window: 200000 }, rateLimits: [], cost: { usd: 1 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('turn.step', async function* (_: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 89000 } }
    })
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as any)
  for await (const _ of step) { /* drain */ }
  await step.result
  await clock.advance(57 * 60000)
  const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
  const helpText = (drawn: any[], scope: string) => all(drawn.find((n) => n.type === 'Box' && n.hover?.scope === scope && n.hover?.display === 'flex')).find((n) => n.type === 'Text')?.children.join('')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-band', surface, component: 'AbovePrompt', props: {} as any })
    const drawn = all(await ui.drawn())
    const texts = drawn.filter((n) => n.type === 'Text').map((n) => String(n.children.join('')))
    expect(texts).toContain('◐ c 3m')
    const band = texts.filter((t) => /^([◐●○◆]| │)/.test(t))
    expect(band.some((t) => /cools in|cold restart/.test(t))).toBe(false)
    expect(helpText(drawn, 'ck-c')).toMatch(/^c = prompt cache: cooling, expires in 3m \(60m TTL\);/)
    const cr = drawn.find((n) => n.type === 'Text' && /^ │ cr 1 \$\d+\.\d\d$/.test(String(n.children.join(''))))
    expect(cr?.hover?.scope).toBe('ck-cr')
    expect(helpText(drawn, 'ck-cr')).toMatch(/^cr = cold restarts: 1 send rewrote the expired cache this session, \$\d+\.\d\d in total$/)
    await ui.unmount()
  }
})

test('kept warm, rewrite cost and plan limits stay short, and band segments wrap whole', async ($, on) => {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
  await start($, on, (on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 90000, window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 9 }, { kind: 'seven_day', percentUsed: 10 }], cost: { usd: 1 } } }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  await $.command.run({ command: 'keepwarm', args: '2' } as any)
  const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
  const helpText = (drawn: any[], scope: string) => all(drawn.find((n) => n.type === 'Box' && n.hover?.scope === scope && n.hover?.display === 'flex')).find((n) => n.type === 'Text')?.children.join('')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-band', surface, component: 'AbovePrompt', props: {} as any })
    const drawn = all(await ui.drawn())
    const texts = drawn.filter((n) => n.type === 'Text')
    const kept = texts.find((n) => /^◆ c kept \d{1,2}:\d\d[ap]m$/.test(n.children.join('')))
    expect(kept?.hover?.scope).toBe('ck-c')
    expect(helpText(drawn, 'ck-c')).toMatch(/^c = prompt cache: kept warm until \d{1,2}:\d\d[ap]m, 0 pings so far \(\$0\)/)
    expect(texts.some((n) => /^ │ rwc \$\d+\.\d\d$/.test(n.children.join('')))).toBe(true)
    expect(texts.some((n) => n.children.join('') === ' │ 5h 9%')).toBe(true)
    expect(texts.some((n) => n.children.join('') === ' w 10%')).toBe(true)
    expect(texts.find((n) => n.children.join('') === ' │ ctx 90.0k')?.hover?.scope).toBe('ck-ctx')
    expect(helpText(drawn, 'ck-ctx')).toBe("ctx = context: 90.0k tokens in this session's context window of 200k")
    expect(helpText(drawn, 'ck-rewrite')).toMatch(/^rwc = rewrite cost: /)
    expect(helpText(drawn, 'ck-sc')).toMatch(/^sc = session cost: /)
    expect(helpText(drawn, 'ck-limits')).toBe('plan limits: 5h (5-hour window) · w (weekly, all models)')
    expect(drawn.find((n) => n.type === 'Box' && n.children?.some((c: any) => c === kept))?.props?.flexWrap).toBe('wrap')
    await ui.unmount()
  }
})

// Autonomous mode: the band's A toggle
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as any
async function startAuto($: any, on: any) {
  const transcript = JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60000).toISOString(), message: { role: 'assistant' } })
  const submitted: string[] = []
  const ctx = await start($, on, (on) => {
    on('session.messages', () => ({ value: [{ role: 'assistant', text: 'ok', toolUses: [] }] }))
    on('prompt.submit', (_: any, e: any) => { submitted.push(e.text); return { text: e.text } })
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
    on('tool.call', (_: any, e: any) => { if (e.tool === 'Write') files[HF] = handoffFile('active'); return { result: { text: '' } } })
    on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }))
  }, { 'D:/home/t/.claude/projects/d--VSC-demo/sess-1.jsonl': transcript })
  const files = ctx.files
  const all = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(all)] : [])
  const band = async (surface: 'terminal' | 'desktop' = 'terminal') => {
    const ui = await $.ui.mount({ plugin: 'session-band', surface, component: 'AbovePrompt', props: {} as any })
    const drawn = all(await ui.drawn())
    return { ui, drawn }
  }
  const toggle = async () => {
    const { ui } = await band()
    await ui.press({ key: 'auto' })
    await ui.unmount()
  }
  const handoffTurn = async (id: string, write: boolean) => {
    await $.turn.start({ turnId: id } as any)
    if (write) await $.tool.call({ tool: 'Write', file_path: HF, content: '...' } as any)
    await $.turn.complete({ reason: 'answer', answer: write ? 'Handoff written.' : 'All done.', durationMs: 1, isAborted: false, turnId: id } as any)
  }
  return { ...ctx, submitted, band, toggle, handoffTurn, all }
}

for (const on_ of [true, false]) {
  test(`with A ${on_ ? 'on' : 'off'}, a ready handoff ${on_ ? 'is cleared and continued once the session is idle' : 'waits for c'}`, async ($, on) => {
    const { ran, clock, submitted, toggle, handoffTurn, live } = await startAuto($, on)
    if (on_) await toggle()
    expect(live().auto).toBe(on_)
    await handoffTurn('t1', true)
    expect(live().handoff).toBe('ready')
    // a short grace after the turn end
    await clock.advance(2000)
    expect(ran).not.toContain('clear')
    await clock.advance(4000)
    expect(ran.includes('clear')).toBe(on_)
    expect(submitted.some((t) => t.startsWith(`Continue from session handoff: read ${HF}`))).toBe(on_)
  })
}

test('with A on, a turn that ends without a handoff turns A off and clears nothing', async ($, on) => {
  const { ran, clock, toggle, handoffTurn, live, toasts } = await startAuto($, on)
  await toggle()
  await handoffTurn('t1', false)
  await clock.advance(6000)
  expect(ran).not.toContain('clear')
  expect(live().auto).toBe(false)
  expect(toasts.some((t) => /^Autonomous mode off/.test(t))).toBe(true)
})

test('with A on, clear and continue waits for running background agents', async ($, on) => {
  const { ran, clock, toggle, handoffTurn, agents } = await startAuto($, on)
  await toggle()
  agents.value = [{ status: 'running' }]
  await handoffTurn('t1', true)
  await clock.advance(6000)
  expect(ran).not.toContain('clear')
  agents.value = []
  await clock.advance(30000)
  expect(ran).toContain('clear')
})

test('with A on, the system prompt says nobody is at the keyboard and questions go back to Claude', async ($, on) => {
  const { toggle } = await startAuto($, on)
  const ask = { tool: 'AskUserQuestion', input: { questions: [] } } as any
  expect((await $.prompt.compose(COMPOSE)).sections.map((s: any) => s.id)).toEqual(['intro'])
  expect((await $.tool.call(ask) as any).deny).toBeUndefined()
  await toggle()
  const sections = (await $.prompt.compose(COMPOSE)).sections
  expect(sections.map((s: any) => [s.id, s.scope])).toEqual([['intro', 'shared'], ['session-band:auto', 'session']])
  expect(sections[1].text).toMatch(/nobody is at the keyboard/)
  expect((await $.tool.call(ask) as any).deny).toMatch(/recommended option/)
  await toggle()
  expect((await $.prompt.compose(COMPOSE)).sections.map((s: any) => s.id)).toEqual(['intro'])
})

test('the A button is highlighted while on and explains itself on hover', async ($, on) => {
  const { band, toggle, all, toasts } = await startAuto($, on)
  const look = async (surface: 'terminal' | 'desktop') => {
    const { ui, drawn } = await band(surface)
    const button = drawn.find((n) => n.type === 'Button' && n.props.key === 'auto')
    const help = drawn.find((n) => n.type === 'Box' && n.hover?.scope === 'ck-auto' && n.hover?.display === 'flex')
    await ui.unmount()
    return { button, help: all(help).find((n) => n.type === 'Text')?.children.join('') }
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const off = await look(surface)
    expect(off.button.props.label).toBe('A')
    expect(off.button.hover?.scope).toBe('ck-auto')
    expect(off.button.props.plain).toBeUndefined()
    expect(off.button.props.variant).toBe('secondary')
    expect(off.button.props.dimColor).toBe(true)
    expect(off.help).toMatch(/^A = autonomous mode: off\./)
  }
  await toggle()
  expect(toasts.some((t) => /^Autonomous mode on/.test(t))).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const lit = await look(surface)
    expect(lit.button.props.variant).toBe('primary')
    expect(lit.button.props.dimColor).toBe(false)
    expect(lit.help).toMatch(/^A = autonomous mode: on\./)
  }
})
