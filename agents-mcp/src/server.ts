import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AgentManager, checkAllClis } from './agents.js';
import { AgentType } from './parsers.js';
import { handleSpawn, handleStatus, handleStop, handleListTasks } from './api.js';
import { readConfig } from './persistence.js';

const manager = new AgentManager(50, 10, null, null, null, 7);

// Enabled agents (loaded from ~/.swarmify/config.json with legacy fallback)
const defaultAgents: AgentType[] = ['claude', 'codex', 'gemini'];
let enabledAgents: AgentType[] = [...defaultAgents];

// Agent descriptions for dynamic tool description
const agentDescriptions: Record<AgentType, string> = {
  cursor: 'Debugging, bug fixes, tracing through codebases.',
  codex: 'Fast, cheap. Self-contained features, clean implementations.',
  claude: 'Maximum capability, research, exploration.',
  gemini: 'Complex multi-system features, architectural changes.',
};

function buildSpawnDescription(): string {
  const agentList = enabledAgents
    .map((agent, i) => `${i + 1}. ${agent} - ${agentDescriptions[agent]}`)
    .join('\n');

  return `Spawn an AI coding agent to work on a task.

IMPORTANT: Avoid spawning the same agent type as yourself. If you are Claude, prefer cursor/codex/gemini instead.

Only installed agent CLIs are listed below.

MODE PARAMETER (required for writes):
- mode='edit' - Agent CAN modify files (use this for implementation tasks)
- mode='plan' - Agent is READ-ONLY (default, use for research/exploration)

WAIT BEFORE CHECKING STATUS: After spawning all agents for this task, sleep for at least 2 minutes before checking status. Use: Bash(sleep 120 && echo "Done waiting on Swarm agents. Let's check status") timeout: 2m 30s

Do NOT immediately call status - it wastes tokens and returns nothing useful.

Agent selection (in order of preference):
${agentList}

Choose automatically based on task requirements - don't ask the user.`;
}

const server = new Server(
  {
    name: 'agent-swarm',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'spawn',
        description: buildSpawnDescription(),
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
              enum: ['plan', 'edit'],
              description: "'edit' allows file modifications, 'plan' is read-only (default).",
            },
            effort: {
              type: 'string',
              enum: ['medium', 'high'],
              description: "Effort level: 'medium' (default) uses balanced models, 'high' uses max-capability models.",
            },
          },
          required: ['task_name', 'agent_type', 'prompt'],
        },
      },
      {
        name: 'status',
        description: `Get status of all agents in a task with full details including:
- Files created/modified/read/deleted (full paths)
- All bash commands executed
- Last 3 assistant messages

Use this for polling agent progress.

CURSOR SUPPORT: Send 'since' parameter (ISO timestamp from previous response's 'cursor' field) to get only NEW data since that time. This avoids duplicate data on repeated polls.`,
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name to get status for',
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
        name: 'stop',
        description: `Stop agents. Two modes:
- stop(task_name): Stop ALL agents in the task
- stop(task_name, agent_id): Stop ONE specific agent`,
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
        name: 'tasks',
        description: `List all tasks with their agents and activity details.

Returns tasks sorted by most recent activity, with full agent details including:
- Files created/modified/read/deleted
- Bash commands executed
- Last messages from each agent
- Status and duration`,
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of tasks to return (optional, defaults to all)',
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

  try {
    let result: any;

    if (name === 'spawn') {
      if (!args) {
        throw new Error('Missing arguments for spawn');
      }
      result = await handleSpawn(
        manager,
        args.task_name as string,
        args.agent_type as AgentType,
        args.prompt as string,
        (args.cwd as string) || null,
        (args.mode as string) || null,
        (args.effort as 'medium' | 'high') || 'medium'
      );
    } else if (name === 'status') {
      if (!args) {
        throw new Error('Missing arguments for status');
      }
      result = await handleStatus(
        manager,
        args.task_name as string,
        args.filter as string | undefined,
        args.since as string | undefined
      );
    } else if (name === 'stop') {
      if (!args) {
        throw new Error('Missing arguments for stop');
      }
      result = await handleStop(
        manager,
        args.task_name as string,
        args.agent_id as string | undefined
      );
    } else if (name === 'tasks') {
      result = await handleListTasks(
        manager,
        args?.limit as number | undefined
      );
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
  // Load enabled agents from config
  const config = await readConfig();
  const requestedAgents = config.enabledAgents.length > 0 ? config.enabledAgents : [...defaultAgents];

  const cliHealth = checkAllClis();
  const availableAgents = requestedAgents.filter(a => cliHealth[a]?.installed);
  const fallbackAgents = Object.entries(cliHealth)
    .filter(([, status]) => status.installed)
    .map(([agent]) => agent as AgentType);

  // Prefer the requested agents that are actually installed; otherwise fall back to any installed CLIs
  enabledAgents = availableAgents.length > 0 ? availableAgents : fallbackAgents;

  console.error('Requested agents:', requestedAgents.join(', '));
  console.error('Enabled agents (installed):', enabledAgents.join(', ') || 'none');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Starting agent-swarm MCP server v0.2.0');

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
