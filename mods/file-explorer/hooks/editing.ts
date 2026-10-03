import type { Preview } from '../types'
import type { EditorProps } from './editor'

const PROSE_EXT = ['md', 'markdown', 'txt', 'text']

export function editorProps(p: Preview, rows = 20, fit = 1, top = 0, span = 40): EditorProps {
  const ext = (/\.([^./\\]+)$/.exec(p.path)?.[1] ?? '').toLowerCase()
  return { request: p.request, text: p.draft ?? '', instance: p.editorInstance ?? '', seq: p.editorSeq ?? 0,
    refresh: p.editorRefresh ?? 0, cursor: p.editorCursor ?? 0, busy: !!p.busy, rows, fit, top, span, win: p.editorWin ?? 0,
    wrap: p.editorWrap ?? PROSE_EXT.includes(ext), ext }
}

export function sourceChunks(text: string): { text: string; line: number }[] {
  const chunks: { text: string; line: number }[] = []
  let line = 1
  while (text.length) {
    let length = Math.min(9000, text.length)
    if (length < text.length) {
      const newline = text.lastIndexOf('\n', length - 1)
      if (newline >= 0) length = newline + 1
      if (/[\ud800-\udbff]/.test(text[length - 1] ?? '')) length--
    }
    const part = text.slice(0, length)
    chunks.push({ text: part, line })
    line += (part.match(/\n/g) ?? []).length
    text = text.slice(length)
  }
  return chunks
}

export function markdownChunks(text: string): { text: string; code?: string }[] {
  if (text.length <= 10000) return [{ text }]
  const result: { text: string; code?: string }[] = []
  let pending = ''
  let block = ''
  let fence = ''
  let language = ''
  const flush = () => { if (pending) { result.push({ text: pending }); pending = '' } }
  const add = (part: string) => {
    if (part.length > 9000) { flush(); for (const chunk of sourceChunks(part)) result.push({ text: chunk.text, code: 'text' }); return }
    if (pending.length + part.length > 9000) flush()
    pending += part
  }
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s*(`{3,}|~{3,})([^\s]*)/.exec(line)
    if (!fence && marker) { if (block) { add(block); block = '' } fence = marker[1]!; language = marker[2] ?? '' }
    else if (fence && marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length) {
      block += line
      if (block.length > 9000) {
        flush()
        const contents = block.slice(block.indexOf('\n') + 1, block.lastIndexOf(line))
        for (const chunk of sourceChunks(contents)) result.push({ text: chunk.text, code: language || 'text' })
      } else add(block)
      block = ''; fence = ''; continue
    }
    block += line
    if (!fence && !line.trim()) { add(block); block = '' }
  }
  if (block) add(block)
  flush()
  return result
}
