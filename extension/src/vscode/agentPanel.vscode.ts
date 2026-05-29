// Agent Panel: an activity-bar sidebar view that always reflects the user's
// currently focused agent terminal.
//
// Shows:
//   - Agent logo + name + version + session chunk + label (manual or auto)
//   - Worktree path with branch + dirty count and Commit / Cleanup / Wrap buttons
//   - Conversation topic + recent tool calls (read/edit/run)
//   - Linear ticket + PR URL extracted from the session, when present
//   - Quick prompts (favorites first) — click to send into the focused terminal
//   - Teams whose workspace_dir is related to the terminal's cwd
//
// Detection model:
//   active terminal -> terminals.getByTerminal(t) -> EditorTerminal struct
//   cwd            -> terminal.creationOptions.cwd
//   teams          -> agents teams list --json + agents teams status <t> --json
//                     filtered by pathsRelated(workspace_dir, cwd)
//   git info       -> vscode.git extension repository state
//   linear/PR      -> regex scan over the session preview + tail
//
// Refresh signals:
//   onDidChangeActiveTerminal               -> re-render immediately
//   onDidCloseTerminal / onDidOpenTerminal  -> re-render
//   fs.watch on PLAN.md                     -> re-render
//   4s poll while visible                   -> teams + git freshness

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as terminals from './terminals.vscode';
import { listTeamsForCwd, TeamWithMates } from './foreman.sources';
import { getSessionPathBySessionId, getSessionPreviewInfo, SessionPreviewInfo, readTailLines } from './sessions.vscode';
import { extractLinearTicketId } from '../core/utils';
import { readPrompts } from './settings.vscode';
import { BUILT_IN_AGENTS } from '../core/agents';
import { extractCurrentActivity, formatActivity } from '../core/session.activity';

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

interface ActivityItem {
  kind: string;   // 'reading' | 'editing' | 'running' | 'thinking' | 'completed' | ...
  summary: string;
  ts: number;
}

interface QuickPromptLite {
  id: string;
  title: string;
  preview: string;
  favorite: boolean;
}

interface GitInfo {
  branch?: string;
  dirtyCount?: number;
}

interface PanelSnapshot {
  hasTerminal: boolean;
  // Terminal facts
  terminalId?: string;       // internal id for action commands
  agentName?: string;        // "Claude"
  agentPrefix?: string;      // "CC"
  agentIconUri?: string;     // webview URI to PNG logo
  sessionChunk?: string;     // first 8 of session UUID
  fullSessionId?: string;
  version?: string;
  label?: string;
  autoLabel?: string;
  account?: string;
  // Filesystem
  cwd?: string;
  worktreePath?: string;     // when distinguishable from workspace root
  worktreeName?: string;     // basename shown compactly in the terminal card
  workspaceRoot?: string;
  // Git
  git?: GitInfo;
  // Conversation
  conversation?: ConversationSummary;
  recentActivity?: ActivityItem[];
  // Linked artifacts
  linearIssue?: string;
  prUrl?: string;
  // Plan files
  plan?: PlanFileInfo;
  // Teams
  teams: TeamWithMates[];
  // Quick prompts (top N favorites + recent)
  quickPrompts: QuickPromptLite[];
  // Errors / diagnostics
  teamsError?: string;
}

class AgentPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private snapshot: PanelSnapshot = { hasTerminal: false, teams: [], quickPrompts: [] };
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

    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

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

  private async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready':
        this.webviewReady = true;
        this.view?.webview.postMessage({ type: 'snapshot', data: this.snapshot });
        void this.refresh();
        return;
      case 'openPath':
        if (typeof msg.path === 'string') {
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
        }
        return;
      case 'revealCwd':
        if (typeof msg.path === 'string') {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        }
        return;
      case 'openUrl':
        if (typeof msg.url === 'string') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        return;
      case 'refresh':
        void this.refresh();
        return;
      case 'runQuickAction':
        await this.runQuickAction(msg.action, msg.terminalId, msg.workspaceRoot);
        return;
      case 'sendQuickPrompt':
        await this.sendQuickPrompt(msg.promptId, msg.terminalId);
        return;
    }
  }

  private async runQuickAction(
    action: string,
    terminalId: string | undefined,
    workspaceRoot: string | undefined,
  ): Promise<void> {
    const entry = terminalId ? terminals.getById(terminalId) : undefined;
    const terminal = entry?.terminal ?? vscode.window.activeTerminal;
    switch (action) {
      case 'commit':
        await vscode.commands.executeCommand('agents.autogit');
        return;
      case 'cleanup': {
        // `agents worktree prune` scans .history/worktrees/ *under a repo root*,
        // not inside an individual worktree — so always pass the workspace root,
        // never the active terminal's worktree path.
        const root = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
          vscode.window.showInformationMessage('No workspace root for cleanup.');
          return;
        }
        await runInShellTerminal(`agents worktree prune --root ${shellQuote(root)}`);
        return;
      }
      case 'wrap':
        if (!terminal) {
          vscode.window.showInformationMessage('No active agent terminal to wrap up.');
          return;
        }
        terminal.show(true);
        // Same gotcha the watchdog handles: Claude's Ink TUI submits on `\r`
        // while Codex/Gemini submit on the `\n` that `sendText(_, true)` adds.
        if (entry?.agentType === 'claude') {
          terminal.sendText('/done', false);
          terminal.sendText('\r', false);
        } else {
          terminal.sendText('/done', true);
        }
        return;
    }
  }

  private async sendQuickPrompt(
    promptId: string | undefined,
    terminalId: string | undefined,
  ): Promise<void> {
    if (!promptId) return;
    const all = readPrompts();
    const entry = all.find((p) => p.id === promptId);
    if (!entry) {
      vscode.window.showWarningMessage(`Prompt "${promptId}" no longer exists.`);
      return;
    }
    const terminal = terminalId ? terminals.getById(terminalId)?.terminal : vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showInformationMessage('No agent terminal to send the prompt to.');
      return;
    }
    terminal.show(true);
    // Insert without submitting so the user can edit before pressing Enter.
    terminal.sendText(entry.content, false);
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
      return { hasTerminal: false, teams: [], quickPrompts: [] };
    }
    const entry = terminals.getByTerminal(active);
    if (!entry || !entry.agentConfig) {
      return { hasTerminal: false, teams: [], quickPrompts: [] };
    }

    const opts = active.creationOptions as vscode.TerminalOptions;
    const env = opts?.env as Record<string, string | undefined> | undefined;
    const envWorkspaceDir = env?.AGENT_WORKSPACE_DIR?.trim() || undefined;
    const cwdRaw = opts?.cwd;
    const cwd =
      typeof cwdRaw === 'string'
        ? cwdRaw
        : cwdRaw && 'fsPath' in cwdRaw
          ? (cwdRaw as vscode.Uri).fsPath
          : envWorkspaceDir;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const worktreePath = cwd && workspaceRoot && path.resolve(cwd) !== path.resolve(workspaceRoot) ? cwd : undefined;
    const worktreeName = cwd ? path.basename(cwd) : undefined;

    const plan = cwd ? readPlanFile(cwd) : undefined;

    const sessionId = entry.sessionId;
    const sessionChunk = sessionId ? sessionId.slice(0, 8) : undefined;

    const snapshot: PanelSnapshot = {
      hasTerminal: true,
      terminalId: entry.id,
      agentName: entry.agentConfig.title,
      agentPrefix: entry.agentConfig.prefix,
      agentIconUri: this.iconUriFor(entry.agentConfig.prefix),
      sessionChunk,
      fullSessionId: sessionId,
      version: entry.statusVersion || entry.version,
      label: entry.label,
      autoLabel: entry.autoLabel,
      account: entry.statusAccount || entry.account,
      cwd,
      worktreePath,
      worktreeName,
      workspaceRoot,
      plan,
      teams: [],
      quickPrompts: pickQuickPrompts(),
    };

    // Conversation summary + recent activity + linked artifacts come from
    // the session JSONL. All best-effort; never block the panel on them.
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
          const linear =
            extractLinearTicketId(preview.firstUserMessage) ||
            extractLinearTicketId(preview.lastUserMessage);
          if (linear) snapshot.linearIssue = linear;

          const tailLines = await readTailLines(filePath, 80);
          snapshot.recentActivity = collectRecentActivity(tailLines, entry.agentType, 5);
          const pr = extractPrUrl(tailLines.concat(
            preview.firstUserMessage ?? '',
            preview.lastUserMessage ?? '',
          ));
          if (pr) snapshot.prUrl = pr;
        }
      } catch {
        // Session preview is best-effort; never block the panel on it.
      }
    }

    snapshot.git = cwd ? await readGitInfo(cwd) : undefined;

    try {
      snapshot.teams = await listTeamsForCwd(cwd);
    } catch (err) {
      snapshot.teamsError = err instanceof Error ? err.message : String(err);
    }

    return snapshot;
  }

  private iconUriFor(prefix: string | undefined): string | undefined {
    if (!prefix || !this.view) return undefined;
    const def = BUILT_IN_AGENTS.find(
      (a) => a.prefix === prefix || a.prefix.toUpperCase() === (prefix ?? '').toUpperCase(),
    );
    if (!def) return undefined;
    const onDisk = vscode.Uri.joinPath(this.extensionUri, 'assets', def.icon);
    return this.view.webview.asWebviewUri(onDisk).toString();
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
  .agent-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .agent-logo {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    flex-shrink: 0;
    object-fit: contain;
    background: var(--vscode-input-background, transparent);
  }
  .agent-head-text { flex: 1; min-width: 0; }
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
  .worktree-row {
    margin-top: 3px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch-row {
    margin-top: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .branch-name {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-foreground);
  }
  .dirty-pill {
    background: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-badge-background));
    color: var(--vscode-badge-foreground);
    padding: 0 5px;
    border-radius: 8px;
    font-size: 10px;
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
    word-break: break-word;
  }
  .conv-topic p { margin: 0 0 6px; }
  .conv-topic p:last-child { margin-bottom: 0; }
  .conv-topic .md-heading {
    font-weight: 600;
    margin: 0 0 5px;
  }
  .conv-topic code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.94em;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.16));
    border-radius: 3px;
    padding: 0 3px;
  }
  .conv-topic .md-bullet {
    padding-left: 10px;
    text-indent: -8px;
  }
  .conv-meta {
    margin-top: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .activity {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-size: 11.5px;
    line-height: 1.4;
  }
  .activity-kind {
    width: 56px;
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground);
    text-transform: lowercase;
    font-size: 10.5px;
  }
  .activity-summary {
    color: var(--vscode-foreground);
    word-break: break-word;
  }
  .actions-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .action-btn {
    flex: 1 1 auto;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 6px 8px;
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    text-align: center;
  }
  .action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
  }
  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .action-btn.primary:hover {
    background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
  }
  .prompt-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .prompt-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    padding: 6px 8px;
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .prompt-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .prompt-title {
    font-weight: 500;
    flex: 0 0 auto;
  }
  .prompt-preview {
    color: var(--vscode-descriptionForeground);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .prompt-star {
    color: var(--vscode-charts-yellow, #d4a72c);
    font-size: 10px;
    margin-right: 2px;
  }
  .links-list { display: flex; flex-direction: column; gap: 4px; }
  .link-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
  }
  .link-row a {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .link-row a:hover { text-decoration: underline; }
  .link-tag {
    color: var(--vscode-descriptionForeground);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderTerminalCard(s) {
  const logo = s.agentIconUri
    ? '<img class="agent-logo" src="' + esc(s.agentIconUri) + '" alt="" />'
    : '';
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
  const worktree = s.worktreeName
    ? '<div class="worktree-row">' + esc((s.worktreePath ? 'worktree ' : 'cwd ') + s.worktreeName) + '</div>'
    : '';
  let branch = '';
  if (s.git && s.git.branch) {
    const dirty = s.git.dirtyCount && s.git.dirtyCount > 0
      ? '<span class="dirty-pill">' + s.git.dirtyCount + ' changed</span>'
      : '';
    branch = '<div class="branch-row"><span>branch</span><span class="branch-name">' + esc(s.git.branch) + '</span>' + dirty + '</div>';
  }
  return (
    '<div class="card">' +
      '<div class="agent-head">' +
        logo +
        '<div class="agent-head-text">' +
          '<div class="title-row">' + titleBits + '</div>' +
          label +
          worktree +
          branch +
          account +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderActionsCard(s) {
  if (!s.cwd) return '';
  const commit = '<button class="action-btn primary" data-action="commit">Commit</button>';
  const cleanup = s.worktreePath
    ? '<button class="action-btn" data-action="cleanup">Cleanup worktree</button>'
    : '';
  const wrap = '<button class="action-btn" data-action="wrap">Wrap up</button>';
  return (
    '<h2>Quick actions</h2>' +
    '<div class="card"><div class="actions-row">' + commit + cleanup + wrap + '</div></div>'
  );
}

function renderLinksCard(s) {
  if (!s.linearIssue && !s.prUrl) return '';
  const rows = [];
  if (s.linearIssue) {
    const url = 'https://linear.app/issue/' + encodeURIComponent(s.linearIssue);
    rows.push(
      '<div class="link-row"><span class="link-tag">linear</span>' +
      '<a data-url="' + esc(url) + '">' + esc(s.linearIssue) + '</a></div>'
    );
  }
  if (s.prUrl) {
    rows.push(
      '<div class="link-row"><span class="link-tag">pr</span>' +
      '<a data-url="' + esc(s.prUrl) + '">' + esc(s.prUrl.replace(/^https?:\\/\\//, '')) + '</a></div>'
    );
  }
  return (
    '<h2>Links</h2>' +
    '<div class="card"><div class="links-list">' + rows.join('') + '</div></div>'
  );
}

function renderConversationCard(s) {
  if (!s.conversation) return '';
  const c = s.conversation;
  const topic = (c.topic || '').trim();
  if (!topic && !c.messageCount) return '';
  const meta = [];
  if (c.messageCount) meta.push(c.messageCount + ' message' + (c.messageCount === 1 ? '' : 's'));
  if (c.lastActivityMs) meta.push(relTime(c.lastActivityMs));
  return (
    '<h2>Conversation</h2>' +
    '<div class="card">' +
      (topic ? '<div class="conv-topic">' + renderMarkdownPreview(truncate(topic, 420)) + '</div>' : '') +
      (meta.length ? '<div class="conv-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
    '</div>'
  );
}

function renderActivityCard(s) {
  const items = s.recentActivity || [];
  if (!items.length) return '';
  const rows = items.map((it) => (
    '<div class="activity">' +
      '<span class="activity-kind">' + esc(it.kind) + '</span>' +
      '<span class="activity-summary">' + esc(truncate(it.summary, 80)) + '</span>' +
    '</div>'
  )).join('');
  return (
    '<h2>Recent activity</h2>' +
    '<div class="card">' + rows + '</div>'
  );
}

function renderPromptsCard(s) {
  const prompts = s.quickPrompts || [];
  if (!prompts.length) return '';
  const rows = prompts.map((p) => (
    '<button class="prompt-btn" data-prompt-id="' + esc(p.id) + '" title="' + esc(p.preview) + '">' +
      (p.favorite ? '<span class="prompt-star">★</span>' : '') +
      '<span class="prompt-title">' + esc(p.title) + '</span>' +
      '<span class="prompt-preview">' + esc(p.preview) + '</span>' +
    '</button>'
  )).join('');
  return (
    '<h2>Quick prompts</h2>' +
    '<div class="card"><div class="prompt-grid">' + rows + '</div></div>'
  );
}

function renderInlineMarkdown(s) {
  let out = esc(s);
  out = out.replace(/\\[([^\\]]+)\\]\\([^\\)]+\\)/g, '$1');
  out = out.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  return out;
}

function renderMarkdownPreview(s) {
  const lines = String(s || '').split(/\\r?\\n/);
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^#{1,6}\\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push('<div class="md-heading">' + renderInlineMarkdown(heading[1]) + '</div>');
      continue;
    }
    const bullet = line.match(/^[-*]\\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push('<div class="md-bullet">- ' + renderInlineMarkdown(bullet[1]) + '</div>');
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks.join('');
}

function renderCwdCard(s) {
  if (!s.cwd) return '';
  const rows = [];
  rows.push(
    '<dt>cwd</dt><dd><a class="path-link" data-path="' + esc(s.cwd) + '">' + esc(s.cwd) + '</a></dd>'
  );
  if (s.worktreePath && s.workspaceRoot && s.worktreePath !== s.workspaceRoot) {
    rows.push(
      '<dt>worktree</dt><dd><a class="path-link" data-path="' + esc(s.worktreePath) + '">' + esc(s.worktreePath) + '</a></dd>'
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
    if (s.teamsError) {
      return (
        '<h2>Teams in this directory</h2>' +
        '<div class="card"><div class="plan-meta">' + esc(s.teamsError) + '</div></div>'
      );
    }
    return '';
  }
  return (
    '<h2>Teams in this directory</h2>' +
    teams.map(renderTeam).join('')
  );
}

let lastSnapshot = null;

function render(snap) {
  lastSnapshot = snap;
  if (!snap || !snap.hasTerminal) {
    root.innerHTML = (
      '<div class="empty">No agent terminal focused.<br><br>' +
      'Click an agent tab in the editor, or open one with <b>Cmd+Shift+A</b>.</div>'
    );
    return;
  }
  root.innerHTML = (
    renderTerminalCard(snap) +
    renderActionsCard(snap) +
    renderLinksCard(snap) +
    renderConversationCard(snap) +
    renderActivityCard(snap) +
    renderPromptsCard(snap) +
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
  for (const el of root.querySelectorAll('[data-url]')) {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openUrl', url: el.getAttribute('data-url') });
    });
  }
  for (const el of root.querySelectorAll('[data-action]')) {
    el.addEventListener('click', () => {
      vscode.postMessage({
        type: 'runQuickAction',
        action: el.getAttribute('data-action'),
        terminalId: lastSnapshot && lastSnapshot.terminalId,
        workspaceRoot: lastSnapshot && lastSnapshot.workspaceRoot,
      });
    });
  }
  for (const el of root.querySelectorAll('[data-prompt-id]')) {
    el.addEventListener('click', () => {
      vscode.postMessage({
        type: 'sendQuickPrompt',
        promptId: el.getAttribute('data-prompt-id'),
        terminalId: lastSnapshot && lastSnapshot.terminalId,
      });
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

async function readGitInfo(cwd: string): Promise<GitInfo | undefined> {
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) return undefined;
    const api = (await ext.activate()).getAPI(1);
    const target = path.resolve(cwd);
    const repo = api.repositories.find((r: any) => {
      const root = String(r.rootUri?.fsPath || '');
      return root && (target === root || target.startsWith(root + path.sep));
    });
    if (!repo) return undefined;
    const branch = repo.state?.HEAD?.name as string | undefined;
    const dirtyCount =
      (repo.state?.workingTreeChanges?.length ?? 0) +
      (repo.state?.indexChanges?.length ?? 0) +
      (repo.state?.mergeChanges?.length ?? 0);
    return { branch, dirtyCount };
  } catch {
    return undefined;
  }
}

function collectRecentActivity(tailLines: string[], agentType: string, max: number): ActivityItem[] {
  const out: ActivityItem[] = [];
  // Walk backward so we end up with the most recent items first.
  const seen = new Set<string>();
  for (let i = tailLines.length - 1; i >= 0 && out.length < max; i--) {
    const line = tailLines[i];
    const activity = extractCurrentActivity(line, agentType as 'claude' | 'codex' | 'gemini');
    if (!activity) continue;
    const formatted = formatActivity(activity);
    if (!formatted) continue;
    const dedupeKey = `${activity.type}|${activity.summary}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      kind: activity.type,
      summary: activity.summary || formatted,
      ts: activity.timestamp.getTime(),
    });
  }
  return out;
}

const PR_URL_RE = /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

function extractPrUrl(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!line) continue;
    const match = PR_URL_RE.exec(line);
    if (match) return match[0];
  }
  return undefined;
}

function pickQuickPrompts(): QuickPromptLite[] {
  try {
    const all = readPrompts();
    const sorted = [...all].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return (b.accessedAt || 0) - (a.accessedAt || 0);
    });
    return sorted.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.title,
      preview: p.content.replace(/\s+/g, ' ').trim().slice(0, 120),
      favorite: !!p.isFavorite,
    }));
  } catch {
    return [];
  }
}

async function runInShellTerminal(command: string): Promise<void> {
  const existing = vscode.window.terminals.find((t) => t.name === 'agents: shell');
  const terminal = existing ?? vscode.window.createTerminal({ name: 'agents: shell' });
  terminal.show(true);
  terminal.sendText(command);
}

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
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
