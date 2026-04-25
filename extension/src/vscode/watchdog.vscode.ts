import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import {
  classifyTerminal,
  renderWatchdogPrompt,
  parseWatchdogResponse,
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

const OPT_OUT_KEY = 'watchdog.optOut';
const DORMANT_MS = 60 * 60 * 1000;
const HEADLESS_TIMEOUT_MS = 30_000;
const TAIL_LINES = 20;

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
}

function readConfig(): WatchdogConfig {
  const cfg = vscode.workspace.getConfiguration('agents.watchdog');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    stallMs: cfg.get<number>('stallSeconds', 90) * 1000,
    cooldownMs: cfg.get<number>('cooldownSeconds', 300) * 1000,
    tickMs: cfg.get<number>('tickSeconds', 60) * 1000,
    stallNudgeEnabled: cfg.get<boolean>('stallNudge', true),
    autoRotate: cfg.get<boolean>('autoRotate', true),
    rotateCooldownMs: cfg.get<number>('rotateCooldownSeconds', 120) * 1000,
  };
}

async function fetchAgentsViewJsonForWatchdog(agentKey: string): Promise<AgentsViewJsonAgent | null> {
  try {
    const { stdout } = await execAsync(`agents view ${agentKey} --json`, {
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
    const child = spawn('claude', ['-p', prompt], {
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

let tickInFlight = false;

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

    for (const entry of getAllTerminals()) {
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
      candidates.push({
        terminalId: entry.id,
        agentType,
        tailLines,
        stalledForMs: status.stalledForMs,
      });
    }

    if (candidates.length === 0) return;

    console.log(`[WATCHDOG] ${candidates.length} stalled candidate(s), calling claude headless`);

    let decisions: Decision[] = [];
    try {
      decisions = await runClaudeHeadless(renderWatchdogPrompt(candidates));
    } catch (err) {
      console.error('[WATCHDOG] headless run failed:', err);
      return;
    }

    for (const d of decisions) {
      if (d.action !== 'nudge') continue;
      const text = d.text.trim();
      if (!text) continue;
      const entry = getById(d.terminalId);
      if (!entry) continue;
      try {
        entry.terminal.sendText(text, true);
        lastNudgeMs.set(d.terminalId, Date.now());
        console.log(`[WATCHDOG] nudged ${d.terminalId} (${d.reason}): ${text}`);
      } catch (err) {
        console.error(`[WATCHDOG] failed to inject into ${d.terminalId}:`, err);
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
