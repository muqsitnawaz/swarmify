// Foreman: voice coordinator for the factory floor.
//
// Extension host responsibilities:
//   1. Mint an ephemeral OpenAI Realtime session using the user's API key,
//      so the webview never sees the long-lived key.
//   2. Compute the live floor digest on demand and return it to the webview,
//      which forwards it to the realtime model as a tool result.

import * as vscode from 'vscode';
import {
  buildForemanDigest,
  ForemanDigest,
  ForemanTerminal,
  ForemanCloudTask,
  ForemanTeamRollup,
} from '../core/foreman.digest';
import { prefixToAgentType } from '../core/utils';
import { UnifiedTask, CycleInfo } from '../core/tasks';
import { summarizeCycle } from '../core/foreman.cycle';
import {
  listLocalSessions,
  readSessionEvents,
  listCloudTasks,
  listTeams,
  getLastSourcesError,
  SessionLite,
  SessionEvent,
  CloudTaskLite,
  TeamLite,
} from './foreman.sources';
import { readLiveTerminals, LiveTerminal } from './foreman.registry';

export const FOREMAN_MODEL = 'gpt-realtime';
export const FOREMAN_VOICE = 'cedar';

export const FOREMAN_SYSTEM_PROMPT = `You are Foreman, the voice coordinator of a factory of AI coding agents across
local IDE sessions, background teams, and cloud dispatches.

Persona: dry, brief. Clipped sentences. No filler. No adjectives without facts.
Banned words: "grinding", "humming", "going well", "on track", "all good".
If you have no specifics, say so: "nothing concrete yet".

Tool usage and routing (pick the RIGHT tool, do not default to briefing):
- briefing: live floor state - which agents are running, on what, for how long.
  Use for "what's running", "who's working on what", "sitrep", "floor status".
- focus(who): deep detail on ONE agent - current file, current tool, last bash.
  Use when the user names a specific agent, project, label, or session prefix.
- cycle: Linear sprint status - cycle name, days left, todo/in_progress/done counts,
  top pending tickets (RUSH-xxx etc).
  Use for "how many tasks left", "what's next up", "this cycle/sprint",
  "which tickets", "RUSH-<number>", "Linear", "backlog", "priorities".
- task_details(id): full title, description, priority, status, assignee, labels,
  and resolved repo for ONE ticket.
  Use when the user asks "what is RUSH-xxx", "tell me about RUSH-xxx",
  "read me the description", "what does that ticket say".
- dispatch(id, agent?, target?, repo?): send a ticket to a coding agent.
  Defaults: agent="claude", target="cloud". Only pass repo if the user
  explicitly names one (e.g. "dispatch RUSH-557 to agents-cli"); otherwise
  leave it out and let the ticket's repo: label resolve it.
  Use for "dispatch", "send to cloud", "run this", "kick off", "start work on".
Briefing has NO ticket data. Do not call briefing for cycle/ticket questions.
Do not call focus speculatively; wait for a specific question.
Confirm before dispatching if the user was vague (e.g. "the top one") -
read back the ticket id and title, then dispatch on assent.

Answering rules:
- Lead with the SPECIFIC: the task (topic), the file, the tool, the elapsed time.
- Good: "Claude is 12 minutes into auth refactor on agents repo, last edited jwt.ts."
- Bad: "Claude's been grinding 12 minutes, humming along."
- Prefer labels when present ("Philip Music"), fall back to kind ("claude, codex").
- If an agent is open in the IDE vs. just a local session, call it out only if
  relevant ("the one you have open" vs "the background Codex").
- Cloud dispatches run remotely; say "on Rush Cloud" or "on Codex Cloud" when
  referencing them so the user knows they're not on the laptop.
- Teams are DAG-coordinated runs; say "team <name>, 2 running, 1 pending".
- Never narrate the UI or offer to click things - that's the user's hands.

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
    description: 'Fast digest of the factory floor: recent local sessions (Claude/Codex/Gemini/OpenCode/OpenClaw from the last 2h), cloud dispatches (Rush/Codex/Factory running remotely), and active team DAGs. Each session has kind, label, topic (task), project, elapsed time, and open_in_ide flag. Call first for any overview question.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'focus',
    description: 'Deep detail on one agent. Reads the session event tail to return current file being edited, current tool, last bash command, recent files, recent tools, since_last_activity, git_branch, token_count. Use when the user asks about a specific agent/task/project.',
    parameters: {
      type: 'object',
      properties: {
        who: { type: 'string', description: 'Agent label ("Philip Music"), topic keyword, kind (claude/codex/gemini/opencode/openclaw), or 8-char session id prefix.' },
      },
      required: ['who'],
    },
  },
  {
    type: 'function',
    name: 'cycle',
    description: 'Linear sprint/cycle status: cycle name, days left, counts of todo/in_progress/done tickets, urgent/high counts, and the top 5 pending tickets (id, title, priority, status). Use for "how many tasks left this cycle", "what\'s next up", "which tickets", or any question about RUSH-xxx / Linear / sprint / backlog.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'task_details',
    description: 'Full detail on ONE ticket: title, description, priority, status, assignee, labels, resolved repo. Use when the user asks "what is RUSH-xxx", "read me RUSH-xxx", "tell me about that ticket", or before dispatching to confirm the target.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ticket identifier, e.g. "RUSH-557". Case-insensitive.' },
      },
      required: ['id'],
    },
  },
  {
    type: 'function',
    name: 'dispatch',
    description: 'Send a ticket to a coding agent. Defaults: agent="claude", target="cloud". Resolves target repo from the ticket\'s repo:<name> label unless the caller overrides with repo. Returns ok+message describing what was dispatched or why it could not be.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ticket identifier, e.g. "RUSH-557".' },
        agent: { type: 'string', description: 'claude | codex | gemini | cursor (default: claude).' },
        target: { type: 'string', description: '"cloud" or "local" (default: cloud).' },
        repo: { type: 'string', description: 'Optional repo override, e.g. "agents-cli". Only set when the user explicitly names a repo; otherwise let the ticket\'s repo: label resolve it.' },
      },
      required: ['id'],
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

// Two canonical sources for "what's on the factory floor":
//   1. Live terminals across EVERY IDE window (from the shared registry) -
//      authoritative for "actually running right now"
//   2. Local session metadata from agents-cli (topic, project, gitBranch,
//      tokenCount) - enrichment only, agents-cli doesn't know pid liveness
// Plus two auxiliary sources: cloud dispatches and team DAGs.
export async function computeBriefing(_workspacePath?: string): Promise<ForemanDigest> {
  const live = readLiveTerminals();
  const liveIds = new Set(live.map((t) => t.sessionId));

  const [sessions, cloud, teams] = await Promise.all([
    listLocalSessions({ since: '2h', limit: 30, all: true }),
    listCloudTasks(),
    listTeams(),
  ]);

  // Merge: every live terminal becomes an agent. Enrich with session metadata
  // if agents-cli has it (matched by sessionId).
  const sessionsById = new Map(sessions.map((s) => [s.id, s] as const));
  const agents: ForemanTerminal[] = live.map((t) =>
    liveTerminalToForemanTerminal(t, sessionsById.get(t.sessionId))
  );
  // Also include recently-active sessions that AREN'T currently open as live
  // terminals - they may have been closed in the last 2h and are worth
  // mentioning as "just finished" context.
  for (const s of sessions) {
    if (liveIds.has(s.id)) continue;
    agents.push(sessionToForemanTerminal(s, false));
  }

  const cloudDigest: ForemanCloudTask[] = cloud
    .filter((c) => c.status === 'running' || c.status === 'needs_review' || c.status === 'completed')
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      provider: c.provider,
      agent: c.agent,
      status: c.status,
      prompt: c.prompt,
      repo: c.repo ?? null,
      updated: c.updatedAt ?? '',
    }));

  const teamDigest: ForemanTeamRollup[] = teams.slice(0, 10).map((t) => ({
    name: t.task_name,
    running: t.running,
    pending: t.pending,
    completed: t.completed,
    failed: t.failed,
  }));

  const digest = buildForemanDigest(agents, cloudDigest, teamDigest);
  // If every source came back empty AND the sources layer logged an error,
  // surface it so the foreman can narrate the real problem instead of saying
  // "floor is empty" when the floor is actually unreachable.
  if (agents.length === 0 && cloudDigest.length === 0 && teamDigest.length === 0) {
    const err = getLastSourcesError();
    if (err) {
      digest.concerns.unshift(`agents-cli unreachable: ${err}`);
    }
  }
  return digest;
}

function sessionToForemanTerminal(s: SessionLite, openInIde: boolean): ForemanTerminal {
  const startedAt = s.timestamp ? Date.parse(s.timestamp) : null;
  return {
    name: expand(s.agent),
    kind: s.agent,
    label: s.label ?? null,
    sessionId: s.id,
    project: s.project ?? null,
    openInIde,
    startedAtMs: startedAt,
    lastActivityMs: startedAt,
    lastTool: null,
    status: null,
    task: s.topic ?? null,
    recentFiles: [],
    recentTools: [],
    filesEdited: 0,
    toolCalls: 0,
  };
}

// Primary path: a live VS Code terminal is definitely running. If agents-cli
// has session metadata for its sessionId, merge it in for project/topic/etc.
function liveTerminalToForemanTerminal(t: LiveTerminal, s?: SessionLite): ForemanTerminal {
  const startedAt = s?.timestamp ? Date.parse(s.timestamp) : t.startedAtMs;
  return {
    name: expand(t.kind),
    kind: t.kind,
    label: t.label ?? s?.label ?? null,
    sessionId: t.sessionId,
    project: s?.project ?? (t.cwd ? t.cwd.split('/').pop() ?? null : null),
    openInIde: true,
    startedAtMs: startedAt,
    lastActivityMs: startedAt,
    lastTool: null,
    status: 'working',     // a live pid means working by definition
    task: s?.topic ?? null,
    recentFiles: [],
    recentTools: [],
    filesEdited: 0,
    toolCalls: 0,
  };
}

function expand(kind: string): string {
  switch (kind) {
    case 'claude': return 'Claude';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'opencode': return 'OpenCode';
    case 'openclaw': return 'OpenClaw';
    default: return kind;
  }
}

// Deep detail for one agent. Matches by label substring, kind, or session id
// prefix. Reads the normalized event tail from agents-cli for the truly live
// bits (last tool, last file, recent tool calls) that the lean briefing skips.
export async function computeFocus(who: string, _workspacePath?: string): Promise<unknown> {
  const q = (who ?? '').trim().toLowerCase();
  if (!q) return { error: 'no query' };

  const local = await listLocalSessions({ since: '6h', limit: 60, all: true });
  const match = local.find((s) => {
    if (s.label && s.label.toLowerCase().includes(q)) return true;
    if (s.topic && s.topic.toLowerCase().includes(q)) return true;
    if (s.agent.toLowerCase() === q) return true;
    if (s.id.toLowerCase().startsWith(q)) return true;
    if (s.shortId && s.shortId.toLowerCase().startsWith(q)) return true;
    return false;
  });

  if (!match) {
    return {
      error: `no agent matching "${who}"`,
      available: local.slice(0, 10).map((s) => s.label ?? s.topic ?? `${s.agent} ${s.shortId}`),
    };
  }

  const events = await readSessionEvents(match.id, 30);
  const tail = summarizeTail(events);
  const openIds = new Set(readLiveTerminals().map((t) => t.sessionId));
  const startedMs = match.timestamp ? Date.parse(match.timestamp) : Date.now();
  const lastActivityMs = tail.lastEventAtMs ?? startedMs;

  return {
    kind: match.agent,
    label: match.label ?? null,
    project: match.project ?? null,
    git_branch: match.gitBranch ?? null,
    open_in_ide: openIds.has(match.id),
    elapsed: humanElapsedFromMs(Date.now() - startedMs),
    since_last_activity: humanElapsedFromMs(Date.now() - lastActivityMs),
    status: tail.status,
    task: match.topic ?? null,
    token_count: match.tokenCount ?? null,
    last_tool: tail.lastTool,
    last_file: tail.lastFile,
    last_bash: tail.lastBash,
    recent_tools: tail.recentTools,
    recent_files: tail.recentFiles,
    files_edited: tail.filesEdited,
    tool_calls: tail.toolCalls,
  };
}

interface TailSummary {
  lastEventAtMs: number | null;
  status: 'idle' | 'working' | 'waiting' | 'blocked';
  lastTool: string | null;
  lastFile: string | null;
  lastBash: string | null;
  recentTools: string[];
  recentFiles: string[];
  filesEdited: number;
  toolCalls: number;
}

function summarizeTail(events: SessionEvent[]): TailSummary {
  const toolCallNames: string[] = [];
  const filesSeen: string[] = [];
  const filesEditedSet = new Set<string>();
  let lastTool: string | null = null;
  let lastFile: string | null = null;
  let lastBash: string | null = null;
  let lastEventAtMs: number | null = null;

  for (const e of events) {
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;
    if (ts && (!lastEventAtMs || ts > lastEventAtMs)) lastEventAtMs = ts;

    if (e.type === 'tool_use') {
      toolCallNames.push(e.tool ?? '');
      if (e.tool) lastTool = e.tool;
      if (e.path) {
        lastFile = e.path;
        filesSeen.push(e.path);
      }
      const isEdit = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit';
      if (isEdit && e.path) filesEditedSet.add(e.path);
      if (e.tool === 'Bash' && e.args && typeof (e.args as { command?: unknown }).command === 'string') {
        lastBash = String((e.args as { command: string }).command).slice(0, 200);
      }
    }
  }

  const status: TailSummary['status'] =
    !lastEventAtMs ? 'idle'
    : Date.now() - lastEventAtMs < 60_000 ? 'working'
    : Date.now() - lastEventAtMs < 10 * 60_000 ? 'waiting'
    : 'idle';

  return {
    lastEventAtMs,
    status,
    lastTool,
    lastFile,
    lastBash,
    recentTools: dedup(toolCallNames).slice(-5),
    recentFiles: dedup(filesSeen).slice(-5),
    filesEdited: filesEditedSet.size,
    toolCalls: toolCallNames.length,
  };
}

function dedup<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function humanElapsedFromMs(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// Convenience: read the OpenAI key from settings exactly once. Matches the
// existing `agents.openaiApiKey` setting used for commit message generation.
export function getOpenAIApiKey(): string {
  return vscode.workspace.getConfiguration('agents').get<string>('openaiApiKey', '').trim();
}

// Callbacks the caller supplies so foreman.vscode.ts doesn't have to import
// from settings.vscode / tasks.vscode (which would create a cycle through
// foreman.audio -> foreman.vscode).
export interface ForemanTaskDetails {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
  assignee: string | null;
  labels: string[];
  source: string;
  resolved_repo: string | null;
}

export interface ForemanDispatchOpts {
  id: string;
  agent?: string;
  target?: 'cloud' | 'local';
  repo?: string;
}

export interface ForemanDispatchResult {
  ok: boolean;
  message: string;
  dispatched?: { id: string; agent: string; target: string; repos: string[] };
}

export interface ForemanToolDeps {
  fetchCycleTasks?: () => Promise<{ tasks: UnifiedTask[]; cycleInfo: CycleInfo | null }>;
  fetchTaskDetails?: (id: string) => Promise<ForemanTaskDetails | null>;
  dispatchTask?: (opts: ForemanDispatchOpts) => Promise<ForemanDispatchResult>;
}

// Tool dispatch: runs a named Foreman tool and returns a JSON-serializable
// result the webview can forward back to the model as function_call_output.
export async function runForemanTool(
  name: string,
  args: unknown,
  workspacePath?: string,
  deps?: ForemanToolDeps
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
    case 'cycle': {
      if (!deps?.fetchCycleTasks) {
        return { error: 'cycle tool unavailable: no task source wired' };
      }
      const { tasks, cycleInfo } = await deps.fetchCycleTasks();
      return summarizeCycle(tasks, cycleInfo);
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
