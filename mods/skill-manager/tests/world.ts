import { mock } from 'claude-code/testing'
// mock.store is not used: the tests read the store back from `store` below.
import type { On } from 'claude-code'

export const HOME = 'C:\\Users\\u'
export const CWD = 'C:\\work\\proj'
export const PLUGIN_DIR = `${HOME}\\.claude\\plugins\\cache\\market\\tools\\1.0`

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

/** A fake disk: absolute path -> file text, or null for a directory. */
export const baseFiles = (): Record<string, string | null> => ({
  [`${HOME}\\.claude\\skills`]: null,
  [`${HOME}\\.claude\\skills\\alpha`]: null,
  [`${HOME}\\.claude\\skills\\alpha\\SKILL.md`]: skill('alpha', 'Alpha skill'),
  [`${HOME}\\.claude\\skills\\beta`]: null,
  [`${HOME}\\.claude\\skills\\beta\\SKILL.md`]: skill('beta', 'Beta from GitHub'),
  [`${HOME}\\.claude\\skills\\.trash`]: null,
  [`${HOME}\\.claude\\skills\\.trash\\old`]: null,
  [`${HOME}\\.claude\\skills\\.trash\\old\\SKILL.md`]: skill('old', 'Trashed'),
  [`${HOME}\\.claude\\skills\\synced`]: null,
  [`${HOME}\\.claude\\skills\\skills.zip`]: 'zip',
  [`${HOME}\\.agents\\.skill-lock.json`]: JSON.stringify({
    version: 3,
    skills: {
      beta: {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills.git',
        skillPath: 'skills/beta/SKILL.md',
        skillFolderHash: 'aaa111',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      gone: {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills.git',
        skillPath: 'skills/gone/SKILL.md',
        skillFolderHash: 'bbb222',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }),
  [`${CWD}\\.claude\\skills`]: null,
  [`${CWD}\\.claude\\skills\\gamma`]: null,
  [`${CWD}\\.claude\\skills\\gamma\\SKILL.md`]: skill('gamma', 'Project skill'),
  [`${HOME}\\.claude\\plugins\\installed_plugins.json`]: JSON.stringify({
    version: 2,
    plugins: {
      'tools@market': [
        {
          scope: 'user',
          installPath: PLUGIN_DIR,
          version: '1.0',
          lastUpdated: '2026-02-01T00:00:00.000Z',
        },
      ],
    },
  }),
  [`${PLUGIN_DIR}\\skills`]: null,
  [`${PLUGIN_DIR}\\skills\\delta`]: null,
  [`${PLUGIN_DIR}\\skills\\delta\\SKILL.md`]: skill('delta', 'Plugin skill'),
})

export type Ran = { argv: readonly string[]; cwd?: string }

/**
 * Answers fs, env, store, process and http beneath the plugin from memory.
 * `ran` records every process.run; `fetched` every http.fetch URL.
 */
export const world = (
  on: On,
  { files = baseFiles(), http = {}, stdout = () => '{}' }: {
    files?: Record<string, string | null>
    http?: Record<string, unknown>
    stdout?: (argv: readonly string[]) => string | Promise<string>
  } = {},
) => {
  const ran: Ran[] = []
  const fetched: string[] = []
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  const children = (dir: string) =>
    Object.keys(files)
      .filter(path => path.startsWith(dir + '\\') && !path.slice(dir.length + 1).includes('\\'))
      .map(path => ({
        name: path.slice(dir.length + 1),
        kind: files[path] === null ? ('dir' as const) : ('file' as const),
        size: files[path]?.length ?? 0,
        mtimeMs: Date.parse('2026-01-01T00:00:30.000Z'),
        isLink: false,
      }))

  const store: Record<string, unknown> = {}
  mock.env(on, { USERPROFILE: HOME })
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    if (files[e.path] !== null) throw missing(e.path)

    return { value: children(e.path) }
  })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (typeof text !== 'string') throw missing(e.path)

    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('process.run', async (_, e) => {
    ran.push({ argv: e.argv, cwd: e.init?.cwd })

    return { value: { exitCode: 0, stdout: await stdout(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_, e) => {
    fetched.push(e.url)
    const body = http[e.url]
    if (body === undefined) return { value: { status: 404, ok: false, headers: {}, text: '' } }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('skill.prompt', (_, e) => ({ text: e.text }))

  return { ran, fetched, files, store }
}

export const PANE = {
  plugin: 'skill-manager',
  component: 'Pane',
  requestId: 'skill-manager',
  props: {
    title: 'Skills',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** Opens the pane as if the person typed /skill-manager. */
export const OPEN = {
  command: 'skill-manager',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const
