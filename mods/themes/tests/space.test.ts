import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'
import { nebulaScene, orbitScene, starsScene, warpScene } from '../hooks/themes/space-scenes'

function engine(on: any, stored?: Record<string, unknown>) {
  const sets: any[] = []
  mock.store(on, stored)
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('theme.set', (_: any, e: any) => {
    sets.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  return sets
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = ($: any, args: string) => $.command.run({ command: 'themes', args })

test('/themes space-stars sets GitHub Dark colors over a live scene', async ($, on) => {
  const sets = engine(on, { theme: 'off' })
  await start($)
  const out = await run($, 'space-stars')
  const [args] = sets
  const dark = args.colors.inputs.dark

  expect(out.text).toBe('Theme: Space Deep Field.')
  expect(sets.length).toBe(1)
  expect(args.colors.label).toBe('Space Deep Field')
  expect(Object.keys(args.colors.inputs)).toEqual(['dark'])
  expect(args.colors.codeTheme).toEqual({ dark: 'github-dark-high-contrast' })
  expect(dark['gray-900']).toBe('#010409')
  expect(dark['gray-50']).toBe('#f0f6fc')
  expect(dark['role-accent-fill']).toBe('#1f6feb')
  expect(dark['text-git-added']).toBe('#3fb950')
  // Low blur keeps stars as points; the tint is the GitHub Dark page color.
  expect(args.backdrop).toEqual({ scene: 'space-stars', glass: { blur: 2, tint: '#010409', opacity: 0.6 } })
})

const SCENES = ['space-stars', 'space-nebula', 'space-orbit', 'space-warp'] as const

const backdrop = (scene: string, plugin = 'themes') =>
  ({
    plugin,
    component: 'Backdrop',
    requestId: 'backdrop',
    props: { scene, plugin, glass: { blur: 2, tint: '#010409', opacity: 0.6 } },
  }) as const

// A hook here stands for the engine: it draws what the mod leaves alone.
function engineDraws(on: any) {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['engine'] })
  })
}

test('each space scene is drawn as one self-contained SVG the app accepts', async ($, on) => {
  engineDraws(on)
  const sources = new Set<string>()

  for (const scene of SCENES) {
    const ui = await $.ui.mount({ ...backdrop(scene), surface: 'desktop' })
    const svg: any = await ui.find({ type: 'Svg' })
    const source: string = svg?.props.source ?? ''

    expect(svg?.props.isInteractive).toBe(true)
    expect(svg?.props.alt.length).toBeGreaterThan(10)
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"')).toBe(true)
    expect(source.endsWith('</svg>')).toBe(true)
    // Fills any window, cropped not stretched.
    expect(source.includes('preserveAspectRatio="xMidYMid slice"')).toBe(true)
    // The engine's limit for an Svg source.
    expect(source.length).toBeLessThan(131072)
    // It moves by CSS alone, and rests when the system asks for reduced motion.
    expect(source.includes('@keyframes')).toBe(true)
    expect(source.includes('@media (prefers-reduced-motion:reduce){*{animation:none!important}}')).toBe(true)
    // No script, no handler, nothing loaded from outside the string.
    expect(/<script|<image|<foreignObject|<use|href=|@import|url\((?!#)|\son\w+=/i.test(source)).toBe(false)
    expect(source.replace('xmlns="http://www.w3.org/2000/svg"', '').includes('http')).toBe(false)
    sources.add(source)
    await ui.unmount()
  }

  expect(sources.size).toBe(SCENES.length)
})

const BUILDERS = [starsScene, nebulaScene, orbitScene, warpScene]

test('every build draws the same scene', () => {
  for (const build of BUILDERS) {
    const first = build()

    expect(first.startsWith('<svg ')).toBe(true)
    expect(build()).toBe(first)
  }
})

// The app redraws the window on every change of the scene. Motion on every frame is too costly on a
// fast display, and one change a second reads as stutter. So everything but a meteor moves in steps
// on one shared grid of 20 a second: every step is a whole number of twentieths, none longer than 0.2 s.
test('everything but a meteor moves on a shared grid of 20 steps a second', () => {
  const GRID = 1 / 20
  const onGrid = (seconds: number) => Math.abs(seconds / GRID - Math.round(seconds / GRID)) < 1e-6

  for (const build of BUILDERS) {
    const source = build()
    const stepped = source.replace(/\.mt\{[^}]*\}/, '')

    expect(source.includes('.mt{opacity:0;animation:mt 60s linear infinite}')).toBe(true)
    expect(/\b(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier)\b/.test(stepped.replace(/<linearGradient/g, ''))).toBe(false)
    for (const [, value] of source.matchAll(/(?:animation-(?:duration|delay):|steps\(\d+\) )(-?[\d.]+)s/g)) {
      expect(onGrid(Number(value))).toBe(true)
    }

    // A steps() count applies to each part between two keyframes, so a part's step is its length over the count.
    const parts = new Map<string, number[]>()
    for (const [, name, body] of source.matchAll(/@keyframes (\w+)\{((?:[^{}]+\{[^{}]*\})+)\}/g)) {
      const stops = [...body!.matchAll(/([^{}]+)\{/g)].flatMap(([, selector]) =>
        selector!.split(',').map(stop => (stop === 'from' ? 0 : stop === 'to' ? 100 : parseFloat(stop))),
      )
      const sorted = [...new Set([0, 100, ...stops])].sort((a, b) => a - b)
      parts.set(name!, sorted.slice(1).map((stop, i) => (stop - sorted[i]!) / 100))
    }
    const loops = [
      ...source.matchAll(/(?:animation:|,)(\w*) ?([\d.]+)s steps\((\d+)\)/g),
      ...[...source.matchAll(/animation-duration:([\d.]+)s;animation-timing-function:steps\((\d+)\)/g)].map(
        ([all, seconds, count]) => [all, 'nb', seconds, count],
      ),
    ]
    expect(loops.length).toBeGreaterThan(0)
    for (const [, name, seconds, count] of loops) {
      const lengths = (parts.get(name!) ?? [1]).map(part => (part * Number(seconds)) / Number(count))

      expect(lengths.every(onGrid)).toBe(true)
      expect(Math.min(...lengths)).toBeLessThan(0.2 + 1e-6)
    }
  }
})

test("another mod's backdrop, an unknown scene and the terminal go to the engine", async ($, on) => {
  engineDraws(on)
  const cases = [
    { ...backdrop('space-stars', 'other-mod'), surface: 'desktop' },
    { ...backdrop('lagoon'), surface: 'desktop' },
    { ...backdrop('space-stars'), surface: 'terminal' },
  ] as const

  for (const args of cases) {
    const ui = await $.ui.mount(args)
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the mobile app draws the scene too', async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...backdrop('space-orbit'), surface: 'mobile' })

  const svg: any = await ui.find({ type: 'Svg' })

  expect(svg?.props.source.startsWith('<svg ')).toBe(true)
  await ui.unmount()
})

test('Desktop paints every space look: no contrast line refuses it', async ($, on) => {
  const sets = engine(on, { theme: 'off' })
  await start($)

  for (const scene of SCENES) {
    await run($, scene)
  }

  expect(sets.map(args => args.backdrop.scene)).toEqual([...SCENES])
  for (const { colors } of sets) {
    expect(checkColors(colors).filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
  }
})
