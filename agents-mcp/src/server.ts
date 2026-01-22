import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AgentManager, checkAllClis } from './agents.js';
import { AgentType } from './parsers.js';
import { handleSpawn, handleStatus, handleStop, handleTasks } from './api.js';
import { readConfig } from './persistence.js';
import {
  buildVersionNotice,
  detectClientFromName,
  getCurrentVersion,
  initVersionCheck,
  setDetectedClient,
} from './version.js';

const manager = new AgentManager(50, 10, null, null, null, 7, null);

const TOOL_NAMES = {
  spawn: 'Spawn',
  status: 'Status',
  stop: 'Stop',
  tasks: 'Tasks',
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
  trae: 'ByteDance agent. Multi-model support, trajectory logging.',
  opencode: 'Open source coding agent. Provider-agnostic, TUI-focused.',
};

function withVersionNotice(description: string): string {
  return description + buildVersionNotice();
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
- mode='ralph' - YOLO mode: Agent autonomously works through all tasks in RALPH.md until done. Requires cwd and RALPH.md file.

RALPH MODE: Spawns ONE agent with full permissions and instructions to work through RALPH.md. The agent reads the task file, understands the system, picks tasks logically, completes them, marks checkboxes, and continues until all tasks are checked. The orchestrator can spawn multiple ralph agents in parallel for different directories/task files.

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
              enum: ['plan', 'edit', 'ralph'],
              description: "'edit' allows file modifications, 'plan' is read-only (default), 'ralph' is autonomous execution through RALPH.md tasks.",
            },
            effort: {
              type: 'string',
              enum: ['fast', 'default', 'detailed'],
              description: "Effort level: 'fast' is quickest/cheapest, 'default' is balanced (default), 'detailed' is max-capability.",
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
    ],
  };
});

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
      result = await handleSpawn(
        manager,
        args.task_name as string,
        args.agent_type as AgentType,
        args.prompt as string,
        (args.cwd as string) || null,
        (args.mode as string) || null,
        (args.effort as 'fast' | 'default' | 'detailed') || 'default',
        parentSessionId,
        workspaceDir
      );
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
  manager.setModelOverrides(config.agentConfigs);
  const cliHealth = checkAllClis();
  const installedAgents = Object.entries(cliHealth)
    .filter(([, status]) => status.installed)
    .map(([agent]) => agent as AgentType);

  const requestedAgents = config.enabledAgents;

  // Prefer explicitly configured agents, filtered by what's installed.
  // If no config exists, fall back to installed list.
  enabledAgents = config.hasConfig
    ? requestedAgents.filter(a => cliHealth[a]?.installed)
    : installedAgents;

  console.error('Requested agents:', requestedAgents.join(', '));
  console.error('Enabled agents (installed):', enabledAgents.join(', ') || 'none');

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

  const requestedMissing = requestedAgents.filter(a => missing.includes(a));
  if (requestedMissing.length > 0) {
    console.error('Requested but missing agents (spawn tool hidden):', requestedMissing.join(', '));
  }
}
