// Foreman: voice coordinator for the factory floor.
//
// Extension host responsibilities:
//   1. Mint an ephemeral OpenAI Realtime session using the user's API key,
//      so the webview never sees the long-lived key.
//   2. Compute the live floor digest on demand and return it to the webview,
//      which forwards it to the realtime model as a tool result.

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as terminals from './terminals.vscode';
import { buildForemanDigest, ForemanDigest, ForemanTerminal, ForemanCloudTask } from '../core/foreman.digest';
import { prefixToAgentType } from '../core/utils';

const execAsync = promisify(exec);

export const FOREMAN_MODEL = 'gpt-realtime';
export const FOREMAN_VOICE = 'cedar';

export const FOREMAN_SYSTEM_PROMPT = `You are Foreman, the voice coordinator of a factory of AI coding agents.

Persona: dry, brief. Clipped sentences. No filler words. No adjectives without facts.
Never say "grinding away", "humming along", "going well", "everything's on track" -
those are content-free. If you have no specifics, say so: "nothing concrete yet".

Always call the briefing tool first. If the user asks about one agent, call focus next.

Answering rules:
- Lead with the SPECIFIC thing: the task, the file, the tool, the elapsed time.
- Example good: "Claude is 12 minutes into the auth refactor, last edited jwt.ts."
- Example bad: "Claude's been grinding for 12 minutes, humming along."
- Never summarize as "all good" - say exactly which agent is on which task.
- Use labels when present ("Philip Music"), kinds when not ("claude", "codex").
- Never narrate what the UI already shows. Bring the fact, not the tour.
- If no info: "no visible activity yet" - don't pad with speculation.

Length: 1-2 sentences default. Expand only if asked.`.trim();

export interface ForemanTool {
  type: 'function';
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export const FOREMAN_TOOLS: ForemanTool[] = [
  {
    type: 'function',
    name: 'briefing',
    description: 'Returns a digest of the current factory floor: each active agent with label, kind, elapsed time, status, current task (what they were asked to do), recent files touched, recent tools called, and any cloud dispatches. Call this first for any question about overall state.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'focus',
    description: 'Returns deep detail on one agent by its label or kind (e.g. "claude", "Philip Music"). Use when the user asks about a specific agent. Includes full task description, all recent files and tools, elapsed time, status.',
    parameters: {
      type: 'object',
      properties: {
        who: { type: 'string', description: 'Agent label, kind (claude/codex/gemini), or session id prefix.' },
      },
      required: ['who'],
    },
  },
];

// POST to OpenAI to mint a short-lived client token for the Realtime API.
// The returned client_secret is scoped to a single session and expires in ~1 min;
// the webview uses it as a bearer token for the WebRTC SDP exchange.
export async function mintEphemeralKey(apiKey: string): Promise<{ clientSecret: string; expiresAt: number }> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OpenAI API key not configured. Set agents.openaiApiKey in Settings.');
  }

  const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: FOREMAN_MODEL,
      voice: FOREMAN_VOICE,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI session mint failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    client_secret?: { value?: string; expires_at?: number };
  };
  const value = data.client_secret?.value;
  const expiresAt = data.client_secret?.expires_at ?? 0;
  if (!value) {
    throw new Error('OpenAI returned no client_secret');
  }
  return { clientSecret: value, expiresAt };
}

// Walk the live terminals across all known agent types, pull rich per-agent
// details (task, recent files, recent tools), and query the cloud dispatch
// list. Returns a single digest the model can narrate in one sentence.
export async function computeBriefing(workspacePath?: string): Promise<ForemanDigest> {
  const [localAgents, cloud] = await Promise.all([
    collectLocalAgents(workspacePath),
    collectCloudTasks(),
  ]);
  return buildForemanDigest(localAgents, cloud);
}

async function collectLocalAgents(workspacePath?: string): Promise<ForemanTerminal[]> {
  const kinds = ['claude', 'codex', 'gemini', 'opencode', 'cursor'];
  const all: ForemanTerminal[] = [];

  for (const kind of kinds) {
    const details = await terminals.getTerminalsByAgentType(kind, workspacePath);
    for (const d of details) {
      all.push({
        name: prefixExpand(kind),
        label: d.label ?? d.autoLabel ?? null,
        sessionId: d.sessionId ?? null,
        startedAtMs: d.firstMessageTimestamp ? Date.parse(d.firstMessageTimestamp) : d.createdAt,
        lastActivityMs: d.lastActivityTimestamp ? Date.parse(d.lastActivityTimestamp) : d.createdAt,
        lastTool: d.currentActivity ?? null,
        status: mapStatus(d.status),
        task: d.firstUserMessage ?? null,
        recentFiles: d.recentFiles ?? [],
        recentTools: d.recentTools ?? [],
        lastFilePath: d.lastFilePath ?? null,
        filesEdited: d.quickSummary?.filesEdited ?? 0,
        toolCalls: d.quickSummary?.toolCalls ?? 0,
      });
    }
  }
  return all;
}

// Pulls cloud tasks via the agents-cli. Cheap, fast, no auth to manage here -
// agents-cli already owns credentials. 2-second timeout so the briefing tool
// never blocks the voice turn for long.
async function collectCloudTasks(): Promise<ForemanCloudTask[]> {
  try {
    const { stdout } = await execAsync('agents cloud list --json', { timeout: 2_000 });
    const raw = JSON.parse(stdout);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r: any): ForemanCloudTask => ({
        id: String(r.id ?? ''),
        provider: String(r.provider ?? ''),
        agent: String(r.agent ?? ''),
        status: String(r.status ?? ''),
        prompt: String(r.prompt ?? '').slice(0, 200),
        repo: r.repo ? String(r.repo) : null,
        updated: String(r.updatedAt ?? r.createdAt ?? ''),
      }))
      .filter((r) => r.status === 'running' || r.status === 'needs_review' || r.status === 'completed')
      .slice(0, 10);
  } catch {
    return [];
  }
}

// Deep detail for one agent. Match by label (case-insensitive substring),
// kind, or session id prefix. Returns null if no match so the model can say
// "no agent like that".
export async function computeFocus(who: string, workspacePath?: string): Promise<unknown> {
  const digest = await computeBriefing(workspacePath);
  const q = (who ?? '').trim().toLowerCase();
  if (!q) return { error: 'no query' };

  const match = digest.agents.find((a) => {
    if (a.label && a.label.toLowerCase().includes(q)) return true;
    if (a.kind.toLowerCase() === q) return true;
    if (a.id.toLowerCase().startsWith(q)) return true;
    return false;
  });

  if (!match) {
    return { error: `no agent matching "${who}"`, available: digest.agents.map((a) => a.label ?? a.kind) };
  }

  return {
    kind: match.kind,
    label: match.label,
    elapsed: match.elapsed,
    status: match.status,
    task: match.task,
    last_tool: match.last_tool,
    last_file: match.last_file,
    recent_files: match.recent_files,
    recent_tools: match.recent_tools,
    files_edited: match.files_edited,
    tool_calls: match.tool_calls,
  };
}

function prefixExpand(kind: string): string {
  switch (kind) {
    case 'claude': return 'Claude';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'opencode': return 'OpenCode';
    case 'cursor': return 'Cursor';
    default: return kind;
  }
}

function mapStatus(
  s: 'running' | 'completed' | 'idle' | undefined
): 'idle' | 'working' | 'waiting' | 'blocked' | null {
  if (s === 'running') return 'working';
  if (s === 'idle' || s === 'completed') return 'idle';
  return null;
}

// Convenience: read the OpenAI key from settings exactly once. Matches the
// existing `agents.openaiApiKey` setting used for commit message generation.
export function getOpenAIApiKey(): string {
  return vscode.workspace.getConfiguration('agents').get<string>('openaiApiKey', '').trim();
}

// Tool dispatch: runs a named Foreman tool and returns a JSON-serializable
// result the webview can forward back to the model as function_call_output.
export async function runForemanTool(
  name: string,
  args: unknown,
  workspacePath?: string
): Promise<unknown> {
  switch (name) {
    case 'briefing':
      return computeBriefing(workspacePath);
    case 'focus': {
      const who = (args && typeof args === 'object' && 'who' in args)
        ? String((args as { who?: unknown }).who ?? '')
        : '';
      return computeFocus(who, workspacePath);
    }
    default:
      throw new Error(`Unknown Foreman tool: ${name}`);
  }
}

// Session config sent on connect: instructions + tool schema + voice.
// Realtime API reads this from the first `session.update` event on the data channel.
export function buildSessionUpdate() {
  return {
    type: 'session.update',
    session: {
      modalities: ['audio', 'text'],
      voice: FOREMAN_VOICE,
      instructions: FOREMAN_SYSTEM_PROMPT,
      input_audio_transcription: { model: 'whisper-1' },
      tools: FOREMAN_TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
    },
  };
}

// Quiet prefix used in realtime instructions to remind the model to be tight.
// Exposed as a separate export so the webview can optionally override.
export { prefixToAgentType };
