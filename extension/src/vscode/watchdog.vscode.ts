import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import {
  classifyTerminal,
  renderWatchdogPrompt,
  parseWatchdogResponse,
  WatchdogCandidate,
  Decision,
} from '../core/watchdog';
import { getAllTerminals, getById } from './terminals.vscode';
import { getSessionPathBySessionId, readTailLines } from './sessions.vscode';

const OPT_OUT_KEY = 'watchdog.optOut';
const DORMANT_MS = 60 * 60 * 1000;
const HEADLESS_TIMEOUT_MS = 30_000;
const TAIL_LINES = 20;

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
}

function readConfig(): WatchdogConfig {
  const cfg = vscode.workspace.getConfiguration('agents.watchdog');
  return {
    enabled: cfg.get<boolean>('enabled', false),
    stallMs: cfg.get<number>('stallSeconds', 90) * 1000,
    cooldownMs: cfg.get<number>('cooldownSeconds', 300) * 1000,
    tickMs: cfg.get<number>('tickSeconds', 60) * 1000,
  };
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
  lastNudgeMs: Map<string, number>
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

    for (const entry of getAllTerminals()) {
      if (!entry.sessionId || !entry.agentType) continue;
      const agentType = entry.agentType;
      if (agentType !== 'claude' && agentType !== 'codex' && agentType !== 'gemini') continue;

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

export function startWatchdog(context: vscode.ExtensionContext): vscode.Disposable {
  const lastNudgeMs = new Map<string, number>();
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
      tick(context, lastNudgeMs).catch((err) => {
        console.error('[WATCHDOG] tick error:', err);
      });
    }, cfg.tickMs);
    console.log(`[WATCHDOG] enabled, tick=${cfg.tickMs}ms stall=${cfg.stallMs}ms cooldown=${cfg.cooldownMs}ms`);
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
