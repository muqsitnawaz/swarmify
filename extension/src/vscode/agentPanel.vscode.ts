// Agent Panel: an activity-bar sidebar view that always reflects the user's
// currently focused agent terminal.
//
// Shows:
//   - Title / agent / version / session chunk / label (manual or auto) / account
//   - Working directory (and worktree path when worktree-per-terminal is on)
//   - PLAN.md presence + last-modified timestamp (click to open)
//   - Teams whose workspace_dir is related to the terminal's cwd, with
//     teammate status (running / completed / pending / failed)
//
// Detection model:
//   active terminal -> terminals.getByTerminal(t) -> EditorTerminal struct
//   cwd            -> terminal.creationOptions.cwd
//   teams          -> agents teams list --json + agents teams status <t> --json
//                     filtered by pathsRelated(workspace_dir, cwd)
//
// Refresh signals:
//   onDidChangeActiveTerminal               -> re-render immediately
//   onDidCloseTerminal / onDidOpenTerminal  -> re-render
//   fs.watch on PLAN.md                     -> re-render
//   4s poll while visible                   -> teams data freshness

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as terminals from './terminals.vscode';
import { listTeamsForCwd, TeamWithMates, TeammateLite } from './foreman.sources';
import { getSessionPathBySessionId, getSessionPreviewInfo, SessionPreviewInfo } from './sessions.vscode';

export const AGENT_PANEL_VIEW_ID = 'agentsPanel.terminal';

interface PlanFileInfo {
  path: string;
  mtimeMs: number;
}

interface ConversationSummary {
  topic?: string;            // first user prompt — what this session is about
  lastMessage?: string;      // most recent user message
  messageCount: number;
  lastActivityMs?: number;
}

interface PanelSnapshot {
  hasTerminal: boolean;
  // Terminal facts
  agentName?: string;        // "Claude"
  agentPrefix?: string;      // "CC"
  sessionChunk?: string;     // first 8 of session UUID
  fullSessionId?: string;
  version?: string;
  label?: string;
  autoLabel?: string;
  account?: string;
  // Filesystem
  cwd?: string;
  worktreePath?: string;     // when distinguishable from workspace root
  workspaceRoot?: string;
  // Conversation
  conversation?: ConversationSummary;
  // Plan files
  plan?: PlanFileInfo;
  // Teams
  teams: TeamWithMates[];
  // Errors / diagnostics
  teamsError?: string;
}

class AgentPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private snapshot: PanelSnapshot = { hasTerminal: false, teams: [] };
  private pollTimer: NodeJS.Timeout | undefined;
  private planWatcher: vscode.FileSystemWatcher | undefined;
  private lastWatchedDir: string | undefined;
  // The webview script signals 'ready' once its message listener is attached.
  // Until then, postMessage calls race the iframe load and get dropped — so we
  // queue a single "send current snapshot when ready" flag.
  private webviewReady = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    // Each fresh resolve gets a fresh iframe — its listener has not attached
    // yet, so any cached "ready" state from a previous mount is invalid.
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'assets')],
    };

    webviewView.webview.html = this.renderShell(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        this.webviewReady = true;
        // Push whatever we have right now; refresh() will run in the background
        // and push the fresh snapshot when it lands.
        this.view?.webview.postMessage({ type: 'snapshot', data: this.snapshot });
        void this.refresh();
      } else if (msg?.type === 'openPath' && typeof msg.path === 'string') {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
      } else if (msg?.type === 'revealCwd' && typeof msg.path === 'string') {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
      } else if (msg?.type === 'refresh') {
        void this.refresh();
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });

    webviewView.onDidDispose(() => {
      this.stopPolling();
      this.disposePlanWatcher();
      this.view = undefined;
    });

    void this.refresh();
    if (webviewView.visible) this.startPolling();
  }

  // Public so the extension can poke a refresh on terminal lifecycle events
  // (open / close / active change) without us subscribing to them here.
  async refresh(): Promise<void> {
    if (!this.view) return;
    this.snapshot = await this.buildSnapshot();
    this.syncPlanWatcher(this.snapshot.cwd);
    if (this.webviewReady) {
      this.view.webview.postMessage({ type: 'snapshot', data: this.snapshot });
    }
    // If not ready, snapshot stays cached; the 'ready' handler will push it.
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, 4000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private disposePlanWatcher(): void {
    if (this.planWatcher) {
      this.planWatcher.dispose();
      this.planWatcher = undefined;
      this.lastWatchedDir = undefined;
    }
  }

  // Reset the PLAN.md watcher when the focused terminal's cwd changes.
  private syncPlanWatcher(cwd: string | undefined): void {
    if (cwd === this.lastWatchedDir) return;
    this.disposePlanWatcher();
    if (!cwd) return;
    const pattern = new vscode.RelativePattern(cwd, 'PLAN.md');
    this.planWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = () => void this.refresh();
    this.planWatcher.onDidChange(onChange);
    this.planWatcher.onDidCreate(onChange);
    this.planWatcher.onDidDelete(onChange);
    this.lastWatchedDir = cwd;
  }

  private async buildSnapshot(): Promise<PanelSnapshot> {
    const active = vscode.window.activeTerminal;
    if (!active) {
      return { hasTerminal: false, teams: [] };
    }
    const entry = terminals.getByTerminal(active);
    if (!entry || !entry.agentConfig) {
      return { hasTerminal: false, teams: [] };
    }

    const opts = active.creationOptions as vscode.TerminalOptions;
    const cwdRaw = opts?.cwd;
    const cwd =
      typeof cwdRaw === 'string'
        ? cwdRaw
        : cwdRaw && 'fsPath' in cwdRaw
          ? (cwdRaw as vscode.Uri).fsPath
          : undefined;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const worktreePath = cwd && workspaceRoot && cwd !== workspaceRoot ? cwd : undefined;

    const plan = cwd ? readPlanFile(cwd) : undefined;

    const sessionId = entry.sessionId;
    const sessionChunk = sessionId ? sessionId.slice(0, 8) : undefined;

    const snapshot: PanelSnapshot = {
      hasTerminal: true,
      agentName: entry.agentConfig.title,
      agentPrefix: entry.agentConfig.prefix,
      sessionChunk,
      fullSessionId: sessionId,
      version: entry.statusVersion || entry.version,
      label: entry.label,
      autoLabel: entry.autoLabel,
      account: entry.statusAccount || entry.account,
      cwd,
      worktreePath,
      workspaceRoot,
      plan,
      teams: [],
    };

    // Conversation summary — first/last user message + message count, sourced
    // straight from the agent's session JSONL via the cached preview helper.
    if (sessionId && entry.agentType) {
      try {
        const filePath = await getSessionPathBySessionId(sessionId, entry.agentType);
        if (filePath) {
          const preview: SessionPreviewInfo = await getSessionPreviewInfo(filePath);
          snapshot.conversation = {
            topic: preview.firstUserMessage,
            lastMessage: preview.lastUserMessage,
            messageCount: preview.messageCount,
            lastActivityMs: preview.lastActivityMs,
          };
        }
      } catch {
        // Session preview is best-effort; never block the panel on it.
      }
    }

    try {
      snapshot.teams = await listTeamsForCwd(cwd);
    } catch (err) {
      snapshot.teamsError = err instanceof Error ? err.message : String(err);
    }

    return snapshot;
  }

  private renderShell(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const cspSource = webview.cspSource;
    return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {
    color-scheme: light dark;
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    padding: 0 12px 16px;
    margin: 0;
  }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
    margin: 14px 0 6px;
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    padding: 24px 4px;
    font-style: italic;
  }
  .card {
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 8px 10px;
    background: var(--vscode-sideBar-background);
    margin-top: 4px;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-weight: 600;
  }
  .agent-name { color: var(--vscode-foreground); }
  .session-chunk {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    font-weight: 400;
  }
  .version-pill {
    margin-left: auto;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 500;
  }
  .label-row {
    margin-top: 3px;
    color: var(--vscode-foreground);
  }
  .label-auto {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .account-row {
    margin-top: 3px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .row-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    margin-top: 4px;
  }
  .row-grid dt {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .row-grid dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path-link {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }
  .path-link:hover { text-decoration: underline; }
  .plan-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
  }
  .plan-meta {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .conv-topic {
    color: var(--vscode-foreground);
    line-height: 1.4;
    /* Cap at four lines so very long topics don't push the rest of the panel
       below the fold. The full topic still renders in title attribute? no —
       just truncated server-side via truncate(). */
    word-break: break-word;
  }
  .conv-meta {
    margin-top: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .team {
    margin-top: 6px;
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 6px 8px;
    background: var(--vscode-sideBar-background);
  }
  .team-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .team-name { font-weight: 600; }
  .team-counts {
    margin-left: auto;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
  }
  .mate {
    display: grid;
    grid-template-columns: 14px 1fr auto auto;
    align-items: center;
    gap: 6px;
    padding: 2px 0 2px 4px;
    font-size: 11.5px;
  }
  .mate-dot {
    width: 6px; height: 6px; border-radius: 50%;
    justify-self: center;
  }
  .mate-dot.running   { background: var(--vscode-charts-green, #6abe6a); }
  .mate-dot.completed { background: var(--vscode-descriptionForeground); }
  .mate-dot.pending   { background: var(--vscode-charts-yellow, #d4a72c); }
  .mate-dot.failed    { background: var(--vscode-errorForeground, #d4534b); }
  .mate-dot.stopped   { background: var(--vscode-descriptionForeground); opacity: 0.5; }
  .mate-name { font-family: var(--vscode-editor-font-family, monospace); }
  .mate-agent {
    color: var(--vscode-descriptionForeground);
    font-size: 10.5px;
  }
  .mate-status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
  }
  .err {
    color: var(--vscode-errorForeground);
    font-size: 11px;
    margin-top: 4px;
  }
  .footer {
    margin-top: 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 10.5px;
    text-align: right;
  }
  .footer button {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .footer button:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="root">
  <div class="empty">Loading...</div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function relTime(ms) {
  if (!ms) return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'just now';
  const m = Math.floor(delta / 60_000);
  if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  const d = Math.floor(h / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

function homeTilde(p) {
  if (!p) return '';
  // The webview can't read process.env.HOME; show full path. The CSS clips it.
  return p;
}

function renderTerminalCard(s) {
  const titleBits = [
    '<span class="agent-name">' + esc(s.agentName || s.agentPrefix || 'Agent') + '</span>',
    s.sessionChunk ? '<span class="session-chunk">' + esc(s.sessionChunk) + '</span>' : '',
    s.version ? '<span class="version-pill">v' + esc(s.version) + '</span>' : ''
  ].join('');
  let label = '';
  if (s.label) {
    label = '<div class="label-row">' + esc(s.label) + '</div>';
  } else if (s.autoLabel) {
    label = '<div class="label-row label-auto">' + esc(s.autoLabel) + '</div>';
  }
  const account = s.account ? '<div class="account-row">' + esc(s.account) + '</div>' : '';
  return (
    '<div class="card">' +
      '<div class="title-row">' + titleBits + '</div>' +
      label +
      account +
    '</div>'
  );
}

function renderConversationCard(s) {
  if (!s.conversation) return '';
  const c = s.conversation;
  const topic = (c.topic || '').replace(/\\s+/g, ' ').trim();
  if (!topic && !c.messageCount) return '';
  const meta = [];
  if (c.messageCount) meta.push(c.messageCount + ' message' + (c.messageCount === 1 ? '' : 's'));
  if (c.lastActivityMs) meta.push(relTime(c.lastActivityMs));
  return (
    '<h2>Conversation</h2>' +
    '<div class="card">' +
      (topic ? '<div class="conv-topic">' + esc(truncate(topic, 220)) + '</div>' : '') +
      (meta.length ? '<div class="conv-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
    '</div>'
  );
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderCwdCard(s) {
  if (!s.cwd) return '';
  const rows = [];
  rows.push(
    '<dt>cwd</dt><dd><a class="path-link" data-path="' + esc(s.cwd) + '">' + esc(homeTilde(s.cwd)) + '</a></dd>'
  );
  if (s.worktreePath && s.workspaceRoot && s.worktreePath !== s.workspaceRoot) {
    rows.push(
      '<dt>worktree</dt><dd><a class="path-link" data-path="' + esc(s.worktreePath) + '">' + esc(homeTilde(s.worktreePath)) + '</a></dd>'
    );
  }
  return (
    '<h2>Working dir</h2>' +
    '<div class="card"><dl class="row-grid">' + rows.join('') + '</dl></div>'
  );
}

function renderPlanCard(s) {
  if (!s.plan) {
    if (!s.cwd) return '';
    return (
      '<h2>Plan</h2>' +
      '<div class="card"><div class="plan-meta">No PLAN.md in this directory.</div></div>'
    );
  }
  return (
    '<h2>Plan</h2>' +
    '<div class="card">' +
      '<div class="plan-line">' +
        '<a class="path-link" data-path="' + esc(s.plan.path) + '">PLAN.md</a>' +
        '<span class="plan-meta">' + esc(relTime(s.plan.mtimeMs)) + '</span>' +
      '</div>' +
    '</div>'
  );
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running' || s === 'in_progress') return 'running';
  if (s === 'completed' || s === 'done')      return 'completed';
  if (s === 'pending' || s === 'queued')      return 'pending';
  if (s === 'failed' || s === 'error')        return 'failed';
  if (s === 'stopped' || s === 'cancelled')   return 'stopped';
  return 'pending';
}

function renderTeammate(m) {
  return (
    '<div class="mate">' +
      '<span class="mate-dot ' + statusClass(m.status) + '"></span>' +
      '<span class="mate-name">' + esc(m.name) + '</span>' +
      '<span class="mate-agent">' + esc(m.agent_type) + '</span>' +
      '<span class="mate-status">' + esc(m.status) + '</span>' +
    '</div>'
  );
}

function renderTeam(t) {
  const counts = [];
  if (t.running)   counts.push(t.running + ' run');
  if (t.pending)   counts.push(t.pending + ' pend');
  if (t.completed) counts.push(t.completed + ' done');
  if (t.failed)    counts.push(t.failed + ' fail');
  const headRight = counts.length ? counts.join(' · ') : (t.agent_count + ' agent' + (t.agent_count === 1 ? '' : 's'));
  const mates = (t.teammates || []).map(renderTeammate).join('');
  return (
    '<div class="team">' +
      '<div class="team-head">' +
        '<span class="team-name">' + esc(t.task_name) + '</span>' +
        '<span class="team-counts">' + esc(headRight) + '</span>' +
      '</div>' +
      mates +
    '</div>'
  );
}

function renderTeamsCard(s) {
  const teams = s.teams || [];
  if (!teams.length) {
    return (
      '<h2>Teams in this directory</h2>' +
      '<div class="card"><div class="plan-meta">' +
        (s.teamsError
          ? esc(s.teamsError)
          : 'No teams active here. Start one with <span style="font-family: var(--vscode-editor-font-family, monospace);">agents teams create</span>.') +
      '</div></div>'
    );
  }
  return (
    '<h2>Teams in this directory</h2>' +
    teams.map(renderTeam).join('')
  );
}

function render(snap) {
  if (!snap || !snap.hasTerminal) {
    root.innerHTML = (
      '<div class="empty">No agent terminal focused.<br><br>' +
      'Click an agent tab in the editor, or open one with <b>Cmd+Shift+A</b>.</div>'
    );
    return;
  }
  root.innerHTML = (
    renderTerminalCard(snap) +
    renderConversationCard(snap) +
    renderCwdCard(snap) +
    renderPlanCard(snap) +
    renderTeamsCard(snap) +
    '<div class="footer"><button id="refresh-btn">Refresh</button></div>'
  );
  for (const el of root.querySelectorAll('.path-link')) {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openPath', path: el.getAttribute('data-path') });
    });
  }
  const btn = root.querySelector('#refresh-btn');
  if (btn) btn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'snapshot') render(msg.data);
});

// Signal readiness AFTER the listener is attached so the extension host
// doesn't race us with the first snapshot.
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function readPlanFile(cwd: string): PlanFileInfo | undefined {
  try {
    const p = path.join(cwd, 'PLAN.md');
    const st = fs.statSync(p);
    if (!st.isFile()) return undefined;
    return { path: p, mtimeMs: st.mtimeMs };
  } catch {
    return undefined;
  }
}

function randomNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export function registerAgentPanel(context: vscode.ExtensionContext): AgentPanelProvider {
  const provider = new AgentPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AGENT_PANEL_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Re-render on terminal lifecycle events.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => void provider.refresh()),
    vscode.window.onDidCloseTerminal(() => void provider.refresh()),
    vscode.window.onDidOpenTerminal(() => void provider.refresh())
  );

  return provider;
}
