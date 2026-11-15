import { expect, mock, test } from 'claude-code/testing'

// Each hook here stands for the engine. `looks` records what the app is told to draw:
// a theme's colors label for a set, 'clear' for a clear.
function engine(on: any, stored?: Record<string, unknown>) {
  const looks: string[] = []
  const commands: any[] = []
  mock.store(on, stored)
  on('theme.set', (_: any, e: any) => {
    looks.push(e.colors.label)
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    looks.push('clear')
    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('command.register', (_: any, e: any) => {
    commands.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  return { looks, commands }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'themes', args })

test('session start offers /themes, runnable mid-turn', async ($, on) => {
  const { commands } = engine(on)
  await start($)

  expect(commands.length).toBe(1)
  expect(commands[0].name).toBe('themes')
  expect(commands[0].argumentHint).toBe('[name|off]')
  expect(commands[0].immediate).toBe(true)
})

test('/themes off clears the look, and later sessions start without one', async ($, on) => {
  const { looks } = engine(on)
  await start($)
  const out = await run($, 'off')
  await start($)

  expect(looks).toEqual(['GitHub Dark Default', 'clear'])
  expect(out.text).toBe("Theme off: the app's own look. /themes lists the themes.")
})

test('/themes <name> sets that theme now and in later sessions', async ($, on) => {
  const { looks } = engine(on, { theme: 'off' })
  await start($)
  const out = await run($, 'github-dark')
  await start($)

  expect(looks).toEqual(['GitHub Dark Default', 'GitHub Dark Default'])
  expect(out.text).toBe('Theme: GitHub Dark.')
})

const LIST = [
  'Themes:',
  '- github-dark: GitHub Dark',
  '- space-stars: Space Deep Field',
  '- space-nebula: Space Nebula',
  '- space-orbit: Space Orbit',
  '- space-warp: Space Warp',
  "/themes <name> switches, /themes off returns to the app's own look.",
].join('\n')

test('/themes alone lists the themes and the current one, and changes nothing', async ($, on) => {
  const { looks } = engine(on)
  await start($)
  const out = await run($, '')
  await run($, 'off')
  const offOut = await run($, '  ')

  expect(looks).toEqual(['GitHub Dark Default', 'clear'])
  expect(out.text).toBe('Current theme: GitHub Dark\n' + LIST)
  expect(offOut.text).toBe('Current theme: off\n' + LIST)
})

test('an unknown name changes nothing and names the themes', async ($, on) => {
  const { looks } = engine(on)
  await start($)
  const out = await run($, 'solarized')
  await start($)

  expect(looks).toEqual(['GitHub Dark Default', 'GitHub Dark Default'])
  expect(out.text).toBe('No theme named solarized. Themes: github-dark, space-stars, space-nebula, space-orbit, space-warp.')
})

test('a stored theme that no longer exists starts the default', async ($, on) => {
  const { looks } = engine(on, { theme: 'retired-theme' })
  await start($)

  expect(looks).toEqual(['GitHub Dark Default'])
})
