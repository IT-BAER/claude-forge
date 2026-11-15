import type { Register } from 'claude-code'

import { githubDark } from './themes/github-dark'
import { spaceThemes } from './themes/space'

// The first theme is the default until the user picks one.
const THEMES = [githubDark, ...spaceThemes]
const OFF = 'off'

const byId = (id: unknown) => THEMES.find(theme => theme.id === id)
// The stored choice as a theme, undefined for off; unset or a removed theme gives the default.
const fromStore = (chosen: unknown) => (chosen === OFF ? undefined : (byId(chosen) ?? THEMES[0]))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'themes',
      description: 'Themes: list them, switch with /themes <name>, /themes off for the app look',
      argumentHint: '[name|off]',
      immediate: true,
    })
    const theme = fromStore(await $.store.get('theme'))
    if (theme) await $.theme.set(theme.look)
    return next(e)
  })

  // Every mod's backdrop comes by here, and only a window or a phone draws one.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    const theme = e.props.plugin === $.plugin.name ? spaceThemes.find(({ id }) => id === e.props.scene) : undefined
    if (!theme || (e.surface !== 'desktop' && e.surface !== 'mobile')) return next(e)
    const { Svg } = $.ui.resolve(e)
    return Svg({ source: theme.scene(), alt: theme.alt, isInteractive: true })
  })

  on('command.run', { command: 'themes' }, async ($, e) => {
    const name = e.args.trim()
    if (!name) {
      const theme = fromStore(await $.store.get('theme'))
      const lines = [
        `Current theme: ${theme?.label ?? OFF}`,
        'Themes:',
        ...THEMES.map(({ id, label }) => `- ${id}: ${label}`),
        "/themes <name> switches, /themes off returns to the app's own look.",
      ]
      return { text: lines.join('\n') }
    }
    if (name === OFF) {
      await $.theme.clear()
      await $.store.set('theme', OFF)
      return { text: "Theme off: the app's own look. /themes lists the themes." }
    }
    const theme = byId(name)
    if (theme) {
      await $.theme.set(theme.look)
      await $.store.set('theme', theme.id)
      return { text: `Theme: ${theme.label}.` }
    }
    return { text: `No theme named ${name}. Themes: ${THEMES.map(({ id }) => id).join(', ')}.` }
  })
}
