export type SkillScope = 'user' | 'project' | 'plugin'

export type GithubSource = {
  kind: 'github'
  /** owner/repo */
  repo: string
  url: string
  /** Path of SKILL.md inside the repo. */
  skillPath: string
  /** Git tree SHA of the skill folder at install time. */
  hash: string
  installedAt: string
  updatedAt: string
  /** Which skills-CLI lock file holds the entry. */
  lock: 'global' | 'project'
}

export type PluginSource = {
  kind: 'plugin'
  plugin: string
  marketplace: string
  version: string
  lastUpdated: string
}

export type SkillRow = {
  /** Unique: scope plus invocation name. */
  id: string
  /** What the Skill tool and /name use. Plugin skills: plugin:skill. */
  name: string
  folder: string
  scope: SkillScope
  /** Absolute folder of the skill. */
  dir: string
  /** Absolute skills root the folder sits in. */
  root: string
  description: string
  isLink: boolean
  source?: GithubSource | PluginSource
  /** A top-level file changed more than 2 minutes after the lock's updatedAt. */
  isModifiedLocally?: boolean
}

export type SkillUsage = { count: number; last: string | null }
export type UsageMap = Record<string, SkillUsage>

export type UpdateInfo = {
  status: 'current' | 'available' | 'error'
  checkedAt: string
  detail?: string
}

export type SortKey = 'uses' | 'last' | 'name' | 'updates'
export type ScopeFilter = 'all' | SkillScope

export type PaneView = {
  scope: ScopeFilter
  sort: SortKey
  /** Absent: the sort key's natural direction (name ascending, the rest descending). */
  dir?: 'asc' | 'desc'
  text: string
  selected: string | null
  /** Row id waiting for the second press of Delete. */
  confirm: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'skill-manager': {
      rows: SkillRow[]
      usage: UsageMap
      updates: Record<string, UpdateInfo>
      view: PaneView
      busy: string | null
      /** Row ids whose update runs now; their buttons show a busy text instead. */
      busyRows: string[]
      message: string | null
      /** The session's working directory, where project skills are read. */
      cwd: string | null    }
  }
}
