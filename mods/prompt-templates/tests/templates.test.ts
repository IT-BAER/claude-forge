import { expect, test } from 'claude-code/testing'

import { exportJson, filterTemplates, findByName, mergeImport, parseImport, parseTags, parseVars, renderTemplate, tagsOf, validateTemplate } from '../hooks/templates'

const t = (name: string, body = '', tags: string[] = []) => ({ id: name, name, tags, body, updatedAt: 1 })

test('variables are listed once each, in order of first use', () => {
  expect(parseVars('Review {{file}} for {{topic}}, then {{file}} again')).toEqual(['file', 'topic'])
})

test('escaped braces are not variables and render as literal braces', () => {
  expect(parseVars('Use \\{{name}} literally and {{real}}')).toEqual(['real'])
  expect(renderTemplate('Use \\{{name}} and {{real}}', { real: 'x' })).toBe('Use {{name}} and x')
})

test('rendering fills every variable and leaves missing ones empty', () => {
  expect(renderTemplate('Hi {{a}}, {{b}}! {{a}}', { a: 'A' })).toBe('Hi A, ! A')
})

test('variable names allow letters, digits, dash and underscore only', () => {
  expect(parseVars('{{ok_1}} {{also-ok}} {{not ok}} {{}}')).toEqual(['ok_1', 'also-ok'])
})

test('search matches name, body and tags case-insensitively; tag filter is exact', () => {
  const list = [t('Review', 'check code', ['dev']), t('Mail', 'write a MAIL', ['comms']), t('Deploy', 'ship it', ['dev', 'ops'])]
  expect(filterTemplates(list, 'mail').map(x => x.name)).toEqual(['Mail'])
  expect(filterTemplates(list, 'OPS').map(x => x.name)).toEqual(['Deploy'])
  expect(filterTemplates(list, '', 'dev').map(x => x.name)).toEqual(['Deploy', 'Review'])
  expect(filterTemplates(list, 'ship', 'dev').map(x => x.name)).toEqual(['Deploy'])
})

test('tags are parsed from a comma list, trimmed, lowercased and deduplicated', () => {
  expect(parseTags(' Dev, ops ,dev,, ')).toEqual(['dev', 'ops'])
  expect(tagsOf([t('a', '', ['x', 'b']), t('b', '', ['b'])])).toEqual(['b', 'x'])
})

test('validation refuses empty or long names, long bodies and too many tags', () => {
  expect(validateTemplate({ name: 'ok', tags: [], body: 'x' })).toBeUndefined()
  expect(validateTemplate({ name: ' ', tags: [], body: 'x' })).toMatch(/name/i)
  expect(validateTemplate({ name: 'n'.repeat(81), tags: [], body: 'x' })).toMatch(/name/i)
  expect(validateTemplate({ name: 'ok', tags: [], body: 'x'.repeat(30001) })).toMatch(/body/i)
  expect(validateTemplate({ name: 'ok', tags: Array.from({ length: 11 }, (_, i) => `t${i}`), body: 'x' })).toMatch(/tags/i)
  expect(validateTemplate({ name: 'ok', tags: ['t'.repeat(31)], body: 'x' })).toMatch(/tag/i)
  expect(validateTemplate({ name: 'a\u0007b', tags: [], body: 'x' })).toMatch(/name/i)
})

test('lookup by name is exact first, then a unique prefix, case-insensitive', () => {
  const list = [t('review'), t('review-pr'), t('mail')]
  expect(findByName(list, 'Review')?.name).toBe('review')
  expect(findByName(list, 'ma')?.name).toBe('mail')
  expect(findByName(list, 'rev')).toBeUndefined()
  expect(findByName(list, 'zzz')).toBeUndefined()
})

test('export then import round-trips name, tags and body', () => {
  const list = [t('One', 'body {{x}}', ['a']), t('Two', 'second\nline')]
  const parsed = parseImport(exportJson(list))
  expect('error' in parsed).toBe(false)
  if ('error' in parsed) return
  expect(parsed.templates).toEqual([{ name: 'One', tags: ['a'], body: 'body {{x}}' }, { name: 'Two', tags: [], body: 'second\nline' }])
})

test('import accepts a bare array and rejects the whole file on any bad entry', () => {
  expect('templates' in parseImport('[{"name":"a","body":"b"}]')).toBe(true)
  expect(parseImport('not json')).toEqual({ error: expect.stringMatching(/JSON/) })
  expect(parseImport('{"templates":[{"name":"a","body":"b"},{"name":"","body":"c"}]}')).toEqual({ error: expect.stringMatching(/2/) })
  expect(parseImport('{"templates":[{"name":"a","body":5}]}')).toEqual({ error: expect.stringMatching(/body/i) })
  expect(parseImport('{"x":1}')).toEqual({ error: expect.stringMatching(/templates/i) })
})

test('merge replaces or skips templates with the same name and adds the rest', () => {
  const existing = [t('Keep', 'old'), t('Same', 'old')]
  const incoming = [{ name: 'same', tags: ['n'], body: 'new' }, { name: 'Fresh', tags: [], body: 'f' }]
  const replaced = mergeImport(existing, incoming, 'replace', 5, () => 'id')
  expect(replaced.added).toBe(1)
  expect(replaced.replaced).toBe(1)
  expect(replaced.list.find(x => x.name.toLowerCase() === 'same')?.body).toBe('new')
  expect(replaced.list.find(x => x.name.toLowerCase() === 'same')?.id).toBe('Same')
  const skipped = mergeImport(existing, incoming, 'skip', 5, () => 'id')
  expect(skipped.skipped).toBe(1)
  expect(skipped.list.find(x => x.name === 'Same')?.body).toBe('old')
  expect(skipped.list).toHaveLength(3)
})
