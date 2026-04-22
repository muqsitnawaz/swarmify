import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  AgentManager,
  checkAllClis,
  ensureGeminiPlanMode,
  handleSpawn,
  handleStatus,
  handleStop,
  handleTasks,
  readConfig,
  type AgentConfig,
  type AgentType,
  type EffortLevel,
} from '@phnx-labs/agents-cli/teams';
import { resolveLedger } from './ledger/index.js';
import { spawnCloudAgent, isCloudSupported, extractPrUrl } from './cloud.js';
import { isDangerousPath, getRalphConfig, buildRalphPrompt } from './ralph.js';
import {
  buildVersionNotice,
  detectClientFromName,
  getCurrentVersion,
  initVersionCheck,
  setDetectedClient,
} from './version.js';

let agentConfigs: Record<AgentType, AgentConfig> | null = null;
const manager = new AgentManager(50, 10, null, null, null, 7, agentConfigs);

const TOOL_NAMES = {
  spawn: 'Spawn',
  status: 'Status',
  stop: 'Stop',
  tasks: 'Tasks',
  ledgerRead: 'LedgerRead',
  ledgerRecent: 'LedgerRecent',
  ledgerSearch: 'LedgerSearch',
  ledgerNote: 'LedgerNote',
} as const;

export function getParentSessionIdFromEnv(): string | null {
  const raw = process.env.AGENT_SESSION_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function getWorkspaceFromEnv(): string | null {
  const raw = process.env.AGENT_WORKSPACE_DIR;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

// Enabled agents (initialized at startup)
let enabledAgents: AgentType[] = [];

// Agent descriptions for dynamic tool description
const agentDescriptions: Record<AgentType, string> = {
  cursor: 'Debugging, bug fixes, tracing through codebases.',
  codex: 'Fast, cheap. Self-contained features, clean implementations.',
  claude: 'Maximum capability, research, exploration.',
  gemini: 'Complex multi-system features, architectural changes.',
  opencode: 'Open source coding agent. Provider-agnostic, TUI-focused.',
};

function withVersionNotice(description: string): string {
  return description + buildVersionNotice();
}

// Accept either the legacy vocab (fast|default|detailed) or the current one
// (low|medium|high|xhigh|max|auto). Legacy values are mapped so cached agent
// instructions that hardcode `effort: "default"` continue to work.
const LEGACY_EFFORT_MAP: Record<string, EffortLevel> = {
  fast: 'low',
  default: 'medium',
  detailed: 'high',
};

function resolveEffort(input: unknown): EffortLevel {
  if (typeof input !== 'string') return 'medium';
  const lower = input.trim().toLowerCase();
  if (LEGACY_EFFORT_MAP[lower]) return LEGACY_EFFORT_MAP[lower];
  const valid: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
  if (valid.includes(lower as EffortLevel)) return lower as EffortLevel;
  return 'medium';
}

function buildSpawnDescription(): string {
  const agentList = enabledAgents
    .map((agent, i) => `${i + 1}. ${agent} - ${agentDescriptions[agent]}`)
    .join('\n');

  return `Spawn an AI coding agent to work on a task.

IMPORTANT: Avoid spawning the same agent type as yourself. If you are Claude, prefer cursor/codex/gemini instead.

Only installed agent CLIs are listed below.

Task names can be reused to group multiple agents under the same task.

MODE PARAMETER (required for writes):
- mode='edit' - Agent CAN modify files (use this for implementation tasks)
- mode='plan' - Agent is READ-ONLY (default, use for research/exploration)
- mode='cloud' - Run agent on cloud infrastructure (Claude remote, Codex cloud). Agent creates a PR when done. Supported: claude, codex. NOT supported: gemini, cursor, opencode.
- mode='ralph' - DEPRECATED (removed in 0.4.0). Autonomous execution through RALPH.md. Emits a warning. Prefer a normal spawn with a task-list prompt.

CLOUD MODE: Runs the agent on the platform's cloud infrastructure instead of locally. Enables long-running tasks that survive laptop sleep/shutdown. The agent automatically creates a PR with its changes when done. Poll with Status to track progress and get the PR URL.

EFFORT PARAMETER: 'low' (cheapest/fastest), 'medium' (default), 'high', 'xhigh', 'max', 'auto'. Legacy values 'fast'/'default'/'detailed' are still accepted and map to 'low'/'medium'/'high'.

WAIT BEFORE CHECKING STATUS: After spawning all agents for this task, sleep for at least 2 minutes before checking status. Use: Bash(sleep 120 && echo "Done waiting on Swarm agents. Let's check status") timeout: 2m 30s

Do NOT immediately call Status - it wastes tokens and returns nothing useful.

Agent selection (in order of preference):
${agentList}

Choose automatically based on task requirements - don't ask the user.`;
}

const server = new Server(
  {
    name: 'Swarm',
    version: getCurrentVersion(),
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Capture client info for version warnings
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  if (request.params?.clientInfo?.name) {
    const client = detectClientFromName(request.params.clientInfo.name);
    setDetectedClient(client);
  }
  // Return standard initialize response
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'Swarm',
      version: getCurrentVersion(),
    },
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: TOOL_NAMES.spawn,
        description: withVersionNotice(buildSpawnDescription()),
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name to group related agents (e.g., "auth-feature", "bug-fix-123")',
            },
            agent_type: {
              type: 'string',
              enum: enabledAgents,
              description: 'Type of agent to spawn',
            },
            prompt: {
              type: 'string',
              description: 'The task/prompt for the agent',
            },
            cwd: {
              type: 'string',
              description: 'Working directory for the agent (optional)',
            },
            mode: {
              type: 'string',
              enum: ['plan', 'edit', 'cloud', 'ralph'],
              description: "'edit' allows file modifications, 'plan' is read-only (default), 'cloud' runs on cloud infrastructure (claude/codex only), 'ralph' is DEPRECATED (removed in 0.4.0).",
            },
            effort: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
              description: "Effort level. 'medium' is default. Legacy values 'fast'/'default'/'detailed' are accepted for back-compat.",
            },
          },
          required: ['task_name', 'agent_type', 'prompt'],
        },
      },
      {
        name: TOOL_NAMES.status,
        description: withVersionNotice(`Get status of all agents in a task with full details including:
- Files created/modified/read/deleted (full paths)
- All bash commands executed
- Last 3 assistant messages

Use this for polling agent progress.

CURSOR SUPPORT: Send 'since' parameter (ISO timestamp from previous response's 'cursor' field) to get only NEW data since that time. This avoids duplicate data on repeated polls.`),
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name to get status for',
            },
            parent_session_id: {
              type: 'string',
              description: 'Filter agents by the session that spawned them (alternative to task_name)',
            },
            filter: {
              type: 'string',
              enum: ['running', 'completed', 'failed', 'stopped', 'all'],
              description: "Filter agents by status. Defaults to 'all'.",
            },
            since: {
              type: 'string',
              description: 'Optional ISO timestamp - return only events after this time. Use cursor from previous response to get delta updates.',
            },
          },
          required: ['task_name'],
        },
      },
      {
        name: TOOL_NAMES.stop,
        description: withVersionNotice(`Stop agents. Two modes:
- Stop(task_name): Stop ALL agents in the task
- Stop(task_name, agent_id): Stop ONE specific agent`),
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name',
            },
            agent_id: {
              type: 'string',
              description: 'Optional: specific agent ID to stop (omit to stop all in task)',
            },
          },
          required: ['task_name'],
        },
      },
      {
        name: TOOL_NAMES.tasks,
        description: withVersionNotice(`List all tasks with their agents and activity details.

Returns tasks sorted by most recent activity, with full agent details including:
- Files created/modified/read/deleted
- Bash commands executed
- Last messages from each agent
- Status and duration`),
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of tasks to return (optional, defaults to 10)',
            },
          },
          required: [],
        },
      },
      {
        name: TOOL_NAMES.ledgerRead,
        description: withVersionNotice(`Read a task's artifacts from the Team Ledger.

The Ledger is a team-scoped durable store where every teammate's diff, test output, notes, session transcript, and filed bugs live under one task_id. Use this to load another teammate's output when you depend on their work (e.g., implementer reads the planner's team.md, tester reads the implementer's diff).

Omit 'kind' to get every artifact for the task, or pass one of: diff, test-output, notes, session, bug.`),
        inputSchema: {
          type: 'object',
          properties: {
            team_id: { type: 'string', description: 'Team name (same as task_name in Spawn)' },
            task_id: { type: 'string', description: "Teammate's agent_id (UUID) whose work you want to read" },
            kind: {
              type: 'string',
              enum: ['diff', 'test-output', 'notes', 'session', 'bug'],
              description: 'Optional artifact kind. Omit for all artifacts.',
            },
          },
          required: ['team_id', 'task_id'],
        },
      },
      {
        name: TOOL_NAMES.ledgerRecent,
        description: withVersionNotice(`List the last N completed tasks in the Ledger for a team, newest first.

Use this when you've just started a task and want to catch up on what other teammates have already done.`),
        inputSchema: {
          type: 'object',
          properties: {
            team_id: { type: 'string', description: 'Team name' },
            limit: { type: 'number', description: 'How many recent tasks (default 5)' },
          },
          required: ['team_id'],
        },
      },
      {
        name: TOOL_NAMES.ledgerSearch,
        description: withVersionNotice(`Substring search across the Ledger for a team (sessions, notes, bugs, narrative).

Case-insensitive. Returns hits with file path + line number so you can call LedgerRead for full context.`),
        inputSchema: {
          type: 'object',
          properties: {
            team_id: { type: 'string' },
            query: { type: 'string', description: 'Substring to find' },
            limit: { type: 'number', description: 'Max hits to return (default 50)' },
          },
          required: ['team_id', 'query'],
        },
      },
      {
        name: TOOL_NAMES.ledgerNote,
        description: withVersionNotice(`Append a timestamped note to your task's notes.md in the Ledger.

Use this to record what you tried, what failed, and why — so later teammates (bugfix, review) don't re-learn the same dead ends.`),
        inputSchema: {
          type: 'object',
          properties: {
            team_id: { type: 'string' },
            task_id: { type: 'string', description: 'Your own agent_id' },
            teammate: { type: 'string', description: 'Your teammate name (for attribution)' },
            text: { type: 'string', description: 'The note body' },
          },
          required: ['team_id', 'task_id', 'teammate', 'text'],
        },
      },
    ],
  };
});

async function spawnRalphAgent(
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  effort: EffortLevel,
  parentSessionId: string | null,
  workspaceDir: string | null
): Promise<{ task_name: string; agent_id: string; agent_type: string; status: string; started_at: string }> {
  process.stderr.write(
    '[agents-mcp] WARNING: ralph mode is deprecated and will be removed in 0.4.0. ' +
    "Prefer a normal spawn with a task-list prompt, or use agents-cli's oracle/supervisor primitives.\n"
  );

  if (!cwd) {
    throw new Error('Ralph mode requires a cwd parameter');
  }

  const resolvedCwd = path.resolve(cwd);
  if (isDangerousPath(resolvedCwd)) {
    throw new Error('Ralph mode in home or system directory is risky. Use a project directory.');
  }

  const ralphConfig = getRalphConfig();
  const ralphFilePath = path.join(resolvedCwd, ralphConfig.ralphFile);
  try {
    await fs.access(ralphFilePath);
  } catch {
    throw new Error(`${ralphConfig.ralphFile} not found in ${resolvedCwd}. Create it first.`);
  }

  const ralphPrompt = buildRalphPrompt(prompt, ralphFilePath);

  // Ralph runs with full write perms; map to 'edit' since the Mode union no
  // longer carries a dedicated 'ralph' value.
  const agent = await manager.spawn(
    taskName,
    agentType,
    ralphPrompt,
    cwd,
    'edit',
    effort,
    parentSessionId,
    workspaceDir
  );

  console.error(`[ralph] Spawned ${agentType} agent ${agent.agentId} for autonomous execution`);

  return {
    task_name: taskName,
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    started_at: agent.startedAt.toISOString(),
  };
}

async function spawnCloudTeammate(
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  effort: EffortLevel,
  parentSessionId: string | null,
  workspaceDir: string | null
): Promise<{ task_name: string; agent_id: string; agent_type: string; status: string; started_at: string }> {
  if (!isCloudSupported(agentType)) {
    throw new Error(
      `Cloud mode is not supported for ${agentType}. Supported agents: claude, codex.`
    );
  }

  const config = await readConfig();
  const agentConfig = config.agentConfigs[agentType];
  const resolvedModel = agentConfig?.model ?? '';

  const agent = await spawnCloudAgent(
    taskName,
    agentType,
    prompt,
    cwd,
    resolvedModel,
    parentSessionId,
    workspaceDir
  );

  manager.registerAgent(agent);

  console.error(`[cloud] Spawned ${agentType} cloud agent ${agent.agentId} for task "${taskName}"`);

  return {
    task_name: taskName,
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    started_at: agent.startedAt.toISOString(),
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const normalizedName = name.toLowerCase();

  try {
    let result: any;

    if (normalizedName === 'spawn') {
      if (!args) {
        throw new Error('Missing arguments for spawn');
      }
      const parentSessionId = getParentSessionIdFromEnv();
      const workspaceDir = getWorkspaceFromEnv();
      const modeArg = (args.mode as string | null) || null;
      const effort = resolveEffort(args.effort);

      if (modeArg === 'ralph') {
        result = await spawnRalphAgent(
          args.task_name as string,
          args.agent_type as AgentType,
          args.prompt as string,
          (args.cwd as string) || null,
          effort,
          parentSessionId,
          workspaceDir
        );
      } else if (modeArg === 'cloud') {
        result = await spawnCloudTeammate(
          args.task_name as string,
          args.agent_type as AgentType,
          args.prompt as string,
          (args.cwd as string) || null,
          effort,
          parentSessionId,
          workspaceDir
        );
      } else {
        result = await handleSpawn(
          manager,
          args.task_name as string,
          args.agent_type as AgentType,
          args.prompt as string,
          (args.cwd as string) || null,
          modeArg,
          effort,
          parentSessionId,
          workspaceDir
        );
      }
    } else if (normalizedName === 'status') {
      if (!args) {
        throw new Error('Missing arguments for status');
      }
      result = await handleStatus(
        manager,
        (args.task_name as string | undefined) || null,
        args.filter as string | undefined,
        args.since as string | undefined,
        (args.parent_session_id as string | undefined) || null
      );

      // Backfill PR URLs for any cloud agents that just completed
      const resultAny = result as any;
      if (resultAny && Array.isArray(resultAny.agents)) {
        for (const a of resultAny.agents) {
          if (a.mode === 'cloud' && !a.pr_url && Array.isArray(a._events)) {
            const prUrl = extractPrUrl(a._events);
            if (prUrl) a.pr_url = prUrl;
          }
        }
      }
    } else if (normalizedName === 'stop') {
      if (!args) {
        throw new Error('Missing arguments for stop');
      }
      result = await handleStop(
        manager,
        args.task_name as string,
        args.agent_id as string | undefined
      );
    } else if (normalizedName === 'tasks') {
      const limit = args?.limit as number | undefined;
      result = await handleTasks(manager, limit || 10);
    } else if (normalizedName === 'ledgerread') {
      if (!args) throw new Error('Missing arguments for LedgerRead');
      const ledger = resolveLedger();
      result = await ledger.read(
        args.team_id as string,
        args.task_id as string,
        args.kind as string | undefined
      );
    } else if (normalizedName === 'ledgerrecent') {
      if (!args) throw new Error('Missing arguments for LedgerRecent');
      const ledger = resolveLedger();
      const limit = (args.limit as number | undefined) ?? 5;
      result = await ledger.recent(args.team_id as string, limit);
    } else if (normalizedName === 'ledgersearch') {
      if (!args) throw new Error('Missing arguments for LedgerSearch');
      const ledger = resolveLedger();
      const limit = (args.limit as number | undefined) ?? 50;
      result = await ledger.search(
        args.team_id as string,
        args.query as string,
        limit
      );
    } else if (normalizedName === 'ledgernote') {
      if (!args) throw new Error('Missing arguments for LedgerNote');
      const ledger = resolveLedger();
      await ledger.note(
        args.team_id as string,
        args.task_id as string,
        args.teammate as string,
        args.text as string
      );
      result = { ok: true };
    } else {
      result = { error: `Unknown tool: ${name}` };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err: any) {
    console.error(`Error in tool ${name}:`, err);
    const payload = err?.payload;
    if (payload) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: String(err) }, null, 2),
        },
      ],
    };
  }
});

export async function runServer(): Promise<void> {
  // Load config
  const config = await readConfig();
  agentConfigs = config.agentConfigs;
  manager.setModelOverrides(agentConfigs);
  const cliHealth = checkAllClis();
  const installedAgents = Object.entries(cliHealth)
    .filter(([, status]) => status.installed)
    .map(([agent]) => agent as AgentType);

  // Installed = enabled. If the CLI is on PATH, the agent is available.
  enabledAgents = installedAgents;

  console.error('Enabled agents (installed):', enabledAgents.join(', ') || 'none');

  if (enabledAgents.includes('gemini')) {
    await ensureGeminiPlanMode();
  }

  // Initialize version check (non-blocking, with timeout)
  initVersionCheck().catch(err => {
    console.warn('[Swarm] Version check failed:', err);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Starting Swarm MCP server v${getCurrentVersion()}`);

  // Health check
  const health = cliHealth;
  const available = Object.entries(health)
    .filter(([_, status]) => status.installed)
    .map(([agent]) => agent);
  const missing = Object.entries(health)
    .filter(([_, status]) => !status.installed)
    .map(([agent]) => agent);

  console.error('Available agents:', available.join(', '));
  if (missing.length > 0) {
    console.error('Missing agents (install CLIs to use):', missing.join(', '));
  }

}
