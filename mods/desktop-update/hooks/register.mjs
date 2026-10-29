// Desktop Update: a line above the prompt when Anthropic's update feed offers a
// newer Claude Desktop (Windows MSIX) than the installed one. For installs whose
// built-in updater is off (HKCU\SOFTWARE\Policies\Claude disableAutoUpdates=1).

import { atom, read, update } from 'claude-code'

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const FEED = 'https://api.anthropic.com/api/desktop/win32/x64/msix/update'
const CHECK_EVERY = 6 * 3600000
const DEFAULT_RELAUNCH = 'explorer.exe shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude'
const INSTALLED = "$p = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if (-not $p) { exit 1 }; @{ version = $p.Version.ToString(); os = [Environment]::OSVersion.Version.ToString() } | ConvertTo-Json -Compress"

// What the band shows: the offered release (null = nothing) and where the person is in the install
const view = atom({ plugin: 'desktop-update', key: 'view' }, { offer: null, phase: 'offer' })

let relaunch = DEFAULT_RELAUNCH
let timer = false

// First three numeric parts; Appx versions carry a fourth that the feed drops
function version3(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function newer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

// The release the feed points at, or null when the answer is not the known shape
function parseFeed(text) {
  let data
  try { data = JSON.parse(text) } catch { return null }
  const current = data && data.currentRelease
  const rel = Array.isArray(data && data.releases) ? data.releases.find((r) => r && r.version === current) : null
  const to = rel && rel.updateTo
  if (!version3(current) || !to || typeof to.url !== 'string' || !/^https:\/\//.test(to.url) || !/^[0-9a-f]{64}$/i.test(String(to.sha256 || ''))) return null
  return { version: current, url: to.url, sha256: to.sha256.toLowerCase(), size: Number(to.size) || 0 }
}

function uuid() {
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = '89ab'[Math.floor(Math.random() * 4)]
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

// The feed answer is shared through $.store by every session of this profile for CHECK_EVERY
async function latestRelease($, installed, os) {
  const now = await $.clock.now()
  const last = await $.store.get('last')
  if (last && typeof last.at === 'number' && now - last.at < CHECK_EVERY && last.installed === installed) return last.latest
  let deviceId = await $.store.get('deviceId')
  if (typeof deviceId !== 'string') {
    deviceId = uuid()
    await $.store.set('deviceId', deviceId)
  }
  const res = await $.http.fetch(`${FEED}?device_id=${deviceId}&version=${installed}&os_version=${encodeURIComponent(os)}`)
  if (!res.ok) throw new Error(`feed answered HTTP ${res.status}`)
  const latest = parseFeed(res.text)
  if (!latest) throw new Error('feed answer is not the known shape')
  await $.store.set('last', { at: now, installed, latest })
  return latest
}

// Fails closed: any error leaves no line
async function check($) {
  let offer = null
  try {
    const r = await $.process.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-Command', INSTALLED], { timeoutMs: 30000 })
    if (r.exitCode === 0) {
      const local = JSON.parse(r.stdout)
      const installed = version3(local.version)
      if (installed) {
        const latest = await latestRelease($, installed.join('.'), String(local.os || ''))
        if (newer(version3(latest.version), installed) && (await $.store.get('dismissed')) !== latest.version) offer = { ...latest, installed: installed.join('.') }
      }
    }
  } catch (err) {
    $.ui.log(`desktop-update: check failed: ${(err && err.message) || err}`, { to: 'debug' })
  }
  await update($, view, (v) => {
    if (v.phase === 'installing') return v
    const same = offer && v.offer && offer.version === v.offer.version
    return { offer, phase: same ? v.phase : 'offer' }
  })
}

async function later($) {
  const { offer } = await read($, view)
  if (offer) await $.store.set('dismissed', offer.version)
  await update($, view, () => ({ offer: null, phase: 'offer' }))
}

async function setPhase($, from, to) {
  let moved = false
  await update($, view, (v) => {
    moved = !!v.offer && v.phase === from
    return moved ? { ...v, phase: to } : v
  })
  return moved
}

// The installer starts itself again outside this session (-Detach), so it survives Desktop closing
async function install($) {
  if (!(await setPhase($, 'confirm', 'installing'))) return
  const { offer } = await read($, view)
  let why = ''
  try {
    const r = await $.process.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${$.plugin.root}/hooks/install-update.ps1`,
      '-Detach', '-Url', offer.url, '-Sha256', offer.sha256, '-Version', offer.version, '-Relaunch', relaunch], { timeoutMs: 60000 })
    if (r.exitCode !== 0) why = r.stderr.trim() || `exit code ${r.exitCode}`
  } catch (err) {
    why = String((err && err.message) || err)
  }
  if (why) {
    $.ui.toast(`Could not start the Claude Desktop installer: ${why}`, { timeoutMs: 10000 })
    await setPhase($, 'installing', 'offer')
  }
}

/** @type {import('claude-code').Register} */
export const register = (on, options) => {
  if (typeof options.relaunch === 'string' && options.relaunch.trim()) relaunch = options.relaunch.trim()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!timer) {
      timer = true
      $.clock.every(CHECK_EVERY, () => check($))
    }
    await check($)
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const { offer, phase } = await read($, view)
    if (!offer || (e.props && e.props.hasSurvey)) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const row = []
    if (phase === 'installing') {
      row.push(Text({ color: 'cyan', children: [`Installing Claude Desktop ${offer.version}. Desktop closes and starts again.`] }))
    } else {
      row.push(Text({ color: 'cyan', children: [`Claude Desktop ${offer.version} is available (installed ${offer.installed})`] }))
      if (phase === 'confirm') {
        row.push(Text({ color: 'yellow', children: ['Installing closes every Claude Desktop window and its sessions.'] }))
        row.push(Button({ key: 'install', label: 'install', hotkey: 'i', plain: true, onPress: () => install($) }))
        row.push(Button({ key: 'cancel', label: 'cancel', hotkey: 'n', plain: true, onPress: () => setPhase($, 'confirm', 'offer') }))
      } else {
        row.push(Button({ key: 'update', label: 'update', hotkey: 'u', plain: true, onPress: () => setPhase($, 'offer', 'confirm') }))
        row.push(Button({ key: 'later', label: 'later', hotkey: 'l', plain: true, onPress: () => later($) }))
      }
    }
    const mine = Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: row })
    return Box({ flexDirection: 'column', children: below ? [mine, below] : [mine] })
  })
}
