export type Offer = { version: string; installed: string; url: string; sha256: string }
// disableAutoUpdates as read from the real registry: null = not set, 1 = updater off
export type Policy = { sid: string; user: number | null; machine: number | null }
// policy and autoPending are optional: a view stored by an older version has neither
export type View = { offer: Offer | null; phase: 'offer' | 'confirm' | 'installing'; since: number; policy?: Policy | null; autoPending?: 0 | 1 | null }

declare module 'claude-code' {
  interface PluginState {
    'desktop-update': { view: View }
  }
}
