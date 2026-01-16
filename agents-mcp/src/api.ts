/**
 * Testable API handlers for the agent-swarm MCP server.
 * These functions can be called directly in tests with a custom AgentManager.
 */
import * as path from 'path';
import * as fs from 'fs/promises';

import { AgentManager, AgentStatus, resolveMode } from './agents.js';
import { AgentType } from './parsers.js';
import { getDelta } from './summarizer.js';

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

export async function handleSpawn(
  manager: AgentManager,
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  mode: string | null,
  effort: 'fast' | 'default' | 'detailed' | null = 'default',
  parentSessionId: string | null = null
): Promise<SpawnResult> {
  const defaultMode = manager.getDefaultMode();
  const resolvedMode = resolveMode(mode, defaultMode);
  const resolvedEffort = effort ?? 'default';

  console.error(
    `[spawn] Spawning ${agentType} agent for task "${taskName}" [${resolvedMode}] effort=${resolvedEffort}...`
  );

  // Ralph mode special handling
  if (resolvedMode === 'ralph') {
    if (!cwd) {
      throw new Error('Ralph mode requires a cwd parameter');
    }

    // Import ralph utilities
    const { isDangerousPath, getRalphConfig, buildRalphPrompt } = await import('./ralph.js');

    const resolvedCwd = path.resolve(cwd);

    // Safety check
    if (isDangerousPath(resolvedCwd)) {
      throw new Error('⚠️ Ralph mode in home or system directory is risky. Use a project directory.');
    }

    // Check RALPH.md exists
    const ralphConfig = getRalphConfig();
    const ralphFilePath = path.join(resolvedCwd, ralphConfig.ralphFile);

    try {
      await fs.access(ralphFilePath);
    } catch {
      throw new Error(`${ralphConfig.ralphFile} not found in ${resolvedCwd}. Create it first.`);
    }

    // Build the ralph instruction prompt
    const ralphPrompt = buildRalphPrompt(prompt, ralphFilePath);

    // Spawn agent with ralph prompt and ralph mode (full permissions)
    const agent = await manager.spawn(
      taskName,
      agentType,
      ralphPrompt,
      cwd,
      resolvedMode,
      resolvedEffort,
      parentSessionId
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

  // Regular spawn logic (plan/edit modes)

  const agent = await manager.spawn(
    taskName,
    agentType,
    prompt,
    cwd,
    resolvedMode,
    resolvedEffort,
    parentSessionId
  );

  console.error(`[spawn] Spawned ${agentType} agent ${agent.agentId} for task "${taskName}"`);

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
  taskName: string | null | undefined,
  filter?: string,
  since?: string,  // Optional ISO timestamp - return only events after this time
  parentSessionId?: string | null
): Promise<TaskStatusResult> {
  // Default to 'all' so callers see completed/failed agents unless they opt to filter
  const effectiveFilter = filter || 'all';
  const normalizedTaskName = taskName?.trim() || '';
  const normalizedParentSessionId = parentSessionId?.trim() || '';

  if (!normalizedTaskName && !normalizedParentSessionId) {
    throw new Error('task_name is required when parent_session_id is not provided');
  }

  const lookupLabel = normalizedParentSessionId && !normalizedTaskName
    ? `parent_session_id "${normalizedParentSessionId}"`
    : `task "${normalizedTaskName}"`;

  console.error(`[status] Getting status for agents in ${lookupLabel} (filter=${effectiveFilter})...`);

  const allAgents = normalizedParentSessionId && !normalizedTaskName
    ? await manager.listByParentSession(normalizedParentSessionId)
    : await manager.listByTask(normalizedTaskName);

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

  console.error(`[status] ${lookupLabel}: returning ${agents.length}/${allAgents.length} agents (running=${counts.running}, completed=${counts.completed}, failed=${counts.failed}, stopped=${counts.stopped})`);

  return {
    task_name: normalizedTaskName,
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
    console.error(`[stop] Stopping agent ${agentId} in task "${taskName}"...`);

    const agent = await manager.get(agentId);
    if (!agent) {
      console.error(`[stop] Agent ${agentId} not found`);
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [],
        not_found: [agentId],
      };
    }
    if (agent.taskName !== taskName) {
      console.error(`[stop] Agent ${agentId} not in task ${taskName}`);
      return { error: `Agent ${agentId} not in task ${taskName}` };
    }

    if (agent.status === AgentStatus.RUNNING) {
      const success = await manager.stop(agentId);
      console.error(`[stop] Agent ${agentId}: ${success ? 'stopped' : 'failed to stop'}`);
      return {
        task_name: taskName,
        stopped: success ? [agentId] : [],
        already_stopped: success ? [] : [agentId],
        not_found: [],
      };
    } else {
      console.error(`[stop] Agent ${agentId} already stopped (status=${agent.status})`);
      return {
        task_name: taskName,
        stopped: [],
        already_stopped: [agentId],
        not_found: [],
      };
    }
  } else {
    console.error(`[stop] Stopping all agents in task "${taskName}"...`);

    const result = await manager.stopByTask(taskName);

    console.error(`[stop] Task "${taskName}": stopped ${result.stopped.length}, already_stopped ${result.alreadyStopped.length}`);

    return {
      task_name: taskName,
      stopped: result.stopped,
      already_stopped: result.alreadyStopped,
      not_found: [],
    };
  }
}
