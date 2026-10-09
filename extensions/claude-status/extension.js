const vscode = require('vscode')
const os = require('node:os')
const path = require('node:path')
const { GAP, readLive, readVscodeSessions, pickSession, accountLimits, groups, render, tooltip, boardItems, handoffItem, writeCommand } = require('./status')

const DATA_DIR = path.join(os.homedir(), '.claude', 'mods-data', 'cache-status')
const LIVE_DIR = path.join(DATA_DIR, 'live')
const COMMAND_DIR = path.join(DATA_DIR, 'commands')
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')
const REFRESH_MS = 2000
const PENDING_MS = 15000 // how long a click shows its own label before the mod answers
// The band's colours as theme colours, so each theme keeps its own shades
const COLOR = { green: 'terminal.ansiGreen', yellow: 'terminal.ansiYellow', red: 'terminal.ansiRed', cyan: 'terminal.ansiCyan', dim: 'disabledForeground' }
const KEYS = ['cache', 'ctx', 'rwc', 'sc', 'limits'] // render()'s segments, left to right

function activate(context) {
  // Right side, highest priority: left of every other right-side item, the
  // Claude Code item included. Higher sits further left.
  let priority = Number.MAX_SAFE_INTEGER
  const all = []
  const create = (id, name) => {
    const i = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, priority--)
    i.name = name
    all.push(i)
    return i
  }
  // A status item has no border and only error/warning backgrounds: dim glyph items mark the edges and gaps
  const dim = (id, text) => {
    const i = create(id, 'Claude Status Separator')
    i.text = text
    i.color = new vscode.ThemeColor('disabledForeground')
    return i
  }
  const left = dim('claudeStatus.edgeLeft', '┃')
  // One item per colour group (an item has one colour): at most one per segment
  const slots = KEYS.map((_, i) => {
    const s = create('claudeStatus.part' + i, 'Claude Status')
    s.command = 'claudeStatus.showSessions'
    return s
  })
  const handoff = create('claudeStatus.handoff', 'Claude Status Handoff')
  const right = dim('claudeStatus.edgeRight', '┃')

  let session // the session shown, for the handoff click
  let pending // { id, from, text, until }: a click the mod has not answered yet

  const refresh = () => {
    const now = Date.now()
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
    const vscodeChats = readVscodeSessions(SESSIONS_DIR)
    const live = readLive(LIVE_DIR, now)
    session = pickSession(live, folders, now, vscodeChats)
    if (session) session = { ...session, rateLimits: accountLimits(live, now) }
    if (!session) {
      for (const i of all) i.hide()
      return
    }
    left.show()
    right.show()
    const tip = new vscode.MarkdownString(tooltip({ ...session, label: vscodeChats.get(session.id) || session.label }, now))
    const shown = groups(render(session, now).segments)
    slots.forEach((s, i) => {
      const g = shown[i]
      if (!g) return s.hide()
      s.text = g.text
      s.color = g.color ? new vscode.ThemeColor(COLOR[g.color]) : undefined
      s.tooltip = tip
      s.show()
    })

    if (pending && (pending.id !== session.id || (session.handoff || 'idle') !== pending.from || now > pending.until)) pending = undefined
    const h = handoffItem(session)
    if (!h) {
      handoff.hide()
      return
    }
    handoff.text = '·' + GAP + (pending ? pending.text : h.text)
    handoff.command = !pending && h.cmd ? 'claudeStatus.handoffAction' : undefined
    handoff.tooltip = h.cmd === 'continue' ? 'Clear this chat and continue from the handoff' : h.cmd ? 'Run /session-handoff in this chat' : undefined
    handoff.show()
  }

  const handoffAction = () => {
    if (!session) return
    const h = handoffItem(session)
    if (!h || !h.cmd) return
    try {
      writeCommand(COMMAND_DIR, session.id, h.cmd, Date.now())
    } catch (err) {
      vscode.window.showErrorMessage(`Claude Status: could not send the command: ${err.message}`)
      return
    }
    pending = { id: session.id, from: session.handoff || 'idle', text: h.cmd === 'continue' ? '$(sync~spin) clearing' : 'handoff queued', until: Date.now() + PENDING_MS }
    refresh()
  }

  const showSessions = async () => {
    const items = boardItems(readLive(LIVE_DIR, Date.now()), Date.now())
    if (!items.length) {
      vscode.window.showInformationMessage('Claude Status: no live Claude Code session found. Is the cache-status mod installed and up to date?')
      return
    }
    await vscode.window.showQuickPick(items, { title: 'Claude Code sessions', matchOnDescription: true, matchOnDetail: true })
  }

  const timer = setInterval(refresh, REFRESH_MS)
  context.subscriptions.push(
    ...all,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('claudeStatus.showSessions', showSessions),
    vscode.commands.registerCommand('claudeStatus.handoffAction', handoffAction),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  )
  refresh()
}

function deactivate() {}

module.exports = { activate, deactivate }
