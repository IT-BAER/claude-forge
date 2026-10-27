// Run with: node --test scripts/scripts.spec.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const temp = () => mkdtempSync(join(tmpdir(), 'skill-manager-'))

const line = row => JSON.stringify(row)
const skillCall = (id, skill, timestamp) =>
  line({
    type: 'assistant',
    timestamp,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] },
  })
const slash = (uuid, name, timestamp) =>
  line({ type: 'user', uuid, timestamp, message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-args></command-args>` } })

test('usage-scan counts Skill calls and slash commands once each, with the latest time', () => {
  const dir = temp()
  try {
    mkdirSync(join(dir, 'proj', 'sub', 'subagents'), { recursive: true })
    writeFileSync(
      join(dir, 'proj', 'a.jsonl'),
      [
        skillCall('t1', 'alpha', '2026-10-01T00:00:00.000Z'),
        skillCall('t2', 'alpha', '2026-10-05T00:00:00.000Z'),
        slash('u1', 'gamma', '2026-10-02T00:00:00.000Z'),
        'not json',
        // A tool result that quotes a command tag is not a typed command.
        line({ type: 'user', uuid: 'u9', message: { content: [{ type: 'tool_result', content: '<command-name>/gamma</command-name>' }] } }),
      ].join('\n'),
    )
    // A forked transcript repeats rows: the ids dedupe them.
    writeFileSync(
      join(dir, 'proj', 'sub', 'subagents', 'b.jsonl'),
      [skillCall('t1', 'alpha', '2026-10-01T00:00:00.000Z'), slash('u1', 'gamma', '2026-10-02T00:00:00.000Z')].join('\r\n'),
    )
    const out = JSON.parse(execFileSync(process.execPath, [join(here, 'usage-scan.mjs'), dir], { encoding: 'utf8' }))

    assert.equal(out.files, 2)
    assert.deepEqual(out.skills, { alpha: { count: 2, last: '2026-10-05T00:00:00.000Z' } })
    assert.deepEqual(out.commands, { gamma: { count: 1, last: '2026-10-02T00:00:00.000Z' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trash moves one skill folder into .trash under its root', () => {
  const root = temp()
  try {
    mkdirSync(join(root, 'alpha'))
    writeFileSync(join(root, 'alpha', 'SKILL.md'), '# alpha')
    const out = execFileSync(process.execPath, [join(here, 'trash.mjs'), root, 'alpha'], { encoding: 'utf8' }).trim()

    assert.equal(existsSync(join(root, 'alpha')), false)
    assert.equal(dirname(out), join(root, '.trash'))
    assert.ok(existsSync(join(out, 'SKILL.md')))
    assert.match(readdirSync(join(root, '.trash'))[0], /^alpha-\d{8}-\d{6}$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('trash refuses names that leave the root', () => {
  const root = temp()
  try {
    for (const name of ['..', '../x', 'a\\b', '.trash', '']) {
      const run = spawnSync(process.execPath, [join(here, 'trash.mjs'), root, name], { encoding: 'utf8' })
      assert.notEqual(run.status, 0, name)
    }
    const missing = spawnSync(process.execPath, [join(here, 'trash.mjs'), root, 'nope'], { encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
