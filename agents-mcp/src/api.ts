/**
 * Testable API handlers for the agent-swarm MCP server.
 * These functions can be called directly in tests with a custom AgentManager.
 */

import { AgentManager, AgentStatus, resolveMode } from './agents.js';
import { AgentType } from './parsers.js';
import { summarizeEvents, getLastMessages, getDelta } from './summarizer.js';

/**
 * Truncate a bash command for status output.
 * Handles heredocs specially - shows the redirect target instead of contents.
 */
function truncateBashCommand(cmd: string, maxLen: number = 120): string {
  // Detect heredoc patterns: cat <<'EOF' > path or cat << EOF > path
  const heredocMatch = cmd.match(/cat\s+<<['"]?(\w+)['"]?\s*>\s*([^\s]+)/);
  if (heredocMatch) {
    return `cat <<${heredocMatch[1]} > ${heredocMatch[2]}`;
  }

  // For regular commands, just truncate
  if (cmd.length <= maxLen) return cmd;
  return cmd.substring(0, maxLen - 3) + '...';
}

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
  cursor: string;  // ISO timestamp - send back in next request for delta
}

export interface TaskStatusResult {
  task_name: string;
  agents: AgentStatusDetail[];
  summary: { running: number; completed: number; failed: number; stopped: number };
  cursor: string;  // ISO timestamp - max across all agents
}

export interface StopResult {
  task_name: string;
  stopped: string[];
  already_stopped: string[];
  not_found: string[];
}

export interface TaskSummary {
  task_name: string;
  agent_count: number;
  status_counts: { running: number; completed: number; failed: number; stopped: number };
  latest_activity: string;  // ISO timestamp
  agents: AgentStatusDetail[];
}

export interface ListTasksResult {
  tasks: TaskSummary[];
  total_agents: number;
}

export async function handleSpawn(
  manager: AgentManager,
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  mode: string | null,
  effort: 'medium' | 'high' | null = 'medium'
): Promise<SpawnResult> {
  const defaultMode = manager.getDefaultMode();
  const resolvedMode = resolveMode(mode, defaultMode);
  const resolvedEffort = effort ?? 'medium';

  console.log(`[spawn] Spawning ${agentType} agent for task "${taskName}" [${resolvedMode}] effort=${resolvedEffort}...`);

  const agent = await manager.spawn(
    taskName,
    agentType,
    prompt,
    cwd,
    resolvedMode,
    resolvedEffort
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
  taskName: string,
  filter?: string,
  since?: string  // Optional ISO timestamp - return only events after this time
): Promise<TaskStatusResult> {
  // Default to 'all' so callers see completed/failed agents unless they opt to filter
  const effectiveFilter = filter || 'all';
  console.log(`[status] Getting status for agents in task "${taskName}" (filter=${effectiveFilter})...`);

  const allAgents = await manager.listByTask(taskName);

  // Filter agents by status ('all' shows everything)
  const agents = effectiveFilter === 'all'
    ? allAgents
    : allAgents.filter((a) => a.status === effectiveFilter);

  const agentStatuses: AgentStatusDetail[] = [];
  const counts = { running: 0, completed: 0, failed: 0, stopped: 0 };

  // Count ALL agents for summary (not just filtered)
  for (const agent of allAgents) {
    if (agent.status === AgentStatus.RUNNING) counts.running++;
    else if (agent.status === AgentStatus.COMPLETED) counts.completed++;
    else if (agent.status === AgentStatus.FAILED) counts.failed++;
    else if (agent.status === AgentStatus.STOPPED) counts.stopped++;
  }

  // Build details only for filtered agents
  let maxTimestamp = since || new Date(0).toISOString();  // Track max timestamp for cursor

  for (const agent of agents) {
    await agent.readNewEvents();
    const events = agent.events;

    // Use getDelta to filter events by timestamp (or get all if no since)
    const delta = getDelta(
      agent.agentId,
      agent.agentType,
      agent.status,
      events,
      since
    );

    // Find latest timestamp from this agent's events
    const latestEvent = events[events.length - 1];
    const agentTimestamp = latestEvent?.timestamp || new Date().toISOString();
    if (agentTimestamp > maxTimestamp) {
      maxTimestamp = agentTimestamp;
    }

    agentStatuses.push({
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      status: agent.status,
      duration: agent.duration(),
      files_created: delta.new_files_created,
      files_modified: delta.new_files_modified,
      files_read: delta.new_files_read,
      files_deleted: delta.new_files_deleted,
      bash_commands: delta.new_bash_commands.map(truncateBashCommand),
      last_messages: delta.new_messages,
      tool_count: delta.new_tool_count,
      has_errors: delta.new_errors.length > 0,
      cursor: agentTimestamp,  // Return latest timestamp for this agent
    });
  }

  console.log(`[status] Task "${taskName}": returning ${agents.length}/${allAgents.length} agents (running=${counts.running}, completed=${counts.completed}, failed=${counts.failed}, stopped=${counts.stopped})`);

  return {
    task_name: taskName,
    agents: agentStatuses,
    summary: counts,
    cursor: maxTimestamp,  // Max timestamp across all agents
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

export async function handleListTasks(
  manager: AgentManager,
  limit?: number
): Promise<ListTasksResult> {
  console.log(`[tasks] Listing all tasks (limit=${limit || 'none'})...`);

  const allAgents = await manager.listAll();

  // Group agents by task
  const taskMap = new Map<string, typeof allAgents>();
  for (const agent of allAgents) {
    const existing = taskMap.get(agent.taskName) || [];
    existing.push(agent);
    taskMap.set(agent.taskName, existing);
  }

  // Build task summaries
  const tasks: TaskSummary[] = [];
  for (const [taskName, agents] of taskMap) {
    const statusCounts = { running: 0, completed: 0, failed: 0, stopped: 0 };
    let latestTime = new Date(0);

    const agentDetails: AgentStatusDetail[] = [];

    for (const agent of agents) {
      // Update status counts
      if (agent.status === AgentStatus.RUNNING) statusCounts.running++;
      else if (agent.status === AgentStatus.COMPLETED) statusCounts.completed++;
      else if (agent.status === AgentStatus.FAILED) statusCounts.failed++;
      else if (agent.status === AgentStatus.STOPPED) statusCounts.stopped++;

      // Track latest activity
      const agentTime = agent.completedAt || agent.startedAt;
      if (agentTime > latestTime) {
        latestTime = agentTime;
      }

      // Read events and build detail
      await agent.readNewEvents();
      const events = agent.events;
      const summary = summarizeEvents(
        agent.agentId,
        agent.agentType,
        agent.status,
        events,
        agent.duration()
      );
      const lastMessages = getLastMessages(events, 5);

      // Get latest event timestamp for cursor
      const latestEvent = events[events.length - 1];
      const agentTimestamp = latestEvent?.timestamp || new Date().toISOString();

      agentDetails.push({
        agent_id: agent.agentId,
        agent_type: agent.agentType,
        status: agent.status,
        duration: agent.duration(),
        files_created: Array.from(summary.filesCreated),
        files_modified: Array.from(summary.filesModified),
        files_read: Array.from(summary.filesRead),
        files_deleted: Array.from(summary.filesDeleted),
        bash_commands: summary.bashCommands.slice(-15).map(truncateBashCommand),
        last_messages: lastMessages,
        tool_count: summary.toolCallCount,
        has_errors: summary.errors.length > 0,
        cursor: agentTimestamp,
      });
    }

    tasks.push({
      task_name: taskName,
      agent_count: agents.length,
      status_counts: statusCounts,
      latest_activity: latestTime.toISOString(),
      agents: agentDetails,
    });
  }

  // Sort by latest activity (most recent first)
  tasks.sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());

  // Apply limit if specified
  const limitedTasks = limit ? tasks.slice(0, limit) : tasks;

  console.log(`[tasks] Found ${tasks.length} tasks with ${allAgents.length} total agents`);

  return {
    tasks: limitedTasks,
    total_agents: allAgents.length,
  };
}
