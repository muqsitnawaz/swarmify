// Swarm MCP configuration - VS Code dependent functions

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

// Agent swarm data directory
const AGENT_SWARM_DIR = path.join(os.homedir(), '.agent-swarm', 'agents');

const SWARM_PACKAGE = '@swarmify/agents-mcp';
const SWARM_BINARY = 'agents-mcp';

// Check if Swarm MCP server is configured
export async function isSwarmEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('claude mcp list');
    return stdout.includes('Swarm');
  } catch {
    return false;
  }
}

// Check if /swarm slash command is installed
export function isSwarmCommandInstalled(): boolean {
  const commandPath = path.join(os.homedir(), '.claude', 'commands', 'swarm.md');
  return fs.existsSync(commandPath);
}

export interface AgentInstallStatus {
  installed: boolean;
  cliAvailable: boolean;
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

// Check if agent CLI is available
async function isAgentCliAvailable(agentType: 'claude' | 'codex' | 'gemini'): Promise<boolean> {
  const commands: Record<string, string> = {
    claude: 'claude --version',
    codex: 'codex --version',
    gemini: 'gemini --version',
  };

  try {
    await execAsync(commands[agentType]);
    return true;
  } catch {
    return false;
  }
}

// Get full swarm integration status
export async function getSwarmStatus(): Promise<SwarmStatus> {
  const mcpEnabled = await isSwarmEnabled();
  const commandInstalled = isSwarmCommandInstalled();
  const swarmFullyInstalled = mcpEnabled && commandInstalled;

  const claudeCliAvailable = await isAgentCliAvailable('claude');
  const codexCliAvailable = await isAgentCliAvailable('codex');
  const geminiCliAvailable = await isAgentCliAvailable('gemini');

  return {
    mcpEnabled,
    commandInstalled,
    agents: {
      claude: {
        installed: swarmFullyInstalled && claudeCliAvailable,
        cliAvailable: claudeCliAvailable,
      },
      codex: {
        installed: swarmFullyInstalled && codexCliAvailable,
        cliAvailable: codexCliAvailable,
      },
      gemini: {
        installed: swarmFullyInstalled && geminiCliAvailable,
        cliAvailable: geminiCliAvailable,
      },
    },
  };
}

// Find agent-swarm binary in common locations
async function findSwarmBinary(): Promise<string | null> {
  const home = os.homedir();

  // Check common global install locations
  const candidates = [
    // Bun global
    path.join(home, '.bun', 'bin', SWARM_BINARY),
    // npm/yarn global (macOS/Linux)
    path.join(home, '.npm-global', 'bin', SWARM_BINARY),
    `/usr/local/bin/${SWARM_BINARY}`,
    // npm global (Windows)
    path.join(process.env.APPDATA || '', 'npm', `${SWARM_BINARY}.cmd`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try which/where command
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(`${cmd} ${SWARM_BINARY}`);
    const found = stdout.trim().split('\n')[0];
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {
    // Not found via which/where
  }

  return null;
}

// Check if bun is available
async function hasBun(): Promise<boolean> {
  try {
    await execAsync('bun --version');
    return true;
  } catch {
    return false;
  }
}

// Install /swarm slash command from bundled asset for all agents
function installSwarmCommands(context: vscode.ExtensionContext): { claude: boolean; codex: boolean } {
  const sourcePath = path.join(context.extensionPath, 'assets', 'swarm.md');
  if (!fs.existsSync(sourcePath)) {
    return { claude: false, codex: false };
  }

  const content = fs.readFileSync(sourcePath, 'utf-8');
  const results = { claude: false, codex: false };

  // Install for Claude (~/.claude/commands/swarm.md)
  try {
    const claudeCommandsDir = path.join(os.homedir(), '.claude', 'commands');
    const claudeTargetPath = path.join(claudeCommandsDir, 'swarm.md');
    if (!fs.existsSync(claudeCommandsDir)) {
      fs.mkdirSync(claudeCommandsDir, { recursive: true });
    }
    fs.writeFileSync(claudeTargetPath, content);
    results.claude = true;
  } catch {
    // Ignore if Claude not available
  }

  // Install for Codex (~/.codex/prompts/swarm.md)
  try {
    const codexPromptsDir = path.join(os.homedir(), '.codex', 'prompts');
    const codexTargetPath = path.join(codexPromptsDir, 'swarm.md');
    if (!fs.existsSync(codexPromptsDir)) {
      fs.mkdirSync(codexPromptsDir, { recursive: true });
    }
    fs.writeFileSync(codexTargetPath, content);
    results.codex = true;
  } catch {
    // Ignore if Codex not available
  }

  return results;
}

// Install swarm-mcp globally
async function installSwarm(): Promise<boolean> {
  const useBun = await hasBun();
  const installCmd = useBun
    ? `bun add -g ${SWARM_PACKAGE}`
    : `npm install -g ${SWARM_PACKAGE}`;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing ${SWARM_PACKAGE}...`,
        cancellable: false,
      },
      async () => {
        await execAsync(installCmd);
      }
    );
    return true;
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(
      `Failed to install ${SWARM_PACKAGE}: ${error.stderr || error.message}`
    );
    return false;
  }
}

export async function enableSwarm(context: vscode.ExtensionContext): Promise<void> {
  // Install slash commands for all agents
  const commandResults = installSwarmCommands(context);

  // Check if MCP already enabled
  if (await isSwarmEnabled()) {
    const installedCommands = [];
    if (commandResults.claude) installedCommands.push('Claude');
    if (commandResults.codex) installedCommands.push('Codex');

    if (installedCommands.length > 0) {
      vscode.window.showInformationMessage(`Swarm commands updated for ${installedCommands.join(', ')}.`);
    } else {
      vscode.window.showInformationMessage('Swarm is already enabled.');
    }
    return;
  }

  // Find or install agent-swarm
  let binaryPath = await findSwarmBinary();

  if (!binaryPath) {
    const choice = await vscode.window.showInformationMessage(
      `${SWARM_PACKAGE} is not installed. Install it now?`,
      'Install',
      'Cancel'
    );

    if (choice !== 'Install') {
      return;
    }

    const installed = await installSwarm();
    if (!installed) {
      return;
    }

    binaryPath = await findSwarmBinary();
    if (!binaryPath) {
      vscode.window.showErrorMessage(
        `Installed ${SWARM_PACKAGE} but could not find binary. Try: claude mcp add Swarm npx -y ${SWARM_PACKAGE}`
      );
      return;
    }
  }

  try {
    // Use claude mcp add to register the server
    await execAsync(`claude mcp add --scope user Swarm "${binaryPath}"`);
    vscode.window.showInformationMessage('Swarm MCP + /swarm command installed. Reload Claude Code.');
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to enable swarm: ${error.stderr || error.message}`);
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
  let seconds: number;
  if (completedAt) {
    seconds = (completedAt.getTime() - startedAt.getTime()) / 1000;
  } else if (status === 'running') {
    seconds = (Date.now() - startedAt.getTime()) / 1000;
  } else {
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
            // Truncate long messages
            const truncated = text.length > 200 ? text.substring(0, 197) + '...' : text;
            messages.push(truncated);
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
