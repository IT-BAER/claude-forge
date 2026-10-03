export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }
export type Preview = {
  path: string
  request: number
  kind: 'loading' | 'text' | 'image' | 'error' | 'unsupported'
  content: string
  markdown: boolean
  rendered: boolean
  notice: string
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
  preview?: Preview
}

declare module 'claude-code' {
  interface PluginState {
    'file-explorer': { tree: Tree }
  }
}
