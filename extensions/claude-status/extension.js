const vscode = require('vscode')
const os = require('node:os')
const path = require('node:path')
const { claudeDir, GAP, readLive, readVscodeSessions, pickSession, accountLimits, groups, render, tooltip, boardItems, handoffItem, writeCommand, modMissing } = require('./status')

const CLAUDE_DIR = claudeDir(process.env, os.homedir())
const DATA_DIR = path.join(CLAUDE_DIR, 'mods-data', 'session-band')
const LIVE_DIR = path.join(DATA_DIR, 'live')
const COMMAND_DIR = path.join(DATA_DIR, 'commands')
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions')
const SETUP_URL = 'https://github.com/IT-BAER/claude-forge/tree/main/extensions/claude-status#requirements'
const REFRESH_MS = 2000
const PENDING_MS = 15000 // how long a click shows its own label before the mod answers
// The band's colours as theme colours, so each theme keeps its own shades
const COLOR = { green: 'terminal.ansiGreen', yellow: 'terminal.ansiYellow', red: 'terminal.ansiRed', cyan: 'terminal.ansiCyan', dim: 'disabledForeground' }
const KEYS = ['cache', 'ctx', 'rwc', 'sc', 'limits'] // render()'s segments, left to right

function activate(context) {
  // Right side, lowest priority: right of every other right-side item, under the
  // chat in the secondary sidebar; editor items (Ln/Col, encoding) never push it. Higher sits further left.
  let priority = Number.MIN_SAFE_INTEGER + 100
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
  // Shown alone while no chat on this machine has run the mod
  const hint = create('claudeStatus.modMissing', 'Claude Status Setup')
  hint.text = '$(warning) session-band mod not found'
  hint.tooltip = new vscode.MarkdownString([
    'Claude Status shows what the **session-band** mod writes, and no Claude Code chat on this machine has run it yet.',
    'Install it in Claude Code, then restart the chat:',
    '```\n/plugin marketplace add IT-BAER/claude-forge\n/plugin install session-band@claude-forge\n```',
    'Click for the setup steps.',
  ].join('\n\n'))
  hint.command = { title: 'Open setup steps', command: 'vscode.open', arguments: [vscode.Uri.parse(SETUP_URL)] }
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
      if (modMissing(LIVE_DIR)) hint.show()
      return
    }
    hint.hide()
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
      vscode.window.showInformationMessage('Claude Status: no live Claude Code session found. Is the session-band mod installed and up to date?')
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
