import type { ThemeSetArgs } from 'claude-code'

import { githubDarkColors } from './palette'
import { nebulaScene, orbitScene, starsScene, warpScene } from './space-scenes'

// Low blur keeps stars as points; the tint is the GitHub Dark page color.
const GLASS = { blur: 2, tint: '#010409', opacity: 0.6 }

const space = (id: string, label: string, alt: string, build: () => string) => {
  const look: ThemeSetArgs = { colors: githubDarkColors(label, id), backdrop: { scene: id, glass: GLASS } }
  let drawn: string | undefined
  // The app asks for the scene again on each draw, so it is built once.
  return { id, label, look, alt, scene: () => (drawn ??= build()) }
}

export const spaceThemes = [
  space('space-stars', 'Space Deep Field', 'A deep field of slowly drifting stars with a rare meteor', starsScene),
  space('space-nebula', 'Space Nebula', 'Stars behind slow blue, purple and pink clouds in the corners', nebulaScene),
  space('space-orbit', 'Space Orbit', 'The lit edge of a planet in the top right corner, circled by a moon', orbitScene),
  space('space-warp', 'Space Warp', 'Streaks of starlight running outward from the middle', warpScene),
]
