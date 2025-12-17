import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AgentManager } from './agents.js';
import { AgentType } from './parsers.js';
import { handleSpawn, handleStatus, handleStop, handleRead } from './api.js';

const manager = new AgentManager(50, 10, null, null, null, 7);

// Agent preference order (configurable via AGENT_SWARM_PREFERENCE env var)
const defaultPreference: AgentType[] = ['cursor', 'codex', 'claude', 'gemini'];
const agentPreference: AgentType[] = process.env.AGENT_SWARM_PREFERENCE
  ? (process.env.AGENT_SWARM_PREFERENCE.split(',').map(s => s.trim()) as AgentType[])
  : defaultPreference;

// Agent descriptions for dynamic tool description
const agentDescriptions: Record<AgentType, string> = {
  cursor: 'Debugging, bug fixes, tracing through codebases.',
  codex: 'Fast, cheap. Self-contained features, clean implementations.',
  claude: 'Maximum capability, research, exploration.',
  gemini: 'Complex multi-system features, architectural changes.',
};

function buildSpawnDescription(): string {
  const agentList = agentPreference
    .map((agent, i) => `${i + 1}. ${agent} - ${agentDescriptions[agent]}`)
    .join('\n');

  return `Spawn an AI coding agent to work on a task.

IMPORTANT: Avoid spawning the same agent type as yourself. If you are Claude, prefer cursor/codex/gemini instead.

WAIT BEFORE CHECKING STATUS: Agents take time to execute (30+ seconds minimum). After spawning:
- If you have other work to do, do that first
- Do NOT immediately call status - it wastes tokens and returns nothing useful
- Only check status after completing other work or waiting at least 30 seconds

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
              enum: agentPreference,
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
              enum: ['safe', 'yolo'],
              description: "Automation mode. 'yolo' is unsafe but faster.",
            },
            model: {
              type: 'string',
              description: 'Model to use (for codex: gpt-5-codex, gpt-5-codex-mini, etc.)',
            },
          },
          required: ['task_name', 'agent_type', 'prompt'],
        },
      },
      {
        name: 'status',
        description: `Get status of agents. Two modes:
- status(task_name): Quick status of ALL agents in the task
- status(task_name, agent_id): More detailed status of ONE specific agent

Use this for polling. Returns counts and last few commands (truncated for efficiency).`,
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name to get status for',
            },
            agent_id: {
              type: 'string',
              description: 'Optional: specific agent ID for more detailed status',
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
        name: 'read',
        description: `Read detailed output from a specific agent. Use for debugging or when you need full context.

Supports incremental reading via offset parameter - pass the event_count from previous read to get only new events.`,
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name',
            },
            agent_id: {
              type: 'string',
              description: 'Agent ID to read output from',
            },
            offset: {
              type: 'integer',
              default: 0,
              description: 'Event offset - skip this many events (use for incremental reads)',
            },
          },
          required: ['task_name', 'agent_id'],
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
        (args.model as string) || null
      );
    } else if (name === 'status') {
      if (!args) {
        throw new Error('Missing arguments for status');
      }
      result = await handleStatus(
        manager,
        args.task_name as string,
        args.agent_id as string | undefined
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
    } else if (name === 'read') {
      if (!args) {
        throw new Error('Missing arguments for read');
      }
      result = await handleRead(
        manager,
        args.task_name as string,
        args.agent_id as string,
        (args.offset as number) || 0
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Starting agent-swarm MCP server v0.2.0');
}
