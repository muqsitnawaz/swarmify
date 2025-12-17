import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { AgentManager, AgentStatus, checkAllClis, resolveModeFlags, getAgentsDir } from './agents.js';
import { AgentType } from './parsers.js';
import { summarizeEvents, getDelta, getStatusSummary, getLastTool, PRIORITY } from './summarizer.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const manager = new AgentManager(50, 10, null, null, null, 7);

const server = new Server(
  {
    name: 'agent-swarm',
    version: '0.1.0',
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
        name: 'spawn_agent',
        description: `Spawn an AI coding agent to work on a task asynchronously.

Agent selection guide (choose automatically - don't ask the user):
- codex: Self-contained features, clean implementations, straightforward tasks with clear specs. Fast and cheap. Use for most feature work.
- cursor: Debugging, bug fixes, investigating issues in existing code. Good at tracing through codebases and fixing broken things.
- gemini: Complex features involving multiple subsystems, architectural changes, or tasks requiring coordination across many files.
- claude: General purpose fallback, research, exploration, or when you need maximum capability.

Default to codex for feature implementation. Use cursor for bugs. Use gemini for complex multi-system work.`,
        inputSchema: {
          type: 'object',
          properties: {
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
              description: "Preferred automation mode. 'yolo' swaps --full-auto for --yolo where supported (unsafe).",
            },
            yolo: {
              type: 'boolean',
              description: 'Enable unsafe yolo mode (replaces --full-auto with --yolo when supported)',
              default: false,
            },
            model: {
              type: 'string',
              description: 'Model to use (for codex: gpt-5-codex, gpt-5-codex-mini, etc.)',
            },
          },
          required: ['agent_type', 'prompt'],
        },
      },
      {
        name: 'read_agent_output',
        description: `Read output from a running or completed agent.

IMPORTANT: Always prefer summary format with brief/standard detail to minimize token usage.
- format='summary' + detail_level='brief': Use this by default. Minimal tokens, shows status and key info.
- format='summary' + detail_level='standard': Use when you need more context about what the agent did.
- format='delta': Use for polling a running agent - only returns new events since last read.
- format='events' or detail_level='detailed': ONLY use when debugging failures or need raw output. Very token-heavy.

For most use cases, just call with agent_id only - defaults are optimized for efficiency.`,
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: {
              type: 'string',
              description: 'ID of the agent to read output from',
            },
            format: {
              type: 'string',
              enum: ['summary', 'delta', 'events'],
              default: 'summary',
              description: "Output format. Prefer 'summary' (default) for token efficiency. Use 'delta' for polling. Avoid 'events' unless debugging.",
            },
            detail_level: {
              type: 'string',
              enum: ['brief', 'standard', 'detailed'],
              default: 'brief',
              description: "Detail level for summary format. Default is 'brief' (~80 tokens) for efficiency. Use 'standard' (~200 tokens) for more context. Only use 'detailed' (~500 tokens) when debugging failures.",
            },
            since_event: {
              type: 'integer',
              default: 0,
              description: 'Return events after this index (for delta/events format)',
            },
            include_all_events: {
              type: 'boolean',
              default: false,
              description: 'Include all events without filtering (for debugging). Very token-heavy.',
            },
          },
          required: ['agent_id'],
        },
      },
      {
        name: 'list_agents',
        description: 'List all agents (running and completed) with their status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'stop_agent',
        description: 'Stop a running agent',
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: {
              type: 'string',
              description: 'ID of the agent to stop',
            },
          },
          required: ['agent_id'],
        },
      },
      {
        name: 'check_environment',
        description: 'Check which CLI agents are installed and available. Call this before spawning agents to verify the environment is ready.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'view_logs',
        description: 'View recent agent-swarm server logs for debugging. Shows server startup, agent spawns, errors, and shutdown events.',
        inputSchema: {
          type: 'object',
          properties: {
            lines: {
              type: 'integer',
              description: 'Number of recent log lines to return (default: 50, max: 500)',
              default: 50,
            },
            level: {
              type: 'string',
              enum: ['all', 'info', 'warning', 'error'],
              description: 'Filter by log level (default: all)',
              default: 'all',
            },
          },
        },
      },
      {
        name: 'check_agents_status',
        description: 'Efficiently check status of multiple agents at once. Returns minimal status info (status, last_tool, brief summary) without reading full event summaries. Use this for polling multiple agents, then call read_agent_output only when you need detailed information.',
        inputSchema: {
          type: 'object',
          properties: {
            agent_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of agent IDs to check',
            },
          },
          required: ['agent_ids'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    if (name === 'spawn_agent') {
      if (!args) {
        throw new Error('Missing arguments for spawn_agent');
      }
      result = await handleSpawnAgent(
        args.agent_type as AgentType,
        args.prompt as string,
        args.cwd as string | undefined,
        args.mode as string | undefined,
        args.yolo as boolean | undefined,
        args.model as string | undefined
      );
    } else if (name === 'read_agent_output') {
      if (!args) {
        throw new Error('Missing arguments for read_agent_output');
      }
      result = await handleReadAgentOutput(
        args.agent_id as string,
        (args.format as string) || 'summary',
        (args.detail_level as string) || 'brief',
        (args.since_event as number) || 0,
        (args.include_all_events as boolean) || false
      );
    } else if (name === 'list_agents') {
      result = await handleListAgents();
    } else if (name === 'stop_agent') {
      if (!args) {
        throw new Error('Missing arguments for stop_agent');
      }
      result = await handleStopAgent(args.agent_id as string);
    } else if (name === 'check_environment') {
      result = await handleCheckEnvironment();
    } else if (name === 'view_logs') {
      if (!args) {
        throw new Error('Missing arguments for view_logs');
      }
      result = await handleViewLogs(
        (args.lines as number) || 50,
        (args.level as string) || 'all'
      );
    } else if (name === 'check_agents_status') {
      if (!args) {
        throw new Error('Missing arguments for check_agents_status');
      }
      result = await handleCheckAgentsStatus(args.agent_ids as string[]);
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

async function handleSpawnAgent(
  agentType: AgentType,
  prompt: string,
  cwd: string | undefined,
  mode: string | undefined,
  yolo: boolean | undefined,
  model: string | undefined
): Promise<any> {
  const [resolvedMode, resolvedYolo] = resolveMode(mode, yolo);
  const agent = await manager.spawn(agentType, prompt, cwd || null, resolvedYolo, resolvedMode as any, model || null);

  const responseMode = getAgentMode(agent) || resolvedMode;
  const modelInfo = model ? ` (model: ${model})` : '';
  return {
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    started_at: agent.startedAt.toISOString(),
    mode: responseMode,
    yolo: agent.yolo,
    model: model || null,
    message: `Spawned ${agentType} agent to work on task (${responseMode === 'yolo' ? 'YOLO' : 'safe'} mode)${modelInfo}`,
  };
}

async function handleReadAgentOutput(
  agentId: string,
  format: string,
  detailLevel: string,
  sinceEvent: number,
  includeAllEvents: boolean
): Promise<any> {
  const agent = await manager.get(agentId);

  if (!agent) {
    return { error: `Agent ${agentId} not found` };
  }

  await agent.readNewEvents();
  const events = agent.events;

  const mode = getAgentMode(agent);
  const yoloEnabled = agent.yolo;

  if (format === 'summary') {
    const summary = summarizeEvents(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      agent.duration()
    );
    return {
      ...summary.toDict(detailLevel as any),
      mode: mode,
      yolo: yoloEnabled,
    };
  } else if (format === 'delta') {
    const delta = getDelta(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      sinceEvent
    );
    return {
      ...delta,
      mode: mode,
      yolo: yoloEnabled,
    };
  } else {
    const allEvents = events.slice(sinceEvent);

    if (includeAllEvents) {
      return {
        agent_id: agent.agentId,
        agent_type: agent.agentType,
        status: agent.status,
        since_event: sinceEvent,
        event_count: events.length,
        filtered_event_count: allEvents.length,
        events: allEvents,
        mode: mode,
        yolo: yoloEnabled,
        note: 'All events included (no filtering applied)',
      };
    }

    const criticalTypes = new Set(PRIORITY.critical || []);
    const importantTypes = new Set(PRIORITY.important || []);
    const verboseTypes = new Set(PRIORITY.verbose || []);

    const filteredEvents: any[] = [];
    const filteredOut: any[] = [];

    for (const event of allEvents) {
      const eventType = event.type || '';

      if (verboseTypes.has(eventType)) {
        filteredOut.push({ type: eventType, reason: 'verbose_event_type' });
        continue;
      }

      if (eventType === 'thinking' || eventType === 'message') {
        if (!event.complete) {
          filteredOut.push({ type: eventType, reason: 'incomplete_delta' });
          continue;
        }
      }

      if (criticalTypes.has(eventType) || importantTypes.has(eventType)) {
        filteredEvents.push(event);
      } else {
        filteredOut.push({ type: eventType, reason: 'not_critical_or_important' });
      }
    }

    const optimizedEvents: any[] = [];
    for (const event of filteredEvents) {
      const eventCopy = { ...event };
      const eventType = event.type || '';

      if ('content' in eventCopy && typeof eventCopy.content === 'string') {
        if (eventType === 'thinking') {
          const maxLen = 200;
          if (eventCopy.content.length > maxLen) {
            eventCopy.content = eventCopy.content.substring(0, maxLen - 3) + '...';
          }
        }
      }

      if ('command' in eventCopy && typeof eventCopy.command === 'string') {
        if (eventCopy.command.length > 300) {
          eventCopy.command = eventCopy.command.substring(0, 297) + '...';
        }
      }

      if ('raw' in eventCopy && eventType !== 'raw') {
        const rawData = eventCopy.raw;
        if (typeof rawData === 'object' && rawData !== null && String(rawData).length > 500) {
          eventCopy.raw = { _truncated: true, _size: String(rawData).length };
        }
      }

      optimizedEvents.push(eventCopy);
    }

    const filteredSummary: Record<string, string[]> = {};
    for (const item of filteredOut) {
      const reason = item.reason;
      if (!filteredSummary[reason]) {
        filteredSummary[reason] = [];
      }
      filteredSummary[reason].push(item.type);
    }

    const result: any = {
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      status: agent.status,
      since_event: sinceEvent,
      event_count: events.length,
      filtered_event_count: optimizedEvents.length,
      events: optimizedEvents,
      mode: mode,
      yolo: yoloEnabled,
    };

    if (filteredOut.length > 0) {
      result.filtered_events_summary = {
        total_filtered: filteredOut.length,
        by_reason: Object.fromEntries(
          Object.entries(filteredSummary).map(([reason, types]) => [reason, types.length])
        ),
        filtered_types: Object.fromEntries(
          Object.entries(filteredSummary).map(([reason, types]) => [reason, Array.from(new Set(types))])
        ),
      };
    }

    return result;
  }
}

async function handleListAgents(): Promise<any> {
  const allAgents = await manager.listAll();

  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const relevant = allAgents.filter(
    a => a.status === AgentStatus.RUNNING || (a.completedAt && a.completedAt > cutoff)
  );

  const running = relevant.filter(a => a.status === AgentStatus.RUNNING);
  const completed = relevant.filter(a => a.status !== AgentStatus.RUNNING);

  return {
    agents: relevant.map(a => a.toDict()),
    running_count: running.length,
    completed_count: completed.length,
    filtered: allAgents.length - relevant.length,
  };
}

async function handleStopAgent(agentId: string): Promise<any> {
  const success = await manager.stop(agentId);

  if (success) {
    return {
      agent_id: agentId,
      status: 'stopped',
      message: `Agent ${agentId} has been stopped`,
    };
  } else {
    const agent = await manager.get(agentId);
    if (agent) {
      return {
        agent_id: agentId,
        status: agent.status,
        message: `Agent ${agentId} was not running (status: ${agent.status})`,
      };
    }
    return { error: `Agent ${agentId} not found` };
  }
}

async function handleCheckEnvironment(): Promise<any> {
  const agents = checkAllClis();

  const installed: string[] = [];
  const missing: string[] = [];

  for (const [name, info] of Object.entries(agents)) {
    if (info.installed) {
      installed.push(name);
    } else {
      missing.push(name);
    }
  }

  return {
    agents: agents,
    installed: installed,
    missing: missing,
    ready: missing.length === 0,
    message:
      missing.length === 0
        ? 'All CLI agents are installed and ready.'
        : `Missing CLI tools: ${missing.join(', ')}. Install them to use these agent types.`,
  };
}

async function handleViewLogs(lines: number, level: string): Promise<any> {
  const agentsDir = await getAgentsDir();
  const logFile = path.join(path.dirname(agentsDir), 'agent-swarm.log');

  try {
    await fs.access(logFile);
  } catch {
    return {
      error: 'Log file not found',
      path: logFile,
    };
  }

  const clampedLines = Math.max(1, Math.min(lines, 500));

  try {
    const content = await fs.readFile(logFile, 'utf-8');
    const allLines = content.split('\n');

    const levelFilters: Record<string, string[] | null> = {
      info: ['INFO', 'WARNING', 'ERROR'],
      warning: ['WARNING', 'ERROR'],
      error: ['ERROR'],
      all: null,
    };

    const filterLevels = levelFilters[level];
    let filteredLines = allLines;
    if (filterLevels) {
      filteredLines = allLines.filter(line =>
        filterLevels.some(lvl => line.includes(` | ${lvl}`))
      );
    }

    const recentLines = filteredLines.slice(-clampedLines);

    return {
      log_path: logFile,
      total_lines: allLines.length,
      returned_lines: recentLines.length,
      level_filter: level,
      logs: recentLines.join('\n'),
    };
  } catch (err: any) {
    return { error: `Failed to read log file: ${err.message}` };
  }
}

async function handleCheckAgentsStatus(agentIds: string[]): Promise<any> {
  const agentsStatus: any[] = [];
  const statusCounts: Record<string, number> = {
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
    not_found: 0,
  };

  for (const agentId of agentIds) {
    const agent = await manager.get(agentId);

    if (!agent) {
      agentsStatus.push({
        agent_id: agentId,
        error: 'Agent not found',
      });
      statusCounts.not_found++;
      continue;
    }

    await agent.readNewEvents();
    const events = agent.events;
    const duration = agent.duration();
    const lastTool = getLastTool(events);
    const summary = getStatusSummary(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      duration
    );

    agentsStatus.push({
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      status: agent.status,
      duration: duration,
      last_tool: lastTool,
      summary: summary,
    });

    const statusKey = agent.status;
    if (statusKey in statusCounts) {
      statusCounts[statusKey]++;
    }
  }

  return {
    agents: agentsStatus,
    summary: statusCounts,
  };
}

export async function runServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Starting agent-swarm MCP server');
}
