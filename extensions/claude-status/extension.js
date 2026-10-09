const vscode = require('vscode')
const os = require('node:os')
const path = require('node:path')
const { readLive, readVscodeSessions, pickSession, render, tooltip, boardItems, handoffItem, writeCommand } = require('./status')

const DATA_DIR = path.join(os.homedir(), '.claude', 'mods-data', 'cache-status')
const LIVE_DIR = path.join(DATA_DIR, 'live')
const COMMAND_DIR = path.join(DATA_DIR, 'commands')
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')
const REFRESH_MS = 2000
const PENDING_MS = 15000 // how long a click shows its own label before the mod answers
const TONE_BG = { warning: 'statusBarItem.warningBackground', error: 'statusBarItem.errorBackground' }

function activate(context) {
  // Right side, highest priority: left of every other right-side item, the
  // Claude Code item included. Higher sits further left.
  const item = vscode.window.createStatusBarItem('claudeStatus.item', vscode.StatusBarAlignment.Right, Number.MAX_SAFE_INTEGER)
  item.name = 'Claude Status'
  item.command = 'claudeStatus.showSessions'
  const handoff = vscode.window.createStatusBarItem('claudeStatus.handoff', vscode.StatusBarAlignment.Right, Number.MAX_SAFE_INTEGER - 1)
  handoff.name = 'Claude Status Handoff'

  let session // the session shown, for the handoff click
  let pending // { id, from, text, until }: a click the mod has not answered yet

  const refresh = () => {
    const now = Date.now()
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
    const vscodeChats = readVscodeSessions(SESSIONS_DIR)
    session = pickSession(readLive(LIVE_DIR, now), folders, now, vscodeChats)
    if (!session) {
      item.hide()
      handoff.hide()
      return
    }
    const r = render(session, now)
    item.text = r.text
    item.tooltip = new vscode.MarkdownString(tooltip({ ...session, label: vscodeChats.get(session.id) || session.label }, now))
    item.backgroundColor = TONE_BG[r.tone] ? new vscode.ThemeColor(TONE_BG[r.tone]) : undefined
    item.show()

    if (pending && (pending.id !== session.id || (session.handoff || 'idle') !== pending.from || now > pending.until)) pending = undefined
    const h = handoffItem(session)
    if (!h) {
      handoff.hide()
      return
    }
    handoff.text = pending ? pending.text : h.text
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
    item,
    handoff,
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('claudeStatus.showSessions', showSessions),
    vscode.commands.registerCommand('claudeStatus.handoffAction', handoffAction),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  )
  refresh()
}

function deactivate() {}

module.exports = { activate, deactivate }
