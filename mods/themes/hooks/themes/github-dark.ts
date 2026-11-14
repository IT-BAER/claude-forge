import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from '../make-colors.js'

// github.com dark, @primer/primitives 11.10.0 (functional/themes/dark.css).
// Role seeds are the fgColor-* values; stop 450 pins the button fill to bgColor-*-emphasis.
const { theme } = makeColors({
  label: 'GitHub Dark Default',
  id: 'github-dark',
  only: 'dark',
  roles: {
    accent: { seed: '#4493f8', stops: { 450: '#1f6feb' } },
    danger: { seed: '#f85149', stops: { 450: '#da3633' } },
    success: { seed: '#3fb950', stops: { 450: '#238636' } },
    warning: '#d29922',
    pro: { seed: '#ab7df8', stops: { 450: '#8957e5' } },
  },
  dark: {
    gray: {
      // Desktop: chat page = surface-0; title strip, prompt dock, question panel and sidebar
      // (at 80%) = surface-1; prompt box and menus = surface-3.
      anchors: {
        'surface-0': '#010409',
        'surface-1': '#010409',
        'surface-2': '#0d1117',
        'surface-3': '#0d1117',
        'text-primary': '#f0f6fc',
        'text-muted': '#9198a1',
      },
      // gray-0 is the base of the white overlays and the primary button; extrapolated it is #ffffff.
      stops: { 0: '#f0f6fc' },
    },
    git: {
      added: '#3fb950',
      removed: '#f85149',
      modified: '#d29922',
      merged: '#ab7df8',
      closed: '#f85149',
      conflicting: '#db6d28',
      draft: '#9198a1',
    },
  },
  // Closest GitHub theme in Desktop's chat highlighter, which has no github-dark-default.
  codeTheme: { dark: 'github-dark-high-contrast' },
})

const look: ThemeSetArgs = { colors: theme, backdrop: { color: '#010409' } }

export const githubDark = { id: 'github-dark', label: 'GitHub Dark', look }
