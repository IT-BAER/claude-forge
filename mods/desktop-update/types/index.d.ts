export type Offer = { version: string; installed: string; url: string; sha256: string; size: number }
export type View = { offer: Offer | null; phase: 'offer' | 'confirm' | 'installing' }

declare module 'claude-code' {
  interface PluginState {
    'desktop-update': { view: View }
  }
}
