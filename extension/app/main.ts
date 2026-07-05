// Standalone Electron app: the Factory work stream running outside any editor.
// It loads the exact same React UI bundle the VS Code webview uses (built by
// vite.standalone.config.ts) and feeds it floor data over IPC, speaking the same
// message protocol the extension host does. Running agents show as telemetry; the
// editor keeps ownership of live terminal tabs.

import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as os from 'os'
import { getDefaultSettings } from '../src/core/settings'
import { fetchAllFloorTasks } from './floorData'

// Anchor every path on the compiled-main directory (app/dist), which
// app.getAppPath() returns when launched as `electron ./dist/main.js`. Layout:
// <ext>/app/dist/{main,preload}.js, <ext>/out/app-ui (built UI), <ext>/assets.
const DIST_DIR = app.getAppPath()
const UI_INDEX = path.join(DIST_DIR, '..', '..', 'out', 'app-ui', 'index.html')
const PRELOAD = path.join(DIST_DIR, 'preload.js')
const ASSETS_DIR = path.join(DIST_DIR, '..', '..', 'assets')
const POLL_MS = 5000

let win: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function send(message: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send('to-renderer', message)
}

async function pushFloor(): Promise<void> {
  // The standalone app owns no editor terminal tabs, so allTerminalsData is empty
  // and agents surface entirely from tasksData (local + cloud). The UI's
  // buildUnifiedList(terminals, tasks) handles the empty-terminals case.
  send({ type: 'allTerminalsData', terminals: [] })
  const tasks = await fetchAllFloorTasks()
  send({ type: 'tasksData', tasks })
}

ipcMain.on('to-host', (_event, message: { type?: string } | null) => {
  const type = message?.type
  if (type === 'ready') {
    // The UI blocks on `init` (its settings gate) before rendering anything, so
    // seed it with defaults, then open the floor.
    send({
      type: 'init',
      settings: getDefaultSettings(),
      runningCounts: { claude: 0, codex: 0, gemini: 0, opencode: 0, cursor: 0, shell: 0, custom: {} },
      workspacePath: os.homedir(),
      dismissedTaskIds: [],
    })
    send({ type: 'panelVisibility', visible: true })
    void pushFloor()
    return
  }
  if (type === 'fetchTasks' || type === 'fetchAllTerminals' || type === 'subscribeFloor') {
    void pushFloor()
  }
  // Other message types (dispatch, settings, oauth, foreman, ...) are extension-only
  // for now; the standalone host ignores them until those surfaces are wired.
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Factory',
    backgroundColor: '#000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload uses Node builtins (path/url) to resolve local asset URLs, so
      // it can't run in the default sandbox. contextIsolation stays on — the UI
      // still only sees the narrow swarmHost surface exposed via contextBridge.
      sandbox: false,
      additionalArguments: [`--swarm-assets=${ASSETS_DIR}`],
    },
  })
  void win.loadFile(UI_INDEX)
  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  createWindow()
  pollTimer = setInterval(() => void pushFloor(), POLL_MS)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer)
  if (process.platform !== 'darwin') app.quit()
})
