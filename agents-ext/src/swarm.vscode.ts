// Swarm MCP configuration - VS Code dependent functions

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  AgentCli,
  isAgentCliAvailable,
  isAgentMcpEnabled,
  isAgentCommandInstalled,
} from './swarm.detect';

// Re-export for consumers that need the union type
export type { AgentCli } from './swarm.detect';

const execAsync = promisify(exec);

// Agent swarm data directory
const AGENT_SWARM_DIR = path.join(os.homedir(), '.swarmify', 'agents');

const SWARM_PACKAGE = '@swarmify/agents-mcp';


export interface AgentInstallStatus {
  installed: boolean;
  cliAvailable: boolean;
  mcpEnabled: boolean;
  commandInstalled: boolean;
}

export interface SwarmStatus {
  mcpEnabled: boolean;
  commandInstalled: boolean;
  agents: {
    claude: AgentInstallStatus;
    codex: AgentInstallStatus;
    gemini: AgentInstallStatus;
  };
}

// Get full swarm integration status (per-agent, not globally shared)
export async function getSwarmStatus(): Promise<SwarmStatus> {
  const claudeCliAvailable = await isAgentCliAvailable('claude');
  const codexCliAvailable = await isAgentCliAvailable('codex');
  const geminiCliAvailable = await isAgentCliAvailable('gemini');

  const claudeMcp = claudeCliAvailable ? await isAgentMcpEnabled('claude') : false;
  const codexMcp = codexCliAvailable ? await isAgentMcpEnabled('codex') : false;
  const geminiMcp = geminiCliAvailable ? await isAgentMcpEnabled('gemini') : false;

  const claudeCmd = claudeCliAvailable ? isAgentCommandInstalled('claude') : false;
  const codexCmd = codexCliAvailable ? isAgentCommandInstalled('codex') : false;
  const geminiCmd = geminiCliAvailable ? isAgentCommandInstalled('gemini') : false;

  const mcpEnabled = (!claudeCliAvailable || claudeMcp) &&
    (!codexCliAvailable || codexMcp) &&
    (!geminiCliAvailable || geminiMcp);

  const commandInstalled = (!claudeCliAvailable || claudeCmd) &&
    (!codexCliAvailable || codexCmd) &&
    (!geminiCliAvailable || geminiCmd);

  return {
    mcpEnabled,
    commandInstalled,
    agents: {
      claude: {
        installed: claudeMcp && claudeCmd && claudeCliAvailable,
        cliAvailable: claudeCliAvailable,
        mcpEnabled: claudeMcp,
        commandInstalled: claudeCmd,
      },
      codex: {
        installed: codexMcp && codexCmd && codexCliAvailable,
        cliAvailable: codexCliAvailable,
        mcpEnabled: codexMcp,
        commandInstalled: codexCmd,
      },
      gemini: {
        installed: geminiMcp && geminiCmd && geminiCliAvailable,
        cliAvailable: geminiCliAvailable,
        mcpEnabled: geminiMcp,
        commandInstalled: geminiCmd,
      },
    },
  };
}

// Check if swarm is fully enabled (MCP registered and commands installed)
export async function isSwarmEnabled(): Promise<boolean> {
  const status = await getSwarmStatus();
  return status.mcpEnabled && status.commandInstalled;
}

// Build Gemini TOML command content from markdown source
function buildGeminiToml(markdown: string): string {
  return [
    'name = "swarm"',
    'description = "Run Swarm MCP tasks"',
    'prompt = """',
    markdown.trimEnd(),
    '"""',
    ''
  ].join('\n');
}

// Install /swarm command for a specific agent
function installSwarmCommandForAgent(agent: AgentCli, context: vscode.ExtensionContext): boolean {
  const sourcePath = path.join(context.extensionPath, 'assets', 'swarm.md');
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const content = fs.readFileSync(sourcePath, 'utf-8');

  try {
    if (agent === 'claude') {
      const dir = path.join(os.homedir(), '.claude', 'commands');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'swarm.md'), content);
      return true;
    }

    if (agent === 'codex') {
      const dir = path.join(os.homedir(), '.codex', 'prompts');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'swarm.md'), content);
      return true;
    }

    if (agent === 'gemini') {
      const dir = path.join(os.homedir(), '.gemini', 'commands');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'swarm.toml'), buildGeminiToml(content));
      return true;
    }
  } catch {
    // ignore install failure per agent
  }

  return false;
}

const NPX_SWARM_CMD = `npx -y ${SWARM_PACKAGE}@latest`;

async function registerMcpForAgent(agent: AgentCli): Promise<boolean> {
  try {
    if (agent === 'claude') {
      await execAsync(`claude mcp add --scope user Swarm ${NPX_SWARM_CMD}`);
      return true;
    }
    if (agent === 'codex') {
      await execAsync(`codex mcp add Swarm ${NPX_SWARM_CMD}`);
      return true;
    }
    if (agent === 'gemini') {
      await execAsync(`gemini mcp add Swarm ${NPX_SWARM_CMD}`);
      return true;
    }
  } catch {
    // fallthrough
  }
  return false;
}

export async function enableSwarm(
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  await enableSwarmForAgents(['claude', 'codex', 'gemini'], context, onUpdate);
}

export async function enableSwarmForAgent(
  agent: AgentCli,
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  await enableSwarmForAgents([agent], context, onUpdate);
}

async function enableSwarmForAgents(
  agents: AgentCli[],
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  const sendStatus = async () => {
    if (onUpdate) {
      onUpdate(await getSwarmStatus());
    }
  };

  // Install slash commands for requested agents
  const installedCommands: string[] = [];
  for (const agent of agents) {
    if (installSwarmCommandForAgent(agent, context)) {
      installedCommands.push(agent.charAt(0).toUpperCase() + agent.slice(1));
    }
  }

  // Check if already enabled for all requested agents
  const status = await getSwarmStatus();
  const allReady = agents.every((a) => {
    const s = status.agents[a];
    return s.cliAvailable ? (s.mcpEnabled && s.commandInstalled) : false;
  });
  if (allReady) {
    await sendStatus();
    if (installedCommands.length > 0) {
      vscode.window.showInformationMessage(`Swarm commands updated for ${installedCommands.join(', ')}.`);
    } else {
      vscode.window.showInformationMessage('Swarm is already enabled.');
    }
    return;
  }

  // Register MCP using npx (no local install needed - npx fetches on demand)
  try {
    const registrations: string[] = [];

    for (const agent of agents) {
      const ok = await registerMcpForAgent(agent);
      if (ok) {
        registrations.push(agent.charAt(0).toUpperCase() + agent.slice(1));
      }
      await sendStatus();
    }

    if (registrations.length === 0) {
      vscode.window.showWarningMessage('Could not register Swarm MCP with selected CLIs. Make sure Claude/Codex/Gemini CLIs are installed.');
    } else {
      vscode.window.showInformationMessage(`Swarm MCP registered for: ${registrations.join(', ')}. Reload your IDE agents.`);
    }
    await sendStatus();
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to enable swarm: ${error.stderr || error.message}`);
    await sendStatus();
  }
}

// Types for task listing
export interface AgentMeta {
  agent_id: string;
  task_name: string;
  agent_type: string;
  prompt: string;
  cwd: string | null;
  mode: string;
  pid: number | null;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface AgentDetail {
  agent_id: string;
  agent_type: string;
  status: string;
  duration: string | null;
  started_at: string;
  completed_at: string | null;
  prompt: string;
  cwd: string | null;
  files_created: string[];
  files_modified: string[];
  files_deleted: string[];
  bash_commands: string[];
  last_messages: string[];
}

export interface TaskSummary {
  task_name: string;
  agent_count: number;
  status_counts: { running: number; completed: number; failed: number; stopped: number };
  latest_activity: string;
  agents: AgentDetail[];
}

// Calculate duration string from dates
function calcDuration(startedAt: Date, completedAt: Date | null, status: string): string | null {
  let seconds: number | null = null;

  if (completedAt) {
    seconds = (completedAt.getTime() - startedAt.getTime()) / 1000;
  } else if (status === 'running') {
    seconds = (Date.now() - startedAt.getTime()) / 1000;
  } else if (status === 'completed') {
    // Completed without an end time recorded; avoid inflating duration.
    return null;
  }

  if (seconds === null || seconds < 0) {
    return null;
  }

  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    const rounded = Math.max(1, Math.round(minutes));
    return `${rounded}m`;
  }

  const hours = minutes / 60;
  if (hours < 48) {
    const rounded = hours >= 10 ? Math.round(hours) : Number(hours.toFixed(1));
    return `${rounded}h`;
  }

  const days = hours / 24;
  const roundedDays = days >= 10 ? Math.round(days) : Number(days.toFixed(1));
  return `${roundedDays}d`;
}

// Parse stdout.log to extract file operations and commands
function parseAgentLog(logPath: string): {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  bashCommands: string[];
  lastMessages: string[];
} {
  const result = {
    filesCreated: [] as string[],
    filesModified: [] as string[],
    filesDeleted: [] as string[],
    bashCommands: [] as string[],
    lastMessages: [] as string[],
  };

  if (!fs.existsSync(logPath)) {
    return result;
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        // Handle different event formats
        // Claude format
        if (event.type === 'tool_use' || event.type === 'tool') {
          const toolName = event.tool || event.name || '';
          const input = event.input || event.content?.input || {};

          if (toolName === 'Write' && input.file_path) {
            result.filesCreated.push(input.file_path);
          } else if (toolName === 'Edit' && input.file_path) {
            result.filesModified.push(input.file_path);
          } else if (toolName === 'Bash' && input.command) {
            const cmd = input.command.length > 80
              ? input.command.substring(0, 77) + '...'
              : input.command;
            result.bashCommands.push(cmd);
          }
        }

        // Codex/Cursor format
        if (event.type === 'function_call') {
          const name = event.name || '';
          const args = typeof event.arguments === 'string'
            ? JSON.parse(event.arguments)
            : event.arguments || {};

          if (name === 'write_file' && args.path) {
            result.filesCreated.push(args.path);
          } else if (name === 'edit_file' && args.path) {
            result.filesModified.push(args.path);
          } else if (name === 'shell' && args.command) {
            const cmd = args.command.length > 80
              ? args.command.substring(0, 77) + '...'
              : args.command;
            result.bashCommands.push(cmd);
          }
        }

        // Collect assistant messages
        if (event.type === 'assistant' || event.type === 'message' || event.role === 'assistant') {
          const text = event.content || event.text || event.message || '';
          if (typeof text === 'string' && text.trim()) {
            const truncated = text.length > 200 ? text.substring(0, 197) + '...' : text;
            messages.push(truncated);
          }
        }

        // Streamed deltas (Claude/Codex) often arrive as text_delta/content_block_delta
        if (event.delta?.text) {
          const text = String(event.delta.text);
          if (text.trim()) {
            const truncated = text.length > 200 ? text.substring(0, 197) + '...' : text;
            messages.push(truncated);
          }
        }

        if (Array.isArray(event.content)) {
          for (const block of event.content) {
            if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              const truncated = block.text.length > 200
                ? block.text.substring(0, 197) + '...'
                : block.text;
              messages.push(truncated);
            }
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Get last 3 messages
    result.lastMessages = messages.slice(-3);
  } catch {
    // Ignore read errors
  }

  return result;
}

// Fetch all tasks from the agent-swarm directory
export async function fetchTasks(limit?: number): Promise<TaskSummary[]> {
  if (!fs.existsSync(AGENT_SWARM_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(AGENT_SWARM_DIR);
  const taskMap = new Map<string, AgentDetail[]>();
  const taskTimes = new Map<string, Date>();

  for (const agentId of entries) {
    const agentDir = path.join(AGENT_SWARM_DIR, agentId);
    const metaPath = path.join(agentDir, 'meta.json');
    const logPath = path.join(agentDir, 'stdout.log');

    if (!fs.existsSync(metaPath)) continue;

    try {
      const metaContent = fs.readFileSync(metaPath, 'utf-8');
      const meta: AgentMeta = JSON.parse(metaContent);

      const startedAt = new Date(meta.started_at);
      const completedAt = meta.completed_at ? new Date(meta.completed_at) : null;
      const logData = parseAgentLog(logPath);

      const detail: AgentDetail = {
        agent_id: meta.agent_id,
        agent_type: meta.agent_type,
        status: meta.status,
        duration: calcDuration(startedAt, completedAt, meta.status),
        started_at: meta.started_at,
        completed_at: meta.completed_at,
        prompt: meta.prompt.length > 150 ? meta.prompt.substring(0, 147) + '...' : meta.prompt,
        cwd: meta.cwd,
        files_created: [...new Set(logData.filesCreated)],
        files_modified: [...new Set(logData.filesModified)],
        files_deleted: [...new Set(logData.filesDeleted)],
        bash_commands: logData.bashCommands.slice(-10),
        last_messages: logData.lastMessages,
      };

      const existing = taskMap.get(meta.task_name) || [];
      existing.push(detail);
      taskMap.set(meta.task_name, existing);

      // Track latest activity time for task
      const activityTime = completedAt || startedAt;
      const currentLatest = taskTimes.get(meta.task_name);
      if (!currentLatest || activityTime > currentLatest) {
        taskTimes.set(meta.task_name, activityTime);
      }
    } catch {
      // Skip invalid entries
    }
  }

  // Build task summaries
  const tasks: TaskSummary[] = [];
  for (const [taskName, agents] of taskMap) {
    const statusCounts = { running: 0, completed: 0, failed: 0, stopped: 0 };
    for (const agent of agents) {
      if (agent.status === 'running') statusCounts.running++;
      else if (agent.status === 'completed') statusCounts.completed++;
      else if (agent.status === 'failed') statusCounts.failed++;
      else if (agent.status === 'stopped') statusCounts.stopped++;
    }

    // Sort agents by started_at (most recent first)
    agents.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    tasks.push({
      task_name: taskName,
      agent_count: agents.length,
      status_counts: statusCounts,
      latest_activity: (taskTimes.get(taskName) || new Date()).toISOString(),
      agents,
    });
  }

  // Sort tasks by latest activity (most recent first)
  tasks.sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());

  return limit ? tasks.slice(0, limit) : tasks;
}
