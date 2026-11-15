import type { ThemeSetArgs } from 'claude-code'

import { githubDarkColors } from './palette'

const look: ThemeSetArgs = {
  colors: githubDarkColors('GitHub Dark Default', 'github-dark'),
  backdrop: { color: '#010409' },
}

export const githubDark = { id: 'github-dark', label: 'GitHub Dark', look }
