// Counts skill runs in Claude Code transcripts (*.jsonl under the given folder).
// Prints JSON: { files, skills: { name: { count, last } }, commands: { name: { count, last } } }.
// Skill tool calls dedupe by tool_use id and typed slash commands by row uuid,
// because forked and resumed sessions copy rows into new transcript files.
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const root = process.argv[2]
if (!root) {
  console.error('usage: usage-scan.mjs <projects folder>')
  process.exit(2)
}

async function* transcripts(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* transcripts(path)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path
  }
}

const skills = {}
const commands = {}
const seen = new Set()
const add = (map, name, timestamp) => {
  const use = (map[name] ??= { count: 0, last: null })
  use.count++
  if (typeof timestamp === 'string' && (use.last === null || timestamp > use.last)) use.last = timestamp
}
const parse = line => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
const COMMAND = /<command-name>\/([^<\s]+)<\/command-name>/g

let files = 0
for await (const file of transcripts(root)) {
  files++
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    const hasSkill = line.includes('"name":"Skill"')
    const hasCommand = line.includes('<command-name>/')
    if (!hasSkill && !hasCommand) continue
    const row = parse(line)
    const content = row?.message?.content
    if (hasSkill && row?.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        const skill = block?.type === 'tool_use' && block.name === 'Skill' ? block.input?.skill : undefined
        if (typeof skill !== 'string' || seen.has(`t:${block.id}`)) continue
        seen.add(`t:${block.id}`)
        add(skills, skill, row.timestamp)
      }
    }
    if (hasCommand && row?.type === 'user') {
      const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => b.text) : []
      for (const text of texts) {
        for (const match of String(text).matchAll(COMMAND)) {
          const key = `c:${row.uuid}:${match[1]}`
          if (seen.has(key)) continue
          seen.add(key)
          add(commands, match[1], row.timestamp)
        }
      }
    }
  }
}

process.stdout.write(JSON.stringify({ files, skills, commands }))
