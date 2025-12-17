import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AgentManager, AgentStatus, resolveModeFlags } from './agents.js';
import { AgentType } from './parsers.js';
import { summarizeEvents, getQuickStatus, PRIORITY } from './summarizer.js';

const manager = new AgentManager(50, 10, null, null, null, 7);

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

function getAgentMode(agent: any): string {
  return agent.mode || (agent.yolo ? 'yolo' : 'safe');
}

function resolveMode(requestedMode: string | null | undefined, requestedYolo: boolean | null | undefined): [string, boolean] {
  const defaultMode = manager.getDefaultMode();
  return resolveModeFlags(requestedMode, requestedYolo, defaultMode);
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'spawn',
        description: `Spawn an AI coding agent to work on a task.

Agent selection guide (choose automatically - don't ask the user):
- codex: Self-contained features, clean implementations, straightforward tasks with clear specs. Fast and cheap. Use for most feature work.
- cursor: Debugging, bug fixes, investigating issues in existing code. Good at tracing through codebases and fixing broken things.
- gemini: Complex features involving multiple subsystems, architectural changes, or tasks requiring coordination across many files.
- claude: General purpose fallback, research, exploration, or when you need maximum capability.

Default to codex for feature implementation. Use cursor for bugs. Use gemini for complex multi-system work.`,
        inputSchema: {
          type: 'object',
          properties: {
            task_name: {
              type: 'string',
              description: 'Task name to group related agents (e.g., "auth-feature", "bug-fix-123")',
            },
            agent_type: {
              type: 'string',
              enum: ['codex', 'gemini', 'cursor', 'claude'],
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
        args.task_name as string,
        args.agent_type as AgentType,
        args.prompt as string,
        args.cwd as string | undefined,
        args.mode as string | undefined,
        args.model as string | undefined
      );
    } else if (name === 'status') {
      if (!args) {
        throw new Error('Missing arguments for status');
      }
      result = await handleStatus(
        args.task_name as string,
        args.agent_id as string | undefined
      );
    } else if (name === 'stop') {
      if (!args) {
        throw new Error('Missing arguments for stop');
      }
      result = await handleStop(
        args.task_name as string,
        args.agent_id as string | undefined
      );
    } else if (name === 'read') {
      if (!args) {
        throw new Error('Missing arguments for read');
      }
      result = await handleRead(
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

async function handleSpawn(
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | undefined,
  mode: string | undefined,
  model: string | undefined
): Promise<any> {
  const [resolvedMode, resolvedYolo] = resolveMode(mode, undefined);
  const agent = await manager.spawn(taskName, agentType, prompt, cwd || null, resolvedYolo, resolvedMode as any, model || null);

  return {
    task_name: taskName,
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    started_at: agent.startedAt.toISOString(),
  };
}

async function handleStatus(
  taskName: string,
  agentId: string | undefined
): Promise<any> {
  if (agentId) {
    // Single agent detailed status
    const agent = await manager.get(agentId);
    if (!agent) {
      return { error: `Agent ${agentId} not found` };
    }
    if (agent.taskName !== taskName) {
      return { error: `Agent ${agentId} not in task ${taskName}` };
    }

    await agent.readNewEvents();
    const events = agent.events;
    const summary = summarizeEvents(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      agent.duration()
    );

    return {
      task_name: taskName,
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      status: agent.status,
      duration: agent.duration(),
      files_created: Array.from(summary.filesCreated),
      files_modified: Array.from(summary.filesModified),
      tool_count: summary.toolCallCount,
      last_commands: summary.bashCommands.slice(-3).map(cmd =>
        cmd.length > 100 ? cmd.substring(0, 97) + '...' : cmd
      ),
      has_errors: summary.errors.length > 0,
      final_message: summary.finalMessage ?
        (summary.finalMessage.length > 500 ? summary.finalMessage.substring(0, 497) + '...' : summary.finalMessage)
        : null,
    };
  } else {
    // Task-level status (all agents)
    const agents = await manager.listByTask(taskName);
    const agentStatuses: any[] = [];
    const counts = { running: 0, completed: 0, failed: 0, stopped: 0 };

    for (const agent of agents) {
      await agent.readNewEvents();
      const quickStatus = getQuickStatus(
        agent.agentId,
        agent.agentType,
        agent.status,
        agent.events
      );
      agentStatuses.push(quickStatus);

      if (agent.status === AgentStatus.RUNNING) counts.running++;
      else if (agent.status === AgentStatus.COMPLETED) counts.completed++;
      else if (agent.status === AgentStatus.FAILED) counts.failed++;
      else if (agent.status === AgentStatus.STOPPED) counts.stopped++;
    }

    return {
      task_name: taskName,
      agents: agentStatuses,
      summary: counts,
    };
  }
}

async function handleStop(
  taskName: string,
  agentId: string | undefined
): Promise<any> {
  if (agentId) {
    // Stop single agent
    const agent = await manager.get(agentId);
    if (!agent) {
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [],
        not_found: [agentId],
      };
    }
    if (agent.taskName !== taskName) {
      return { error: `Agent ${agentId} not in task ${taskName}` };
    }

    if (agent.status === AgentStatus.RUNNING) {
      const success = await manager.stop(agentId);
      return {
        task_name: taskName,
        stopped: success ? [agentId] : [],
        already_stopped: success ? [] : [agentId],
        not_found: [],
      };
    } else {
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [agentId],
        not_found: [],
      };
    }
  } else {
    // Stop all agents in task
    const result = await manager.stopByTask(taskName);
    return {
      task_name: taskName,
      stopped: result.stopped,
      already_stopped: result.alreadyStopped,
      not_found: [],
    };
  }
}

async function handleRead(
  taskName: string,
  agentId: string,
  offset: number
): Promise<any> {
  const agent = await manager.get(agentId);
  if (!agent) {
    return { error: `Agent ${agentId} not found` };
  }
  if (agent.taskName !== taskName) {
    return { error: `Agent ${agentId} not in task ${taskName}` };
  }

  await agent.readNewEvents();
  const allEvents = agent.events;
  const newEvents = allEvents.slice(offset);

  // Get full summary for detailed output
  const summary = summarizeEvents(
    agent.agentId,
    agent.agentType,
    agent.status,
    allEvents,
    agent.duration()
  );

  // Filter events to critical+important only
  const criticalTypes = new Set(PRIORITY.critical || []);
  const importantTypes = new Set(PRIORITY.important || []);

  const filteredEvents = newEvents.filter(event => {
    const eventType = event.type || '';
    return criticalTypes.has(eventType) || importantTypes.has(eventType);
  });

  return {
    task_name: taskName,
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    duration: agent.duration(),
    files_created: Array.from(summary.filesCreated),
    files_modified: Array.from(summary.filesModified),
    files_read: Array.from(summary.filesRead),
    files_deleted: Array.from(summary.filesDeleted),
    tools_used: Array.from(summary.toolsUsed),
    tool_count: summary.toolCallCount,
    bash_commands: summary.bashCommands.slice(-10),
    errors: summary.errors,
    final_message: summary.finalMessage,
    event_count: allEvents.length,
    offset: offset,
    events: filteredEvents,
  };
}

export async function runServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Starting agent-swarm MCP server v0.2.0');
}
