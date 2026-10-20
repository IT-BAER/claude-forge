import type { Template, TemplateDraft } from '../types'

export const MAX_NAME = 80
export const MAX_BODY = 30000
export const MAX_TAGS = 10
export const MAX_TAG = 30

// `\{{` escapes a literal `{{`; the lookbehind keeps it out of the variable set.
const VAR = /(?<!\\)\{\{([A-Za-z0-9_-]{1,40})\}\}/g
const CONTROL = /[\x00-\x1f\x7f-\x9f]/

export function parseVars(body: string): string[] {
  return [...new Set([...body.matchAll(VAR)].map(m => m[1]!))]
}

export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VAR, (_, name: string) => values[name] ?? '').replace(/\\\{\{/g, '{{')
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))]
}

export function tagsOf(list: readonly Template[]): string[] {
  return [...new Set(list.flatMap(t => t.tags))].sort()
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

export function filterTemplates(list: readonly Template[], query: string, tag = ''): Template[] {
  const q = query.trim().toLowerCase()
  return list
    .filter(t => !tag || t.tags.includes(tag))
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.tags.some(x => x.includes(q)))
    .sort(byName)
}

export function validateTemplate(t: TemplateDraft): string | undefined {
  const name = t.name.trim()
  if (!name || name.length > MAX_NAME || CONTROL.test(name)) return `Name must be 1-${MAX_NAME} characters without control characters.`
  if (t.body.length > MAX_BODY) return `Body exceeds ${MAX_BODY} characters.`
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(t.body)) return 'Body contains unsupported control characters.'
  if (t.tags.length > MAX_TAGS) return `At most ${MAX_TAGS} tags.`
  if (t.tags.some(x => !x || x.length > MAX_TAG || CONTROL.test(x) || x.includes(','))) return `Each tag must be 1-${MAX_TAG} characters without commas.`
  return undefined
}

export function findByName(list: readonly Template[], name: string): Template | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  const exact = list.find(t => t.name.toLowerCase() === n)
  if (exact) return exact
  const prefixed = list.filter(t => t.name.toLowerCase().startsWith(n))
  return prefixed.length === 1 ? prefixed[0] : undefined
}

export function exportJson(list: readonly Template[]): string {
  return JSON.stringify({ version: 1, templates: [...list].sort(byName).map(t => ({ name: t.name, tags: t.tags, body: t.body })) }, null, 2)
}

export function parseImport(text: string): { templates: TemplateDraft[] } | { error: string } {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { error: 'File is not valid JSON.' } }
  const items = Array.isArray(data) ? data : (data as { templates?: unknown } | null)?.templates
  if (!Array.isArray(items)) return { error: 'File has no templates list.' }
  const templates: TemplateDraft[] = []
  for (const [i, item] of items.entries()) {
    const it = item as { name?: unknown; tags?: unknown; body?: unknown } | null
    if (!it || typeof it.name !== 'string' || typeof it.body !== 'string') return { error: `Entry ${i + 1}: name and body must be text.` }
    if (it.tags !== undefined && (!Array.isArray(it.tags) || !it.tags.every(x => typeof x === 'string'))) return { error: `Entry ${i + 1}: tags must be a list of text.` }
    const draft = { name: it.name.trim(), tags: parseTags(((it.tags as string[] | undefined) ?? []).join(',')), body: it.body.replace(/\r\n?/g, '\n') }
    const error = validateTemplate(draft)
    if (error) return { error: `Entry ${i + 1}: ${error}` }
    templates.push(draft)
  }
  return { templates }
}

export function mergeImport(existing: readonly Template[], incoming: readonly TemplateDraft[], mode: 'replace' | 'skip', now: number, newId: () => string) {
  const list = [...existing]
  let added = 0, replaced = 0, skipped = 0
  for (const d of incoming) {
    const at = list.findIndex(t => t.name.toLowerCase() === d.name.toLowerCase())
    if (at < 0) { list.push({ id: newId(), ...d, updatedAt: now }); added++ }
    else if (mode === 'replace') { list[at] = { ...list[at]!, ...d, updatedAt: now }; replaced++ }
    else skipped++
  }
  return { list, added, replaced, skipped }
}
