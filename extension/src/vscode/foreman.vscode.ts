// Foreman: voice coordinator for the factory floor.
//
// Extension host responsibilities:
//   1. Mint an ephemeral OpenAI Realtime session using the user's API key,
//      so the webview never sees the long-lived key.
//   2. Compute the live floor digest on demand and return it to the webview,
//      which forwards it to the realtime model as a tool result.

import * as vscode from 'vscode';
import * as terminals from './terminals.vscode';
import { buildForemanDigest, ForemanDigest, ForemanTerminal } from '../core/foreman.digest';
import { prefixToAgentType } from '../core/utils';

export const FOREMAN_MODEL = 'gpt-realtime';
export const FOREMAN_VOICE = 'cedar';

export const FOREMAN_SYSTEM_PROMPT = `You are Foreman, the voice coordinator of a factory of AI coding agents.

Persona: dry, brief, Chicago-foreman energy. Sentences clip. No filler. Opinions when asked.

When the user speaks, call the briefing tool to know the state before answering.
Lead with the unexpected thing, then color. Never recite what's obvious.
Never offer to open or click things for the user - that's what their hands are for.
Your job is to bring synthesized information, not operate the UI.

If nothing is new since the last check, say so and stop.
Keep replies under 25 words unless the user asks to expand.`.trim();

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
    description: 'Returns a digest of the current state of the factory floor: active agents, how long each has been running, who is blocked. Call this before answering any question about the floor.',
    parameters: { type: 'object', properties: {}, required: [] },
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

// Walk the live terminals across all known agent types and project them onto
// the shape the digest builder expects. Ignores non-agent terminals naturally.
export async function computeBriefing(workspacePath?: string): Promise<ForemanDigest> {
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
      });
    }
  }

  return buildForemanDigest(all);
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
  _args: unknown,
  workspacePath?: string
): Promise<unknown> {
  switch (name) {
    case 'briefing':
      return computeBriefing(workspacePath);
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
