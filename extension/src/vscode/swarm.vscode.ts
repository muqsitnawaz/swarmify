// Swarm MCP configuration - VS Code dependent functions

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  AgentCli,
  PromptPackAgent,
  isAgentCliAvailable,
  isAgentMcpEnabled,
  isAgentCommandInstalled,
  getAgentCommandPath,
  getPromptPackCommandPath,
  isPromptPackTargetAvailable,
  isPromptPackInstalled,
} from '../core/swarm.detect';

// Re-export for consumers that need the union type
export type { AgentCli } from '../core/swarm.detect';
export type { PromptPackAgent } from '../core/swarm.detect';

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
    trae: AgentInstallStatus;
  };
}

export type SkillName =
  | 'plan'
  | 'splan'
  | 'debug'
  | 'sdebug'
  | 'sconfirm'
  | 'clean'
  | 'sclean'
  | 'test'
  | 'stest'
  | 'ship'
  | 'sship'
  | 'recap'
  | 'srecap'
  | 'simagine';

export interface SkillDefinition {
  name: SkillName;
  description: string;
  assets: {
    claude?: string | 'builtin';
    codex?: string;
    cursor?: string;
    gemini?: string;
  };
}

export interface SkillAgentStatus {
  installed: boolean;
  cliAvailable: boolean;
  builtIn: boolean;
  supported: boolean;
}

export interface SkillsStatus {
  commands: Array<{
    name: SkillName;
    description: string;
    agents: Record<PromptPackAgent, SkillAgentStatus>;
  }>;
}

const SKILL_DEFS: SkillDefinition[] = [
  {
    name: 'plan',
    description: 'Create a concise implementation plan',
    assets: { claude: 'builtin', codex: 'plan.md', gemini: 'plan.toml' },
  },
  {
    name: 'splan',
    description: 'Sprint-sized plan with parallel steps',
    assets: { claude: 'splan.md', codex: 'splan.md', cursor: 'splan.md', gemini: 'splan.toml' },
  },
  {
    name: 'debug',
    description: 'Diagnose the root cause before fixing',
    assets: { claude: 'debug.md', codex: 'debug.md', cursor: 'debug.md', gemini: 'debug.toml' },
  },
  {
    name: 'sdebug',
    description: 'Parallelize the debugging investigation',
    assets: { claude: 'sdebug.md', codex: 'sdebug.md', cursor: 'sdebug.md', gemini: 'sdebug.toml' },
  },
  {
    name: 'sconfirm',
    description: 'Confirm with parallel checks',
    assets: { claude: 'sconfirm.md', codex: 'sconfirm.md', cursor: 'sconfirm.md', gemini: 'sconfirm.toml' },
  },
  {
    name: 'clean',
    description: 'Refactor safely for clarity',
    assets: { claude: 'clean.md', codex: 'clean.md', cursor: 'clean.md', gemini: 'clean.toml' },
  },
  {
    name: 'sclean',
    description: 'Parallel refactor plan',
    assets: { claude: 'sclean.md', codex: 'sclean.md', cursor: 'sclean.md', gemini: 'sclean.toml' },
  },
  {
    name: 'test',
    description: 'Design a lean test plan',
    assets: { claude: 'test.md', codex: 'test.md', cursor: 'test.md', gemini: 'test.toml' },
  },
  {
    name: 'stest',
    description: 'Parallelize test creation',
    assets: { claude: 'stest.md', codex: 'stest.md', cursor: 'stest.md', gemini: 'stest.toml' },
  },
  {
    name: 'ship',
    description: 'Pre-launch verification',
    assets: { claude: 'ship.md', codex: 'ship.md', cursor: 'ship.md', gemini: 'ship.toml' },
  },
  {
    name: 'sship',
    description: 'Ship with independent assessment',
    assets: { claude: 'sship.md', codex: 'sship.md', cursor: 'sship.md', gemini: 'sship.toml' },
  },
  {
    name: 'recap',
    description: 'Facts + grounded hypotheses for handoff',
    assets: { claude: 'recap.md', codex: 'recap.md', cursor: 'recap.md', gemini: 'recap.toml' },
  },
  {
    name: 'srecap',
    description: 'Agents investigate gaps before handoff',
    assets: { claude: 'srecap.md', codex: 'srecap.md', cursor: 'srecap.md', gemini: 'srecap.toml' },
  },
  {
    name: 'simagine',
    description: 'Swarm visual asset prompting',
    assets: { codex: 'simagine.md' },
  },
];

// Get full swarm integration status (per-agent, not globally shared)
export async function getSwarmStatus(): Promise<SwarmStatus> {
  const claudeCliAvailable = await isAgentCliAvailable('claude');
  const codexCliAvailable = await isAgentCliAvailable('codex');
  const geminiCliAvailable = await isAgentCliAvailable('gemini');
  const traeCliAvailable = await isAgentCliAvailable('trae');

  const claudeMcp = claudeCliAvailable ? await isAgentMcpEnabled('claude') : false;
  const codexMcp = codexCliAvailable ? await isAgentMcpEnabled('codex') : false;
  const geminiMcp = geminiCliAvailable ? await isAgentMcpEnabled('gemini') : false;
  const traeMcp = traeCliAvailable ? await isAgentMcpEnabled('trae') : false;

  const claudeCmd = claudeCliAvailable ? isAgentCommandInstalled('claude', 'swarm') : false;
  const codexCmd = codexCliAvailable ? isAgentCommandInstalled('codex', 'swarm') : false;
  const geminiCmd = geminiCliAvailable ? isAgentCommandInstalled('gemini', 'swarm') : false;
  const traeCmd = traeCliAvailable ? isAgentCommandInstalled('trae', 'swarm') : false;

  const mcpEnabled = (!claudeCliAvailable || claudeMcp) &&
    (!codexCliAvailable || codexMcp) &&
    (!geminiCliAvailable || geminiMcp) &&
    (!traeCliAvailable || traeMcp);

  const commandInstalled = (!claudeCliAvailable || claudeCmd) &&
    (!codexCliAvailable || codexCmd) &&
    (!geminiCliAvailable || geminiCmd) &&
    (!traeCliAvailable || traeCmd);

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
      trae: {
        installed: traeMcp && traeCmd && traeCliAvailable,
        cliAvailable: traeCliAvailable,
        mcpEnabled: traeMcp,
        commandInstalled: traeCmd,
      },
    },
  };
}

// Check if swarm is fully enabled (MCP registered and commands installed)
export async function isSwarmEnabled(): Promise<boolean> {
  const status = await getSwarmStatus();
  return status.mcpEnabled && status.commandInstalled;
}

export async function getSkillsStatus(): Promise<SkillsStatus> {
  const results: SkillsStatus['commands'] = [];

  const availability = {
    claude: await isPromptPackTargetAvailable('claude'),
    codex: await isPromptPackTargetAvailable('codex'),
    gemini: await isPromptPackTargetAvailable('gemini'),
    cursor: await isPromptPackTargetAvailable('cursor'),
  };

  for (const skill of SKILL_DEFS) {
    const claudeAsset = skill.assets.claude;
    const codexAsset = skill.assets.codex;
    const cursorAsset = skill.assets.cursor;
    const geminiAsset = skill.assets.gemini;

    const agents: Record<PromptPackAgent, SkillAgentStatus> = {
      claude: {
        cliAvailable: availability.claude,
        builtIn: claudeAsset === 'builtin',
        supported: !!claudeAsset,
        installed:
          claudeAsset === 'builtin' ||
          (!!claudeAsset && availability.claude && isPromptPackInstalled('claude', skill.name)),
      },
      codex: {
        cliAvailable: availability.codex,
        builtIn: false,
        supported: !!codexAsset,
        installed: !!codexAsset && availability.codex && isPromptPackInstalled('codex', skill.name),
      },
      cursor: {
        cliAvailable: availability.cursor,
        builtIn: false,
        supported: !!cursorAsset,
        installed: !!cursorAsset && availability.cursor && isPromptPackInstalled('cursor', skill.name),
      },
      gemini: {
        cliAvailable: availability.gemini,
        builtIn: false,
        supported: !!geminiAsset,
        installed: !!geminiAsset && availability.gemini && isPromptPackInstalled('gemini', skill.name),
      },
    };

    results.push({ name: skill.name, description: skill.description, agents });
  }

  return { commands: results };
}

export async function installSkillCommand(
  skill: SkillName,
  agent: PromptPackAgent,
  context: vscode.ExtensionContext
): Promise<boolean> {
  const def = SKILL_DEFS.find(s => s.name === skill);
  if (!def) return false;

  const assetName = def.assets[agent];
  if (!assetName) {
    vscode.window.showWarningMessage(`${skill} is not available for ${agent}.`);
    return false;
  }
  if (assetName === 'builtin') return true;

  const targetAvailable = await isPromptPackTargetAvailable(agent);
  if (!targetAvailable) {
    vscode.window.showWarningMessage(`${agent} not found. Install it first.`);
    return false;
  }

  const agentDir = agent === 'codex' ? 'prompts' : 'commands';
  const source = path.join(context.extensionPath, '..', 'prompts', agent, agentDir, assetName);
  if (!fs.existsSync(source)) {
    vscode.window.showErrorMessage(`Missing skill asset: ${assetName}`);
    return false;
  }

  const target = getPromptPackCommandPath(agent, skill);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return true;
  } catch (err) {
    const error = err as Error;
    vscode.window.showErrorMessage(`Failed to install ${skill} for ${agent}: ${error.message}`);
    return false;
  }
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

async function installPromptPacksForAgent(
  agent: PromptPackAgent,
  context: vscode.ExtensionContext
): Promise<string[]> {
  const installed: string[] = [];
  const targetAvailable = await isPromptPackTargetAvailable(agent);
  if (!targetAvailable) {
    return installed;
  }

  for (const skill of SKILL_DEFS) {
    const assetName = skill.assets[agent];
    if (!assetName || assetName === 'builtin') {
      continue;
    }

    const agentDir = agent === 'codex' ? 'prompts' : 'commands';
  const source = path.join(context.extensionPath, '..', 'prompts', agent, agentDir, assetName);
    if (!fs.existsSync(source)) {
      vscode.window.showErrorMessage(`Missing skill asset: ${assetName}`);
      continue;
    }

    if (isPromptPackInstalled(agent, skill.name)) {
      continue;
    }

    const target = getPromptPackCommandPath(agent, skill.name);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      installed.push(skill.name);
    } catch (err) {
      const error = err as Error;
      vscode.window.showErrorMessage(`Failed to install ${skill.name} for ${agent}: ${error.message}`);
    }
  }

  return installed;
}

// Install /swarm command for a specific agent
function installSwarmCommandForAgent(agent: AgentCli, context: vscode.ExtensionContext): boolean {
  const agentDir = agent === 'codex' ? 'prompts' : 'commands';
  const sourcePath = path.join(context.extensionPath, '..', 'prompts', agent, agentDir, 'swarm.md');
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

function installSwarmCommandForPromptPackAgent(agent: PromptPackAgent, context: vscode.ExtensionContext): boolean {
  const agentDir = agent === 'codex' ? 'prompts' : 'commands';
  const extension = agent === 'gemini' ? 'toml' : 'md';
  const sourcePath = path.join(context.extensionPath, '..', 'prompts', agent, agentDir, `swarm.${extension}`);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const target = getPromptPackCommandPath(agent, 'swarm');
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sourcePath, target);
    return true;
  } catch {
    return false;
  }
}

const NPX_SWARM_CMD = `npx -y ${SWARM_PACKAGE}@latest`;

// CLI npm packages for each agent (trae uses uv/pip, not npm)
const CLI_PACKAGES: Record<AgentCli, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
  trae: '', // trae uses git clone + uv, not npm
};

// Install CLI globally if not present
async function installCliIfMissing(agent: AgentCli): Promise<boolean> {
  // Check if CLI is available
  const cliCommand = agent === 'trae' ? 'trae-cli' : agent;
  try {
    await execAsync(`which ${cliCommand}`);
    return true; // Already installed
  } catch {
    // Not installed, proceed with installation
  }

  const pkg = CLI_PACKAGES[agent];
  const agentName = agent.charAt(0).toUpperCase() + agent.slice(1);

  // Trae uses pipx to install from git (not npm), requires Python 3.12+
  if (agent === 'trae') {
    try {
      // First check if pipx is available
      try {
        await execAsync('python3 -m pipx --version');
      } catch {
        vscode.window.showInformationMessage('Installing pipx...');
        await execAsync('pip install --user pipx && python3 -m pipx ensurepath');
      }

      // Check for Python 3.12+
      let python312Path = '';
      try {
        // Try common Python 3.12 locations
        const { stdout } = await execAsync('python3.12 --version 2>/dev/null && which python3.12 || pyenv versions --bare | grep "^3\\.12" | head -1 | xargs -I{} echo "$HOME/.pyenv/versions/{}/bin/python"');
        python312Path = stdout.trim().split('\n').pop() || '';
      } catch {
        // Fallback: check if default python3 is 3.12+
        try {
          const { stdout } = await execAsync('python3 -c "import sys; print(sys.version_info >= (3, 12))"');
          if (stdout.trim() === 'True') {
            python312Path = 'python3';
          }
        } catch { /* ignore */ }
      }

      if (!python312Path) {
        vscode.window.showErrorMessage('Trae requires Python 3.12+. Please install Python 3.12 or later.');
        return false;
      }

      vscode.window.showInformationMessage(`Installing ${agentName} CLI via pipx (requires Python 3.12+)...`);
      const pythonFlag = python312Path !== 'python3' ? `--python ${python312Path}` : '';
      await execAsync(`python3 -m pipx install ${pythonFlag} "trae-agent[evaluation] @ git+https://github.com/bytedance/trae-agent.git"`);
      vscode.window.showInformationMessage(`${agentName} CLI installed successfully.`);
      return true;
    } catch (err) {
      const error = err as Error & { stderr?: string };
      vscode.window.showErrorMessage(`Failed to install ${agentName} CLI: ${error.stderr || error.message}`);
      return false;
    }
  }

  // Other agents use npm
  try {
    vscode.window.showInformationMessage(`Installing ${agentName} CLI...`);
    await execAsync(`npm install -g ${pkg}`);
    vscode.window.showInformationMessage(`${agentName} CLI installed successfully.`);
    return true;
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to install ${agentName} CLI: ${error.stderr || error.message}`);
    return false;
  }
}

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
    if (agent === 'trae') {
      // Trae may not support MCP yet - skip for now
      // When supported: await execAsync(`trae-cli mcp add Swarm ${NPX_SWARM_CMD}`);
      return true;
    }
  } catch {
    // fallthrough
  }
  return false;
}

export async function setupSwarmIntegration(
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  await setupSwarmIntegrationForAgents(['claude', 'codex', 'gemini', 'trae'], context, onUpdate);
}

export async function setupSwarmIntegrationForAgent(
  agent: AgentCli,
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  await setupSwarmIntegrationForAgents([agent], context, onUpdate);
}

export async function installCommandPack(context: vscode.ExtensionContext): Promise<void> {
  const promptPackAgents: PromptPackAgent[] = ['claude', 'codex', 'gemini', 'cursor'];
  for (const agent of promptPackAgents) {
    installSwarmCommandForPromptPackAgent(agent, context);
    await installPromptPacksForAgent(agent, context);
  }
}

async function setupSwarmIntegrationForAgents(
  agents: AgentCli[],
  context: vscode.ExtensionContext,
  onUpdate?: (status: SwarmStatus) => void
): Promise<void> {
  const sendStatus = async () => {
    if (onUpdate) {
      onUpdate(await getSwarmStatus());
    }
  };

  // Install /swarm slash commands for requested agents
  const installedCommands: string[] = [];
  for (const agent of agents) {
    if (installSwarmCommandForAgent(agent, context)) {
      installedCommands.push(agent.charAt(0).toUpperCase() + agent.slice(1));
    }
  }

  // Install prompt packs for requested agents (trae doesn't support prompt packs)
  for (const agent of agents) {
    if (agent !== 'trae') {
      await installPromptPacksForAgent(agent, context);
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

  // Install CLIs if missing
  const installableAgents: AgentCli[] = [];
  for (const agent of agents) {
    const installed = await installCliIfMissing(agent);
    if (installed) {
      installableAgents.push(agent);
    }
    await sendStatus();
  }

  if (installableAgents.length === 0) {
    vscode.window.showErrorMessage('Could not install any CLI. Check npm permissions.');
    return;
  }

  // Register MCP using npx (no local install needed - npx fetches on demand)
  try {
    const registrations: string[] = [];

    for (const agent of installableAgents) {
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

interface SwarmStatusAgent {
  agent_id?: string;
  agentId?: string;
  task_name?: string;
  taskName?: string;
  agent_type?: string;
  agentType?: string;
  status?: string;
  started_at?: string;
  startedAt?: string;
  completed_at?: string | null;
  completedAt?: string | null;
  duration?: string | null;
  prompt?: string;
  cwd?: string | null;
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

function normalizeSwarmStatusAgents(response: unknown): SwarmStatusAgent[] {
  if (!response) return [];

  if (Array.isArray(response)) {
    return response as SwarmStatusAgent[];
  }

  if (typeof response === 'object') {
    const asRecord = response as Record<string, unknown>;
    if (Array.isArray(asRecord.agents)) {
      return asRecord.agents as SwarmStatusAgent[];
    }
    if (Array.isArray(asRecord.items)) {
      return asRecord.items as SwarmStatusAgent[];
    }
    if (Array.isArray(asRecord.data)) {
      return asRecord.data as SwarmStatusAgent[];
    }
    if (Array.isArray(asRecord.tasks)) {
      const tasks = asRecord.tasks as Array<Record<string, unknown>>;
      const flattened: SwarmStatusAgent[] = [];
      for (const task of tasks) {
        const taskName = (task.task_name || task.taskName) as string | undefined;
        const agents = Array.isArray(task.agents) ? (task.agents as SwarmStatusAgent[]) : [];
        for (const agent of agents) {
          flattened.push({ ...agent, task_name: agent.task_name || taskName });
        }
      }
      return flattened;
    }
  }

  return [];
}

function buildTaskSummariesFromAgents(agents: SwarmStatusAgent[]): TaskSummary[] {
  const taskMap = new Map<string, AgentDetail[]>();
  const taskTimes = new Map<string, Date>();

  for (const agent of agents) {
    const taskName = agent.task_name || agent.taskName;
    if (!taskName) continue;

    const status = agent.status ?? 'unknown';
    const startedAtRaw = agent.started_at || agent.startedAt;
    const completedAtRaw = agent.completed_at ?? agent.completedAt ?? null;
    const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
    const completedAt = completedAtRaw ? new Date(completedAtRaw) : null;

    const detail: AgentDetail = {
      agent_id: agent.agent_id || agent.agentId || 'unknown',
      agent_type: agent.agent_type || agent.agentType || 'unknown',
      status,
      duration: agent.duration ?? (startedAt ? calcDuration(startedAt, completedAt, status) : null),
      started_at: startedAtRaw || new Date().toISOString(),
      completed_at: completedAtRaw ?? null,
      prompt: agent.prompt ? (agent.prompt.length > 150 ? agent.prompt.substring(0, 147) + '...' : agent.prompt) : '',
      cwd: agent.cwd ?? null,
      files_created: [],
      files_modified: [],
      files_deleted: [],
      bash_commands: [],
      last_messages: [],
    };

    const existing = taskMap.get(taskName) || [];
    existing.push(detail);
    taskMap.set(taskName, existing);

    const activityTime = completedAt && !Number.isNaN(completedAt.getTime())
      ? completedAt
      : startedAt && !Number.isNaN(startedAt.getTime())
        ? startedAt
        : new Date();
    const currentLatest = taskTimes.get(taskName);
    if (!currentLatest || activityTime > currentLatest) {
      taskTimes.set(taskName, activityTime);
    }
  }

  const tasks: TaskSummary[] = [];
  for (const [taskName, taskAgents] of taskMap) {
    const statusCounts = { running: 0, completed: 0, failed: 0, stopped: 0 };
    for (const agent of taskAgents) {
      if (agent.status === 'running') statusCounts.running++;
      else if (agent.status === 'completed') statusCounts.completed++;
      else if (agent.status === 'failed') statusCounts.failed++;
      else if (agent.status === 'stopped') statusCounts.stopped++;
    }

    taskAgents.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    tasks.push({
      task_name: taskName,
      agent_count: taskAgents.length,
      status_counts: statusCounts,
      latest_activity: (taskTimes.get(taskName) || new Date()).toISOString(),
      agents: taskAgents,
    });
  }

  tasks.sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());
  return tasks;
}

export async function fetchTasksBySession(sessionId: string): Promise<TaskSummary[]> {
  if (!sessionId) return [];

  const argsJson = JSON.stringify({ parent_session_id: sessionId });
  const safeArgs = argsJson.replace(/'/g, `'\\''`);
  const agents: AgentCli[] = ['claude', 'codex', 'gemini'];

  for (const agent of agents) {
    try {
      const { stdout } = await execAsync(
        `${agent} mcp call Swarm status --args '${safeArgs}'`,
        { timeout: 15000 }
      );

      const response = JSON.parse(stdout.trim());
      const statusAgents = normalizeSwarmStatusAgents(response);
      return buildTaskSummariesFromAgents(statusAgents);
    } catch {
      // Try next agent
    }
  }

  return [];
}

// Fetch all tasks from the agent-swarm directory
export async function fetchTasks(limit?: number, filterCwd?: string): Promise<TaskSummary[]> {
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

      // Filter by workspace cwd if specified
      if (filterCwd && meta.cwd !== filterCwd) continue;

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
