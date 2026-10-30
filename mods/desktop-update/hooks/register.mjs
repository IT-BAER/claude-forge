// Desktop Update: a line above the prompt when Anthropic's update feed offers a
// newer Claude Desktop (Windows MSIX) than the installed one. For installs whose
// built-in updater is off (HKCU\SOFTWARE\Policies\Claude disableAutoUpdates=1).

import { atom, read, update } from 'claude-code'

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const FEED = 'https://api.anthropic.com/api/desktop/win32/x64/msix/update'
const CHECK_EVERY = 6 * 3600000
const INSTALL_GRACE = 30 * 60000 // an install not seen by then is offered again
// Same rule as install-update.ps1: the URL is spliced into a command line there
const DOWNLOAD_URL = /^https:\/\/downloads\.claude\.ai\/[^"\s]+$/
const DEFAULT_RELAUNCH = 'explorer.exe shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude'
// Policy values come from the real registry through WMI (StdRegProv runs outside the package;
// this process sees the package's private hive). -1 = the read failed.
const INSTALLED = String.raw`$p = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if (-not $p) { exit 1 }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function P([uint32]$h, [string]$k) { try { $r = Invoke-CimMethod -Namespace root/default -ClassName StdRegProv -MethodName GetDWORDValue -Arguments @{ hDefKey = $h; sSubKeyName = $k; sValueName = 'disableAutoUpdates' }; if ($r.ReturnValue -eq 0) { [int]$r.uValue } } catch { -1 } }
$u = P 2147483651 ($sid + '\SOFTWARE\Policies\Claude'); $m = P 2147483650 'SOFTWARE\Policies\Claude'
# PowerShell 5.1 turns "no output" into {} in JSON; a reassigned $null becomes null
if ($null -eq $u) { $u = $null }; if ($null -eq $m) { $m = $null }
@{ version = $p.Version.ToString(); os = [Environment]::OSVersion.Version.ToString(); sid = $sid; user = $u; machine = $m } | ConvertTo-Json -Compress`
const SID = /^S-1-5-21-\d+-\d+-\d+-\d+$/
const AUTO_POLL = 5000
const AUTO_WAIT = 120000 // an unanswered UAC prompt counts as cancelled after this

// What the band shows: the offered release (null = nothing) and where the person is in the install
const view = atom({ plugin: 'desktop-update', key: 'view' }, { offer: null, phase: 'offer', since: 0 })

let relaunch = DEFAULT_RELAUNCH

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
  if (!version3(current) || !to || !DOWNLOAD_URL.test(String(to.url)) || !/^[0-9a-f]{64}$/i.test(String(to.sha256 || ''))) return null
  return { version: current, url: to.url, sha256: to.sha256.toLowerCase() }
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

// The toggle's input, or null when the read is incomplete or failed
function parsePolicy(local) {
  const ok = (x) => x === null || x === 0 || x === 1
  if (!SID.test(String(local.sid)) || !ok(local.user) || !ok(local.machine)) return null
  return { sid: local.sid, user: local.user, machine: local.machine }
}

// Fails closed: any error leaves no line
async function check($) {
  let offer = null
  let known = false
  let policy = null
  try {
    const r = await $.process.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-Command', INSTALLED], { timeoutMs: 30000 })
    if (r.exitCode === 0) {
      const local = JSON.parse(r.stdout)
      policy = parsePolicy(local)
      const installed = version3(local.version)
      if (installed) {
        const latest = await latestRelease($, installed.join('.'), String(local.os || ''))
        if (newer(version3(latest.version), installed) && (await $.store.get('dismissed')) !== latest.version) offer = { ...latest, installed: installed.join('.') }
        known = true
      }
    }
  } catch (err) {
    $.ui.log(`desktop-update: check failed: ${(err && err.message) || err}`, { to: 'debug' })
  }
  const now = await $.clock.now()
  await update($, view, (v) => {
    const same = offer && v.offer && offer.version === v.offer.version
    // An install keeps its line until the new version is installed or INSTALL_GRACE ran out
    if (v.phase === 'installing' && (same || !known) && now - v.since < INSTALL_GRACE) return { ...v, policy }
    return { ...v, offer, phase: same && v.phase !== 'installing' ? v.phase : 'offer', since: 0, policy }
  })
}

async function later($) {
  const { offer } = await read($, view)
  if (offer) await $.store.set('dismissed', offer.version)
  await update($, view, (v) => ({ ...v, offer: null, phase: 'offer', since: 0 }))
}

// Auto-update is on unless the user value is 1; the toggle only exists without a machine policy
const autoOn = (policy) => !!policy && policy.user !== 1
const canToggle = (policy) => !!policy && policy.machine === null

// Elevated write through set-autoupdate.ps1 (UAC); the result shows in the next registry read
async function toggleAuto($) {
  const { policy, autoPending } = await read($, view)
  if (!canToggle(policy) || autoPending != null) return
  const want = autoOn(policy) ? 1 : 0
  await update($, view, (v) => ({ ...v, autoPending: want }))
  let why = ''
  try {
    const r = await $.process.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${$.plugin.root}/hooks/set-autoupdate.ps1`,
      '-Detach', '-Sid', policy.sid, '-Value', String(want)], { timeoutMs: 60000 })
    if (r.exitCode !== 0) why = r.stderr.trim() || `exit code ${r.exitCode}`
  } catch (err) {
    why = String((err && err.message) || err)
  }
  if (why) {
    $.ui.toast(`Could not start the auto-update change: ${why}`, { timeoutMs: 10000 })
    await update($, view, (v) => ({ ...v, autoPending: null }))
    return
  }
  // Rejects when the mod unloads mid-wait; session.start clears the pending mark then
  watchAuto($, want).catch(() => {})
}

async function watchAuto($, want) {
  for (let waited = 0; waited < AUTO_WAIT; waited += AUTO_POLL) {
    await $.clock.sleep(AUTO_POLL)
    await check($)
    const { policy } = await read($, view)
    if (policy && (autoOn(policy) ? 0 : 1) === want) {
      await update($, view, (v) => ({ ...v, autoPending: null }))
      $.ui.toast(`Claude Desktop auto-update is ${want ? 'off' : 'on'}. Restart Desktop to apply.`, { timeoutMs: 10000 })
      return
    }
  }
  await update($, view, (v) => ({ ...v, autoPending: null }))
  $.ui.toast('Auto-update unchanged: the UAC prompt was cancelled or not answered.', { timeoutMs: 10000 })
}

async function setPhase($, from, to, since = 0) {
  let moved = false
  await update($, view, (v) => {
    moved = !!v.offer && v.phase === from
    return moved ? { ...v, phase: to, since } : v
  })
  return moved
}

// The installer starts itself again outside this session (-Detach), so it survives Desktop closing
async function install($) {
  if (!(await setPhase($, 'confirm', 'installing', await $.clock.now()))) return
  const { offer } = await read($, view)
  if (!offer) return
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
    // A reload ends a running watchAuto, but its pending mark lives on in $.state
    await update($, view, (v) => ({ ...v, autoPending: null }))
    $.clock.every(CHECK_EVERY, () => check($))
    await check($)
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const { offer, phase, policy, autoPending } = await read($, view)
    // Without an offer the row exists only to turn auto-update off
    const toggleRow = !offer && autoOn(policy) && canToggle(policy)
    if ((!offer && !toggleRow) || (e.props && e.props.hasSurvey)) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const texts = []
    const buttons = []
    const pending = autoPending != null
    const toggle = () => Button({ key: 'autoupdate', label: pending ? 'waiting for UAC' : autoOn(policy) ? 'auto-update off' : 'auto-update on',
      hotkey: 't', plain: true, dimColor: pending, onPress: () => toggleAuto($) })
    if (toggleRow) {
      texts.push(Text({ color: 'cyan', children: ['Claude Desktop auto-update is on'] }))
      buttons.push(toggle())
    } else if (phase === 'installing') {
      texts.push(Text({ color: 'cyan', children: [`Installing Claude Desktop ${offer.version}. Desktop closes and starts again.`] }))
    } else {
      texts.push(Text({ color: 'cyan', children: [`Claude Desktop ${offer.version} is available (installed ${offer.installed})`] }))
      if (phase === 'confirm') {
        texts.push(Text({ color: 'yellow', children: ['Installing closes every Claude Desktop window and its sessions.'] }))
        buttons.push(Button({ key: 'cancel', label: 'cancel', hotkey: 'n', plain: true, onPress: () => setPhase($, 'confirm', 'offer') }))
        buttons.push(Button({ key: 'install', label: 'install', hotkey: 'i', plain: true, onPress: () => install($) }))
      } else {
        if (canToggle(policy)) buttons.push(toggle())
        buttons.push(Button({ key: 'later', label: 'later', hotkey: 'l', plain: true, onPress: () => later($) }))
        buttons.push(Button({ key: 'update', label: 'update', hotkey: 'u', plain: true, onPress: () => setPhase($, 'offer', 'confirm') }))
      }
    }
    // Text at the left edge, buttons at the right, as in session-band's row
    const left = Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: texts })
    const right = Box({ flexDirection: 'row', columnGap: 2, children: buttons })
    const mine = Box({ flexDirection: 'row', justifyContent: 'space-between', width: '100%', columnGap: 2, children: [left, right] })
    return Box({ flexDirection: 'column', rowGap: 1, children: below ? [mine, below] : [mine] })
  })
}
