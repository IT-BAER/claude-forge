const vscode = require('vscode')
const os = require('node:os')
const path = require('node:path')
const { readLive, pickSession, render, tooltip, boardItems } = require('./status')

const LIVE_DIR = path.join(os.homedir(), '.claude', 'mods-data', 'cache-status', 'live')
const REFRESH_MS = 5000
const TONE_BG = { warning: 'statusBarItem.warningBackground', error: 'statusBarItem.errorBackground' }

function activate(context) {
  const item = vscode.window.createStatusBarItem('claudeStatus.item', vscode.StatusBarAlignment.Left, 100)
  item.name = 'Claude Status'
  item.command = 'claudeStatus.showSessions'

  const refresh = () => {
    const now = Date.now()
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
    const s = pickSession(readLive(LIVE_DIR, now), folders)
    if (!s) {
      item.hide()
      return
    }
    const r = render(s, now)
    item.text = r.text
    item.tooltip = new vscode.MarkdownString(tooltip(s, now))
    item.backgroundColor = TONE_BG[r.tone] ? new vscode.ThemeColor(TONE_BG[r.tone]) : undefined
    item.show()
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
    { dispose: () => clearInterval(timer) },
    vscode.commands.registerCommand('claudeStatus.showSessions', showSessions),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  )
  refresh()
}

function deactivate() {}

module.exports = { activate, deactivate }
