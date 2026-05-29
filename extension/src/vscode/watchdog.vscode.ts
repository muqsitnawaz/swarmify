import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import {
  classifyTerminal,
  composePromptWithPlaybook,
  renderWatchdogPrompt,
  parseWatchdogResponse,
  isLikelyTrulyBlocked,
  WatchdogCandidate,
  Decision,
} from '../core/watchdog';
import {
  AgentsViewJsonAgent,
  isVersionStillUsable,
  sessionUsedPercent,
} from '../core/resumeInBest';
import { getAllTerminals, getById, EditorTerminal } from './terminals.vscode';
import { getSessionPathBySessionId, readTailLines } from './sessions.vscode';
import { formatEvent, trimToLast, WatchdogEvent } from '../core/watchdogLog';
import { detectWaitingForInput } from '../core/session.activity';
import { summarizeWatchdogTail, TailSummary } from '../core/watchdogTail';

const WATCHDOG_LOG_PATH = path.join(os.homedir(), '.agents', 'watchdog.log');
const LOG_MAX_LINES = 500;

// User-editable playbook appended to the watchdog's built-in prompt each tick.
// Stored at ~/.agents/playbooks/watchdog.md so it persists across extension
// reinstalls and is shareable as a plain file.
//
// Why playbook and not skill: a skill in agents-cli is invocable expertise
// (description-triggered, allowed-tools, optionally user-invocable). This file
// is none of that — it's a static text extension to ONE fixed process's prompt.
// Pushing it into ~/.agents/skills/ would put a non-skill in `agents skills
// list` and require fake frontmatter. Foreman/Factory house-rules would follow
// the same playbook shape.
export const WATCHDOG_PLAYBOOK_PATH = path.join(
  os.homedir(),
  '.agents',
  'playbooks',
  'watchdog.md'
);

const WATCHDOG_PLAYBOOK_TEMPLATE = `# Watchdog Playbook

House rules appended to the Watchdog's built-in prompt on every tick.
Add patterns you've observed. One rule per bullet. Be specific.

## Nudge recipes

- When the agent says "I'll write/create/run X" with no matching tool call
  in the next 30 seconds, nudge: "Do it now."

## Skip rules

- Skip if the last assistant message ends with a question mark — user input expected.

## Project-specific

- (Add rules tied to your repos here.)
`;

export function readWatchdogPlaybook(): string {
  try {
    return fsSync.readFileSync(WATCHDOG_PLAYBOOK_PATH, 'utf8');
  } catch {
    return '';
  }
}

export function ensureWatchdogPlaybookScaffold(): void {
  if (fsSync.existsSync(WATCHDOG_PLAYBOOK_PATH)) return;
  fsSync.mkdirSync(path.dirname(WATCHDOG_PLAYBOOK_PATH), { recursive: true });
  fsSync.writeFileSync(WATCHDOG_PLAYBOOK_PATH, WATCHDOG_PLAYBOOK_TEMPLATE, 'utf8');
}

export interface WatchdogPlaybookStatus {
  exists: boolean;
  lines: number;
  mtimeMs: number;
}

export function getWatchdogPlaybookStatus(): WatchdogPlaybookStatus {
  try {
    const stat = fsSync.statSync(WATCHDOG_PLAYBOOK_PATH);
    const content = fsSync.readFileSync(WATCHDOG_PLAYBOOK_PATH, 'utf8');
    return {
      exists: true,
      lines: content.split('\n').filter((l) => l.trim().length > 0).length,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { exists: false, lines: 0, mtimeMs: 0 };
  }
}

async function appendToLog(ev: WatchdogEvent): Promise<void> {
  try {
    const line = formatEvent(ev) + '\n';
    let existing = '';
    try {
      existing = await fs.readFile(WATCHDOG_LOG_PATH, 'utf8');
    } catch {
      // file doesn't exist yet
    }
    const trimmed = trimToLast(existing + line, LOG_MAX_LINES);
    await fs.mkdir(path.dirname(WATCHDOG_LOG_PATH), { recursive: true });
    await fs.writeFile(WATCHDOG_LOG_PATH, trimmed, 'utf8');
  } catch (err) {
    console.warn('[WATCHDOG] log write failed:', err);
  }
}

const OPT_OUT_KEY = 'watchdog.optOut';
const DORMANT_MS = 60 * 60 * 1000;
const HEADLESS_TIMEOUT_MS = 30_000;
const TAIL_LINES = 20;
const WATCHDOG_MODEL = 'haiku';

const execAsync = promisify(exec);

export type WatchdogRotateOutcome =
  | { status: 'no_session' }
  | { status: 'unsupported_agent' }
  | { status: 'view_unavailable' }
  | { status: 'already_usable'; agentKey: string; version: string; usedPercent: number }
  | { status: 'no_versions'; agentKey: string }
  | { status: 'rotated'; agentKey: string; oldVersion?: string; newVersion: string; newSessionId: string; email: string | null; usedPercent: number };

export interface WatchdogDeps {
  rotateTerminal: (entry: EditorTerminal) => Promise<WatchdogRotateOutcome>;
  mcpServerPath?: string;
}

function getOptOut(context: vscode.ExtensionContext): Record<string, boolean> {
  return context.globalState.get<Record<string, boolean>>(OPT_OUT_KEY) ?? {};
}

async function setOptOut(
  context: vscode.ExtensionContext,
  terminalId: string,
  optedOut: boolean
): Promise<void> {
  const current = getOptOut(context);
  if (optedOut) {
    current[terminalId] = true;
  } else {
    delete current[terminalId];
  }
  await context.globalState.update(OPT_OUT_KEY, current);
}

interface WatchdogConfig {
  enabled: boolean;
  stallMs: number;
  cooldownMs: number;
  tickMs: number;
  stallNudgeEnabled: boolean;
  autoRotate: boolean;
  rotateCooldownMs: number;
  useSmartAgent: boolean;
}

function readConfig(): WatchdogConfig {
  const cfg = vscode.workspace.getConfiguration('agents.watchdog');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    stallMs: cfg.get<number>('stallSeconds', 300) * 1000,
    cooldownMs: cfg.get<number>('cooldownSeconds', 1200) * 1000,
    tickMs: cfg.get<number>('tickSeconds', 120) * 1000,
    stallNudgeEnabled: cfg.get<boolean>('stallNudge', true),
    autoRotate: cfg.get<boolean>('autoRotate', true),
    rotateCooldownMs: cfg.get<number>('rotateCooldownSeconds', 120) * 1000,
    useSmartAgent: cfg.get<boolean>('useSmartAgent', false),
  };
}

async function fetchAgentsViewJsonForWatchdog(agentKey: string): Promise<AgentsViewJsonAgent | null> {
  try {
    const { runAgents } = await import('../core/agentsBin');
    const { stdout } = await runAgents(`view ${agentKey} --json`, {
      maxBuffer: 5 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as AgentsViewJsonAgent;
    if (!parsed || !Array.isArray(parsed.versions)) return null;
    return parsed;
  } catch (err) {
    console.warn(`[WATCHDOG] agents view ${agentKey} --json failed:`, err);
    return null;
  }
}

async function runClaudeHeadless(prompt: string): Promise<Decision[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--model', WATCHDOG_MODEL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claude headless timed out'));
    }, HEADLESS_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(parseWatchdogResponse(stdout));
    });
  });
}

const SMART_AGENT_TIMEOUT_MS = 120_000;

const SMART_WATCHDOG_PROMPT = `You are the Watchdog. You've been invoked because one or more agent terminals appear stalled. Your job is to understand what each agent was doing, decide if it needs a nudge, and send appropriate messages.

## Your Tools

**Bash commands (use these to understand context):**
- \`agents sessions tail <sessionId> --last 50\` - Read session history including user messages
- \`mq . '.tree | depth(1)'\` - Project structure
- \`mq AGENTS.md .tree\` - Project conventions (or CLAUDE.md)
- \`linear tasks\` - Linear board context

**MCP tool:** \`send_nudge(sessionId, text, reason)\`

## Decision Process

1. Read the session with \`agents sessions tail <sessionId> --last 50\`
2. Find the user's original request and what the agent said it would do
3. Get project context with \`mq\` if needed for specific commands
4. Decide: NUDGE (agent announced action but didn't follow through) or SKIP (waiting on user, task complete, or unclear)

## Nudge Style

- One sentence, imperative: "Read login.ts now.", "Run the tests."
- Use project conventions when known
- No emojis. Under 120 characters.

## Stalled Terminals
`;

async function runSmartWatchdogAgent(
  candidates: WatchdogCandidate[],
  mcpServerPath: string,
  workspacePath: string,
  playbook: string
): Promise<void> {
  const candidateList = candidates
    .map(
      (c) =>
        `- Session \`${c.terminalId}\` (${c.agentType}): idle ${Math.round(c.stalledForMs / 1000)}s`
    )
    .join('\n');

  const systemPrompt = composePromptWithPlaybook(SMART_WATCHDOG_PROMPT, playbook);
  const prompt = systemPrompt + '\n' + candidateList + '\n\nInvestigate each session and decide whether to nudge or skip.';

  // Spawn via `agents run claude` (not bare `claude`) so the watchdog inherits
  // the user's synced skills/commands/plugins from ~/.agents/. `agents run`
  // sets CLAUDE_CONFIG_DIR to the versioned home; bare `claude` would only see
  // the system ~/.claude.
  return new Promise((resolve, reject) => {
    const child = spawn(
      'agents',
      ['run', 'claude', '-p', prompt, '--mcp', mcpServerPath, '--model', WATCHDOG_MODEL],
      {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WATCHDOG_MODE: '1' },
      }
    );

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('smart watchdog agent timed out'));
    }, SMART_AGENT_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      console.log('[WATCHDOG-AGENT]', d.toString('utf8').trim());
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`smart watchdog exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve();
    });
  });
}

let tickInFlight = false;
// Idle-window gating: when the IDE window has been unfocused for this long,
// skip ticks. The watchdog does network-bound `agents view` calls and may
// spawn `claude` headless subprocesses — none of which are useful when the
// user isn't watching. Tick count per hour drops from 30 to ~0 on background
// windows.
const WATCHDOG_IDLE_SKIP_MS = 5 * 60_000;
let lastFocusedAtMs = Date.now();

async function tick(
  context: vscode.ExtensionContext,
  lastNudgeMs: Map<string, number>,
  lastRotateMs: Map<string, number>,
  deps: WatchdogDeps
): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const cfg = readConfig();
    if (!cfg.enabled) return;

    // Skip if no agent terminals exist in this window — the watchdog has
    // nothing to nudge or rotate without one.
    const tracked = getAllTerminals().filter(
      (e) => !!e.sessionId && !!e.agentType,
    );
    if (tracked.length === 0) return;

    // Skip when the window has been unfocused long enough that the user is
    // clearly elsewhere. `vscode.window.state.focused` is a live snapshot;
    // we keep our own freshness clock so we don't hammer when the user
    // hasn't touched the window in minutes.
    if (vscode.window.state.focused) lastFocusedAtMs = Date.now();
    if (Date.now() - lastFocusedAtMs >= WATCHDOG_IDLE_SKIP_MS) return;

    const now = Date.now();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const optOut = getOptOut(context);
    const candidates: WatchdogCandidate[] = [];

    const agentViewCache = new Map<string, AgentsViewJsonAgent | null>();
    const getAgentView = async (agentKey: string): Promise<AgentsViewJsonAgent | null> => {
      if (agentViewCache.has(agentKey)) return agentViewCache.get(agentKey) ?? null;
      const data = await fetchAgentsViewJsonForWatchdog(agentKey);
      agentViewCache.set(agentKey, data);
      return data;
    };

    for (const entry of tracked) {
      if (!entry.sessionId || !entry.agentType) continue;
      const agentType = entry.agentType;
      if (agentType !== 'claude' && agentType !== 'codex' && agentType !== 'gemini') continue;
      if (optOut[entry.id]) continue;

      // Auto-rotate: check if the pinned version is exhausted and swap to
      // the best available quad before looking at stall/nudge logic.
      // Runs first because a rotated terminal replaces this entry — no
      // point nudging an agent we're about to dispose.
      if (cfg.autoRotate && entry.version && agentType === 'claude') {
        const lastRotate = lastRotateMs.get(entry.id) ?? 0;
        if (now - lastRotate >= cfg.rotateCooldownMs) {
          const view = await getAgentView(agentType);
          if (view) {
            const current = view.versions.find((v) => v.version === entry.version);
            if (current && !isVersionStillUsable(current)) {
              console.log(
                `[WATCHDOG] auto-rotate triggered for ${entry.id} — ${agentType}@${entry.version} status=${current.usageStatus} session=${sessionUsedPercent(current)}%`
              );
              lastRotateMs.set(entry.id, now);
              try {
                const outcome = await deps.rotateTerminal(entry);
                if (outcome.status === 'rotated') {
                  const acct = outcome.email ? ` (${outcome.email})` : '';
                  vscode.window.setStatusBarMessage(
                    `Auto-rotated ${outcome.agentKey} ${outcome.oldVersion ?? '?'} -> ${outcome.newVersion}${acct} · ${outcome.usedPercent}% session`,
                    8000
                  );
                  console.log(`[WATCHDOG] rotated ${entry.id} -> ${outcome.newVersion}`);
                  void appendToLog({
                    ts: now,
                    kind: 'rotate',
                    terminalId: entry.id,
                    agentType: agentType,
                    message: `${outcome.oldVersion ?? '?'} -> ${outcome.newVersion}`,
                    reason: `session ${outcome.usedPercent}% used${acct}`,
                  });
                  continue;
                }
                if (outcome.status === 'no_versions') {
                  vscode.window.setStatusBarMessage(
                    `All ${outcome.agentKey} quads exhausted — no rotation target`,
                    8000
                  );
                  console.log(`[WATCHDOG] no available versions to rotate ${entry.id} into`);
                }
              } catch (err) {
                console.error(`[WATCHDOG] rotate failed for ${entry.id}:`, err);
              }
            }
          }
        }
      }

      if (!cfg.stallNudgeEnabled) continue;

      const sessionPath = await getSessionPathBySessionId(
        entry.sessionId,
        agentType,
        workspacePath
      );
      if (!sessionPath) continue;

      let mtimeMs: number;
      try {
        const stat = await fs.stat(sessionPath);
        mtimeMs = stat.mtimeMs;
      } catch {
        continue;
      }

      const status = classifyTerminal({
        lastActivityMs: mtimeMs,
        nowMs: now,
        lastNudgeMs: lastNudgeMs.get(entry.id) ?? null,
        optedOut: !!optOut[entry.id],
        stallMs: cfg.stallMs,
        cooldownMs: cfg.cooldownMs,
        dormantMs: DORMANT_MS,
      });

      if (status.kind !== 'stalled') continue;

      const tailLines = await readTailLines(sessionPath, TAIL_LINES);
      const tailText = tailLines.join('\n');
      if (detectWaitingForInput(tailText, agentType)) continue;

      const candidate: WatchdogCandidate = {
        terminalId: entry.id,
        agentType,
        tailLines,
        stalledForMs: status.stalledForMs,
      };
      if (!isLikelyTrulyBlocked(candidate)) continue;
      candidates.push(candidate);
    }

    if (candidates.length === 0) return;

    const summaries = new Map<string, TailSummary>();
    for (const c of candidates) {
      summaries.set(c.terminalId, summarizeWatchdogTail(c.tailLines, c.agentType));
    }

    for (const c of candidates) {
      const s = summaries.get(c.terminalId) ?? {};
      void appendToLog({
        ts: now,
        kind: 'tick',
        terminalId: c.terminalId,
        agentType: c.agentType,
        message: `stalled ${Math.round(c.stalledForMs / 1000)}s`,
        tailLines: c.tailLines,
        stalledForMs: c.stalledForMs,
        lastUserMessage: s.lastUserMessage,
        lastAssistantMessage: s.lastAssistantMessage,
      });
    }

    // Load user playbook once per tick — appended to whichever prompt runs.
    const playbook = readWatchdogPlaybook();

    // Use smart agent if configured and MCP server is available
    if (cfg.useSmartAgent && deps.mcpServerPath && workspacePath) {
      console.log(`[WATCHDOG] ${candidates.length} stalled candidate(s), invoking smart agent`);
      try {
        await runSmartWatchdogAgent(candidates, deps.mcpServerPath, workspacePath, playbook);
        void appendToLog({
          ts: Date.now(),
          kind: 'decision',
          message: 'smart agent completed',
        });
      } catch (err) {
        console.error('[WATCHDOG] smart agent failed:', err);
        void appendToLog({
          ts: Date.now(),
          kind: 'error',
          message: `smart agent failed: ${String(err).slice(0, 200)}`,
        });
      }
      return;
    }

    // Fallback: classic headless mode with JSON decisions
    console.log(`[WATCHDOG] ${candidates.length} stalled candidate(s), calling claude headless`);

    let decisions: Decision[] = [];
    try {
      decisions = await runClaudeHeadless(renderWatchdogPrompt(candidates, playbook));
    } catch (err) {
      console.error('[WATCHDOG] headless run failed:', err);
      void appendToLog({
        ts: Date.now(),
        kind: 'error',
        message: `headless run failed: ${String(err).slice(0, 200)}`,
      });
      return;
    }

    for (const d of decisions) {
      const s = summaries.get(d.terminalId) ?? {};
      void appendToLog({
        ts: Date.now(),
        kind: 'decision',
        terminalId: d.terminalId,
        message: d.action,
        reason: d.reason,
        nudgeText: d.action === 'nudge' ? d.text.trim() || undefined : undefined,
        lastUserMessage: s.lastUserMessage,
        lastAssistantMessage: s.lastAssistantMessage,
      });

      if (d.action !== 'nudge') continue;
      const text = d.text.trim();
      if (!text) continue;
      const entry = getById(d.terminalId);
      if (!entry) continue;
      try {
        // Ink TUIs (Claude) watch for `\r` as Enter; `sendText(text, true)`
        // appends `\n` which types into the input but does NOT submit.
        if (entry.agentType === 'claude') {
          entry.terminal.sendText(text, false);
          entry.terminal.sendText('\r', false);
        } else {
          entry.terminal.sendText(text, true);
        }
        lastNudgeMs.set(d.terminalId, Date.now());
        console.log(`[WATCHDOG] nudged ${d.terminalId} (${d.reason}): ${text}`);
        void appendToLog({
          ts: Date.now(),
          kind: 'nudge',
          terminalId: d.terminalId,
          agentType: entry.agentType ?? undefined,
          message: text,
          reason: d.reason,
          nudgeText: text,
          lastUserMessage: s.lastUserMessage,
          lastAssistantMessage: s.lastAssistantMessage,
        });
      } catch (err) {
        console.error(`[WATCHDOG] failed to inject into ${d.terminalId}:`, err);
        void appendToLog({
          ts: Date.now(),
          kind: 'error',
          terminalId: d.terminalId,
          message: `inject failed: ${String(err).slice(0, 200)}`,
        });
      }
    }
  } finally {
    tickInFlight = false;
  }
}

export function startWatchdog(
  context: vscode.ExtensionContext,
  deps: WatchdogDeps
): vscode.Disposable {
  const lastNudgeMs = new Map<string, number>();
  const lastRotateMs = new Map<string, number>();
  const disposables: vscode.Disposable[] = [];
  let intervalId: NodeJS.Timeout | null = null;

  const ensureInterval = () => {
    const cfg = readConfig();
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (!cfg.enabled) {
      console.log('[WATCHDOG] disabled');
      return;
    }
    intervalId = setInterval(() => {
      tick(context, lastNudgeMs, lastRotateMs, deps).catch((err) => {
        console.error('[WATCHDOG] tick error:', err);
      });
    }, cfg.tickMs);
    console.log(`[WATCHDOG] enabled, tick=${cfg.tickMs}ms stall=${cfg.stallMs}ms cooldown=${cfg.cooldownMs}ms autoRotate=${cfg.autoRotate} stallNudge=${cfg.stallNudgeEnabled}`);
  };

  ensureInterval();

  disposables.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agents.watchdog')) {
        ensureInterval();
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agents.watchdog.toggleTerminal', async () => {
      const active = vscode.window.activeTerminal;
      if (!active) return;
      const entry = getAllTerminals().find((e) => e.terminal === active);
      if (!entry) return;
      const current = getOptOut(context)[entry.id] === true;
      await setOptOut(context, entry.id, !current);
      console.log(`[WATCHDOG] ${!current ? 'opt-out' : 'opt-in'} ${entry.id} (${active.name})`);
    })
  );

  return {
    dispose() {
      if (intervalId) clearInterval(intervalId);
      for (const d of disposables) d.dispose();
    },
  };
}
