export type Template = { id: string; name: string; tags: string[]; body: string; updatedAt: number }
export type TemplateDraft = { name: string; tags: string[]; body: string }
export type Action = 'fill' | 'insert' | 'send' | 'copy'
export type Editor = {
  id?: string
  name: string
  tags: string
  savedName: string
  savedTags: string
  draft: string
  saved: string
  busy?: boolean
  confirmBack?: boolean
  request: number
  editorInstance?: string
  editorSeq?: number
  editorRefresh?: number
  editorCursor?: number
  editorRow?: number
  editorCol?: number
  editorSelected?: number
  editorWin?: number
  editorLine?: number
  editorTotal?: number
  editorCaret?: number
  editorAnchor?: number
  editorWrap?: boolean
}
export type View = {
  mode: 'list' | 'vars' | 'edit' | 'delete' | 'io'
  query: string
  tag: string
  selected: string
  action?: Action
  vars: Record<string, string>
  edit?: Editor
  ioPath: string
  notice: string
  error: string
  tick: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-templates': { view: View }
  }
}
