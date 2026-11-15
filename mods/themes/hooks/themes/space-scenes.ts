// Space scenes: each is one SVG string animated by its own CSS, in GitHub Dark colors.
// Pure string building: no DOM, no script, nothing loaded from outside the string.

const W = 1600
const H = 1000
const PAGE = '#010409'
const DIM = '#9198a1'
const MID = '#c9d1d9'
const BRIGHT = '#f0f6fc'
const BLUE = '#79c0ff'
const ACCENT = '#1f6feb'
const PURPLE = '#ab7df8'
const VIOLET = '#8957e5'
const PINK = '#db61a2'
const WARM = '#ffdfb6'

type Point = readonly [number, number]

/** A repeatable stream of numbers in [0, 1) (mulberry32): every build draws the same sky. */
function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const n = (value: number) => String(Math.round(value * 10) / 10)

/** Dots as one path: a zero-length segment with round caps draws a disc of the stroke's width. */
const dots = (points: readonly Point[]) => points.map(([x, y]) => `M${n(x)} ${n(y)}h0`).join('')

const path = (d: string, colour: string, width: number, attributes = '') =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"${attributes}/>`

type Layer = { count: number; width: number; colour: string; opacity: number; twinkles: number; shift?: number }

const FAR: Layer = { count: 420, width: 1.3, colour: DIM, opacity: 0.6, twinkles: 3 }
const MIDDLE: Layer = { count: 200, width: 1.9, colour: MID, opacity: 0.75, twinkles: 4 }
const NEAR: Layer = { count: 60, width: 2.8, colour: BRIGHT, opacity: 0.9, twinkles: 5 }
const TINTS = [BLUE, WARM, PURPLE]

/**
 * One layer of stars, split into groups that twinkle out of step. A drifting layer slides left
 * by `shift` sky widths in one loop, so it is drawn that many times more, with no seam.
 */
function starLayer(rand: () => number, layer: Layer, index: number): string {
  const groups: Point[][] = Array.from({ length: layer.twinkles }, () => [])
  for (let i = 0; i < layer.count; i++) {
    const point: Point = [rand() * W, rand() * H]
    const group = groups[i % layer.twinkles]!
    group.push(point)
    for (let k = 1; k <= (layer.shift ?? 0); k++) group.push([point[0] + W * k, point[1]])
  }
  const paths = groups.map((points, g) =>
    path(dots(points), layer.colour, layer.width, ` class="tw t${(index * 2 + g) % 7}"`),
  )
  const drift = layer.shift ? ` class="dr${layer.shift}"` : ''
  return `<g opacity="${layer.opacity}"${drift}>${paths.join('')}</g>`
}

/** A few coloured stars with a four-point glint, kept out of the middle where the words sit. */
function glints(rand: () => number, count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const side = rand() < 0.5 ? rand() * 0.3 : 0.7 + rand() * 0.3
    const x = side * W
    const y = (0.06 + rand() * 0.8) * H
    const r = 5 + rand() * 5
    const d = `M${n(x - r)} ${n(y)}h${n(r * 2)}M${n(x)} ${n(y - r)}v${n(r * 2)}`
    out += path(d, TINTS[i % TINTS.length]!, 0.9, ` class="tw t${i % 7}" opacity=".8"`)
    out += path(dots([[x, y]]), BRIGHT, 2.6)
  }
  return out
}

/** Three depths of stars; drifting, the nearer a layer is, the faster it slides. */
function starfield(seed: number, drifts: boolean): string {
  const rand = stream(seed)
  const layers = [FAR, MIDDLE, NEAR].map((layer, i) => starLayer(rand, drifts ? { ...layer, shift: i + 1 } : layer, i))
  return layers.join('') + glints(rand, 9)
}

/** A meteor: hidden at rest, it crosses once in each long cycle. */
function meteor(x: number, y: number, angle: number, seconds: number, delay: number): string {
  const line = `<line x1="0" y1="0" x2="150" y2="0" stroke="url(#trail)" stroke-width="1.6" stroke-linecap="round"/>`
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><g class="mt" style="animation-duration:${seconds}s;animation-delay:${delay}s">${line}</g></g>`
}

// The words sit in the middle and the prompt box at the foot: a veil of the page color calms both.
const CALM =
  `<radialGradient id="calm" cx="50%" cy="56%" r="46%"><stop offset="0" stop-color="${PAGE}" stop-opacity=".72"/>` +
  `<stop offset=".5" stop-color="${PAGE}" stop-opacity=".5"/><stop offset=".8" stop-color="${PAGE}" stop-opacity=".16"/>` +
  `<stop offset="1" stop-color="${PAGE}" stop-opacity="0"/></radialGradient>`
const TRAIL =
  `<linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="150" y2="0">` +
  `<stop offset="0" stop-color="${BLUE}" stop-opacity="0"/><stop offset="1" stop-color="${BRIGHT}"/></linearGradient>`
const calmVeil = `<rect width="${W}" height="${H}" fill="url(#calm)"/>`

const glow = (id: string, colour: string, opacity: number) =>
  `<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="${opacity}"/>` +
  `<stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`

// The app redraws the window whenever the scene changes, so motion on every frame of a fast display
// (164 a second on the screen this was measured on) costs far more than it shows. Everything in a scene
// moves in steps on one shared grid: loops and delays are whole steps long, so all changes fall on
// the same instants. Only a meteor, for about 1.5 seconds each time, moves every frame.
// The calm scenes move slowly, so 10 steps a second keep each step below half a pixel at about a
// third of the cost of 20; warp's streaks cross the window fast and need 20.
const CALM_RATE = 10
const WARP_RATE = 20
const stepper = (rate: number) => (seconds: number) => `steps(${Math.round(seconds * rate)})`

// Twinkle classes t0 to t6: [seconds of one loop, delay]. A loop fades down and up, half each way.
const TWINKLES = [[8, 0], [6, -2], [10, -5], [4, -1], [12, -7], [14, -8], [16, -9]] as const

/** A scene's stylesheet at `rate` steps a second; `extra` holds rules only that scene uses. */
function style(rate: number, extra: string): string {
  const steps = stepper(rate)
  return (
    TWINKLES.map(([loop, delay], i) => `.t${i}{animation:tw ${loop}s ${steps(loop / 2)} ${delay}s infinite}`).join('') +
    '@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}' +
    `.dr1,.dr2,.dr3{animation:2400s ${steps(2400)} infinite}.dr1{animation-name:dr1}.dr2{animation-name:dr2}.dr3{animation-name:dr3}` +
    '@keyframes dr1{to{transform:translateX(-1600px)}}@keyframes dr2{to{transform:translateX(-3200px)}}' +
    '@keyframes dr3{to{transform:translateX(-4800px)}}' +
    '.mt{opacity:0;animation:mt 60s linear infinite}' +
    '@keyframes mt{0%{opacity:0;transform:translateX(0)}.4%{opacity:1}2%{opacity:1}2.6%{opacity:0;transform:translateX(640px)}100%{opacity:0;transform:translateX(640px)}}' +
    `.nb{animation:nb 40s ${steps(40)} infinite alternate}` +
    '@keyframes nb{from{opacity:.7;transform:scale(1)}to{opacity:1;transform:scale(1.14)}}' +
    `.at{animation:at 18s ${steps(18)} infinite alternate}@keyframes at{from{opacity:.65}to{opacity:1}}` +
    `.or{animation:or 600s ${steps(600)} infinite}@keyframes or{to{transform:rotate(360deg)}}` +
    `.ro{animation:ro 600s ${steps(600)} infinite}@keyframes ro{to{transform:rotate(-360deg)}}` +
    extra +
    // A system that asks for reduced motion gets the resting picture.
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
  )
}

// The fade has parts of 6, 26 and 8 seconds: 40 steps in each keeps every change on warp's grid.
const WARP_STYLE =
  `.wp{transform-origin:800px 500px;animation:wps 40s ${stepper(WARP_RATE)(40)} infinite,wpo 40s steps(40) infinite}` +
  '@keyframes wps{from{transform:scale(.3)}to{transform:scale(2.4)}}' +
  '@keyframes wpo{0%{opacity:0}15%{opacity:.85}80%{opacity:.85}100%{opacity:0}}'

const svg = (rate: number, defs: string, body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
  `<style>${style(rate, extra)}</style><defs>${CALM}${TRAIL}${defs}</defs>` +
  `<rect width="${W}" height="${H}" fill="${PAGE}"/>${body}</svg>`

/** Deep Field: three depths of stars that drift at different speeds, and a rare meteor. */
export function starsScene(): string {
  const defs = glow('hz1', ACCENT, 0.1) + glow('hz2', VIOLET, 0.08)
  const haze =
    `<ellipse cx="120" cy="80" rx="700" ry="460" fill="url(#hz1)"/>` +
    `<ellipse cx="1520" cy="940" rx="680" ry="440" fill="url(#hz2)"/>`
  const meteors = meteor(140, 90, 24, 53, -20) + meteor(1180, 40, 152, 71, -48)
  return svg(CALM_RATE, defs, haze + starfield(11, true) + calmVeil + meteors)
}

type Cloud = { x: number; y: number; rx: number; ry: number; glow: string; seconds: number; delay: number }

const CLOUDS: readonly Cloud[] = [
  { x: 160, y: 110, rx: 640, ry: 430, glow: 'nb1', seconds: 44, delay: -6 },
  { x: 430, y: 40, rx: 430, ry: 290, glow: 'nb2', seconds: 37, delay: -19 },
  { x: 60, y: 520, rx: 300, ry: 360, glow: 'nb3', seconds: 51, delay: -30 },
  { x: 1460, y: 900, rx: 650, ry: 430, glow: 'nb2', seconds: 47, delay: -11 },
  { x: 1240, y: 990, rx: 400, ry: 240, glow: 'nb3', seconds: 33, delay: -25 },
  { x: 1540, y: 300, rx: 300, ry: 400, glow: 'nb1', seconds: 58, delay: -40 },
]

/** Nebula: the starfield behind slow clouds of blue, purple and pink that breathe in the corners. */
export function nebulaScene(): string {
  const defs = glow('nb1', ACCENT, 0.34) + glow('nb2', VIOLET, 0.3) + glow('nb3', PINK, 0.16)
  const clouds = CLOUDS.map(
    c =>
      `<ellipse class="nb" cx="${c.x}" cy="${c.y}" rx="${c.rx}" ry="${c.ry}" fill="url(#${c.glow})" ` +
      `style="transform-origin:${c.x}px ${c.y}px;animation-duration:${c.seconds}s;animation-timing-function:${stepper(CALM_RATE)(c.seconds)};animation-delay:${c.delay}s"/>`,
  ).join('')
  return svg(CALM_RATE, defs, clouds + starfield(23, true) + calmVeil + meteor(1250, 70, 158, 97, -60))
}

/** Orbit: a planet's lit edge in the top right corner, its air glowing, and a moon that circles it. */
export function orbitScene(): string {
  const cx = 1420
  const cy = -170
  const r = 460
  const air = r + 44
  const defs =
    `<radialGradient id="air"><stop offset="${n(r / air)}" stop-color="${BLUE}" stop-opacity=".5"/>` +
    `<stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="body" cx="26%" cy="78%" r="80%"><stop offset="0" stop-color="#1b3a6b"/>` +
    `<stop offset=".45" stop-color="#0d1b33"/><stop offset="1" stop-color="${PAGE}"/></radialGradient>` +
    `<linearGradient id="limb" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="${cy + r}" x2="${cx + 120}" y2="${cy}">` +
    `<stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="moon" cx="35%" cy="70%" r="75%"><stop offset="0" stop-color="${BRIGHT}"/>` +
    `<stop offset="1" stop-color="#3d444d"/></radialGradient>`
  const planet =
    `<circle class="at" cx="${cx}" cy="${cy}" r="${air}" fill="url(#air)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#body)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#limb)" stroke-width="2.2"/>`
  // The orbit is a circle seen at a tilt: the squash makes the ellipse, and the moon's own
  // turn and stretch undo the turn and the squash, so it stays round. At rest it sits at 130 degrees.
  const moon =
    `<g transform="translate(${cx} ${cy}) rotate(-10) scale(1 .6) rotate(130)"><g class="or">` +
    `<g transform="translate(600 0)"><g class="ro"><g transform="rotate(-130) scale(1 ${n(1 / 0.6)})">` +
    `<circle r="13" fill="url(#moon)"/></g></g></g></g></g>`
  return svg(CALM_RATE, defs, starfield(37, false) + calmVeil + planet + moon)
}

/** Warp: streaks that run outward from the middle, wave after wave, faint where the words sit. */
export function warpScene(): string {
  const rand = stream(53)
  const waves = 10
  let streaks = ''
  for (let wave = 0; wave < waves; wave++) {
    let d = ''
    for (let i = 0; i < 34; i++) {
      const angle = rand() * Math.PI * 2
      const from = 150 + rand() * 420
      const to = from * (1.05 + rand() * 0.05)
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
      d += `M${n(800 + cos * from)} ${n(500 + sin * from)}L${n(800 + cos * to)} ${n(500 + sin * to)}`
    }
    const colour = [BRIGHT, BLUE, MID, PURPLE][wave % 4]!
    // A wave grows from the middle to past the edge in 40 seconds; the waves start 4 seconds apart.
    streaks += path(d, colour, 1.3, ` class="wp" opacity=".7" style="animation-delay:${-4 * wave}s"`)
  }
  const core = `<ellipse cx="800" cy="500" rx="560" ry="380" fill="url(#core)"/>`
  return svg(WARP_RATE, glow('core', ACCENT, 0.16), core + starLayer(stream(59), FAR, 0) + streaks + calmVeil, WARP_STYLE)
}
