// Moves <root>/<folder> to <root>/.trash/<folder>-<yyyymmdd-hhmmss> and prints the new path.
// Claude Code loads no skills from dot folders, so a trashed skill stops loading.
import { lstatSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const [root, folder] = process.argv.slice(2)
const fail = text => {
  console.error(text)
  process.exit(1)
}

if (!root || !folder) fail('usage: trash.mjs <skills root> <skill folder>')
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder) || folder.includes('..')) fail(`refused folder name: ${folder}`)

const source = join(root, folder)
try {
  const stat = lstatSync(source)
  if (!stat.isDirectory() && !stat.isSymbolicLink()) fail(`not a folder: ${source}`)
} catch {
  fail(`not found: ${source}`)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const trash = join(root, '.trash')
mkdirSync(trash, { recursive: true })
const target = join(trash, `${folder}-${stamp}`)
renameSync(source, target)
process.stdout.write(`${target}\n`)
