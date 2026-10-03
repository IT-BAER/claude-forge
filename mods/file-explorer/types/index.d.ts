export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }
export type Preview = {
  path: string
  request: number
  kind: 'loading' | 'text' | 'image' | 'error' | 'unsupported'
  content: string
  markdown: boolean
  rendered: boolean
  notice: string
  realPath?: string
  editable?: boolean
  draft?: string
  savedText?: string
  hash?: string
  encoding?: string
  eol?: string
  editing?: boolean
  dirty?: boolean
  busy?: boolean
  confirmBack?: boolean
  error?: string
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
  editorWrap?: boolean
}
export type Tree = {
  root: string
  dirs: Record<string, Entry[]>
  open: string[]
  filter: string
  picked: string
  git: Record<string, string>
  reveal: { dir: string; n: number }
  pin: string
  tick: number
  menu?: string
  menuMode?: 'rename' | 'delete' | 'newfile' | 'newfolder'
  menuText?: string
  preview?: Preview
}

declare module 'claude-code' {
  interface PluginState {
    'file-explorer': { tree: Tree }
  }
}
