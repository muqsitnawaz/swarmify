/**
 * Testable API handlers for the agent-swarm MCP server.
 * These functions can be called directly in tests with a custom AgentManager.
 */

import { AgentManager, AgentStatus, resolveModeFlags } from './agents.js';
import { AgentType } from './parsers.js';
import { summarizeEvents, getLastMessages } from './summarizer.js';

export interface SpawnResult {
  task_name: string;
  agent_id: string;
  agent_type: string;
  status: string;
  started_at: string;
}

export interface AgentStatusDetail {
  agent_id: string;
  agent_type: string;
  status: string;
  duration: string | null;
  files_created: string[];
  files_modified: string[];
  files_read: string[];
  files_deleted: string[];
  bash_commands: string[];
  last_messages: string[];
  tool_count: number;
  has_errors: boolean;
}

export interface TaskStatusResult {
  task_name: string;
  agents: AgentStatusDetail[];
  summary: { running: number; completed: number; failed: number; stopped: number };
}

export interface StopResult {
  task_name: string;
  stopped: string[];
  already_stopped: string[];
  not_found: string[];
}

export async function handleSpawn(
  manager: AgentManager,
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  mode: string | null,
  model: string | null
): Promise<SpawnResult> {
  const defaultMode = manager.getDefaultMode();
  const [resolvedMode, resolvedYolo] = resolveModeFlags(mode, undefined, defaultMode);

  console.log(`[spawn] Spawning ${agentType} agent for task "${taskName}"...`);

  const agent = await manager.spawn(
    taskName,
    agentType,
    prompt,
    cwd,
    resolvedYolo,
    resolvedMode as any,
    model
  );

  console.log(`[spawn] Spawned ${agentType} agent ${agent.agentId} for task "${taskName}"`);

  return {
    task_name: taskName,
    agent_id: agent.agentId,
    agent_type: agent.agentType,
    status: agent.status,
    started_at: agent.startedAt.toISOString(),
  };
}

export async function handleStatus(
  manager: AgentManager,
  taskName: string
): Promise<TaskStatusResult> {
  console.log(`[status] Getting status for all agents in task "${taskName}"...`);

  const agents = await manager.listByTask(taskName);
  const agentStatuses: AgentStatusDetail[] = [];
  const counts = { running: 0, completed: 0, failed: 0, stopped: 0 };

  for (const agent of agents) {
    await agent.readNewEvents();
    const events = agent.events;
    const summary = summarizeEvents(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      agent.duration()
    );
    const lastMessages = getLastMessages(events, 3);

    agentStatuses.push({
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      status: agent.status,
      duration: agent.duration(),
      files_created: Array.from(summary.filesCreated),
      files_modified: Array.from(summary.filesModified),
      files_read: Array.from(summary.filesRead),
      files_deleted: Array.from(summary.filesDeleted),
      bash_commands: summary.bashCommands,
      last_messages: lastMessages,
      tool_count: summary.toolCallCount,
      has_errors: summary.errors.length > 0,
    });

    if (agent.status === AgentStatus.RUNNING) counts.running++;
    else if (agent.status === AgentStatus.COMPLETED) counts.completed++;
    else if (agent.status === AgentStatus.FAILED) counts.failed++;
    else if (agent.status === AgentStatus.STOPPED) counts.stopped++;
  }

  console.log(`[status] Task "${taskName}": ${agents.length} agents (running=${counts.running}, completed=${counts.completed}, failed=${counts.failed}, stopped=${counts.stopped})`);

  return {
    task_name: taskName,
    agents: agentStatuses,
    summary: counts,
  };
}

export async function handleStop(
  manager: AgentManager,
  taskName: string,
  agentId?: string
): Promise<StopResult | { error: string }> {
  if (agentId) {
    console.log(`[stop] Stopping agent ${agentId} in task "${taskName}"...`);

    const agent = await manager.get(agentId);
    if (!agent) {
      console.log(`[stop] Agent ${agentId} not found`);
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [],
        not_found: [agentId],
      };
    }
    if (agent.taskName !== taskName) {
      console.log(`[stop] Agent ${agentId} not in task ${taskName}`);
      return { error: `Agent ${agentId} not in task ${taskName}` };
    }

    if (agent.status === AgentStatus.RUNNING) {
      const success = await manager.stop(agentId);
      console.log(`[stop] Agent ${agentId}: ${success ? 'stopped' : 'failed to stop'}`);
      return {
        task_name: taskName,
        stopped: success ? [agentId] : [],
        already_stopped: success ? [] : [agentId],
        not_found: [],
      };
    } else {
      console.log(`[stop] Agent ${agentId} already stopped (status=${agent.status})`);
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [agentId],
        not_found: [],
      };
    }
  } else {
    console.log(`[stop] Stopping all agents in task "${taskName}"...`);

    const result = await manager.stopByTask(taskName);

    console.log(`[stop] Task "${taskName}": stopped ${result.stopped.length}, already_stopped ${result.alreadyStopped.length}`);

    return {
      task_name: taskName,
      stopped: result.stopped,
      already_stopped: result.alreadyStopped,
      not_found: [],
    };
  }
}

