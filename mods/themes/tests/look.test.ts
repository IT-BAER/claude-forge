import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

function engine(on: any) {
  const sets: any[] = []
  mock.store(on)
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('theme.set', (_: any, e: any) => {
    sets.push(e)
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  return sets
}

async function start($: any, on: any, surface: (typeof SURFACES)[number]) {
  const sets = engine(on)
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  return sets
}

test('session start sets the look once, on every surface', async ($, on) => {
  const sets = engine(on)

  for (const [i, surface] of SURFACES.entries()) {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    expect(sets.length).toBe(i + 1)
  }
})

test('the look is dark only, with github.com Primer colors and code theme', async ($, on) => {
  const [args] = await start($, on, 'desktop')
  const { colors } = args
  const dark = colors.inputs.dark

  expect(colors.label).toBe('GitHub Dark Default')
  expect(Object.keys(colors.inputs)).toEqual(['dark'])
  // Desktop's chat highlighter has no github-dark-default; an unknown name falls back to #191919.
  expect(colors.codeTheme).toEqual({ dark: 'github-dark-high-contrast' })
  expect(colors.contrast).toBeUndefined()
  expect(args.backdrop).toEqual({ color: '#010409' })

  // Desktop paints the chat page from gray-900, the title strip, prompt dock, question
  // panel and sidebar (at 80%) from gray-850, the prompt box from gray-800.
  expect(dark['gray-900']).toBe('#010409')
  expect(dark['gray-850']).toBe('#010409')
  expect(dark['gray-830']).toBe('#0d1117')
  expect(dark['gray-800']).toBe('#0d1117')
  expect(dark['gray-50']).toBe('#f0f6fc')
  expect(dark['gray-400']).toBe('#9198a1')
  expect(dark['gray-0']).toBe('#f0f6fc')
  expect(dark['role-accent-fill']).toBe('#1f6feb')
  expect(dark['role-accent-on']).toBe('#ffffff')
  expect(dark['role-success-fill']).toBe('#238636')
  expect(dark['role-danger-fill']).toBe('#da3633')
  expect(dark['text-git-added']).toBe('#3fb950')
  expect(dark['text-git-removed']).toBe('#f85149')
  expect(dark['text-git-merged']).toBe('#ab7df8')
})

test('Desktop paints the look: no contrast line refuses it', async ($, on) => {
  const [{ colors }] = await start($, on, 'desktop')
  const refused = checkColors(colors).filter(line => line.startsWith("Desktop won't paint"))

  expect(refused).toEqual([])
})
