import { spawn, execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { AgentProcess, AgentStatus, getAgentsDir, checkCliAvailable } from './agents.js';
import { AgentType } from './parsers.js';

// Cloud mode supported agents and their providers
// Claude: `claude --remote -p "prompt"` creates a web session on claude.ai
// Codex: `codex cloud exec --env <env> "prompt"` creates a cloud task
// Cursor: no CLI cloud mode (background agents are IDE-only)
const CLOUD_SUPPORTED_AGENTS: AgentType[] = ['claude', 'codex'];

const CLOUD_PROVIDER_MAP: Partial<Record<AgentType, string>> = {
  claude: 'anthropic',
  codex: 'openai',
};

export function isCloudSupported(agentType: AgentType): boolean {
  return CLOUD_SUPPORTED_AGENTS.includes(agentType);
}

export function getCloudSupportedAgents(): AgentType[] {
  return [...CLOUD_SUPPORTED_AGENTS];
}

// Spawn a Claude cloud agent using `claude --remote`
// This creates a web session on claude.ai that runs in Anthropic's cloud VMs.
// The local process streams events to stdout which we capture.
async function spawnClaudeCloud(
  prompt: string,
  model: string,
  cwd: string | null,
  stdoutFd: number
): Promise<{ pid: number | null }> {
  const cmd = [
    'claude',
    '--remote',
    '-p',
    prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
  ];

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  cmd.push('--settings', settingsPath);
  if (cwd) {
    cmd.push('--add-dir', cwd);
  }

  const childProcess = spawn(cmd[0], cmd.slice(1), {
    stdio: ['ignore', stdoutFd, stdoutFd],
    cwd: cwd || undefined,
    detached: true,
    env: { ...process.env, CLAUDECODE: '' },
  });
  childProcess.unref();

  return { pid: childProcess.pid || null };
}

// Spawn a Codex cloud agent using `codex cloud exec`
// This creates a cloud task that runs in OpenAI's isolated containers.
// We capture the task ID and poll status separately.
async function spawnCodexCloud(
  prompt: string,
  cwd: string | null,
  stdoutFd: number,
  envId?: string
): Promise<{ pid: number | null; cloudTaskId: string | null }> {
  // Codex cloud exec requires --env. If not provided, try to detect.
  const resolvedEnvId = envId || await detectCodexEnv();
  if (!resolvedEnvId) {
    throw new Error(
      'Codex cloud requires an environment ID. Set up an environment at chatgpt.com/codex or pass env_id.'
    );
  }

  const cmd = [
    'codex', 'cloud', 'exec',
    '--env', resolvedEnvId,
    prompt,
  ];

  const childProcess = spawn(cmd[0], cmd.slice(1), {
    stdio: ['ignore', stdoutFd, stdoutFd],
    cwd: cwd || undefined,
    detached: true,
  });
  childProcess.unref();

  return { pid: childProcess.pid || null, cloudTaskId: null };
}

// Try to detect an available codex cloud environment
async function detectCodexEnv(): Promise<string | null> {
  try {
    const output = execSync('codex cloud list --json --limit 1', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const parsed = JSON.parse(output);
    const tasks = parsed?.tasks || [];
    if (tasks.length > 0 && tasks[0].environment_id) {
      return tasks[0].environment_id;
    }
  } catch {}
  return null;
}

export async function spawnCloudAgent(
  taskName: string,
  agentType: AgentType,
  prompt: string,
  cwd: string | null,
  model: string,
  parentSessionId: string | null,
  workspaceDir: string | null,
  agentsDir?: string
): Promise<AgentProcess> {
  if (!isCloudSupported(agentType)) {
    throw new Error(
      `Cloud mode is not supported for ${agentType}. Supported agents: ${CLOUD_SUPPORTED_AGENTS.join(', ')}`
    );
  }

  const [available, pathOrError] = checkCliAvailable(agentType);
  if (!available) {
    throw new Error(pathOrError || `CLI tool for ${agentType} not found`);
  }

  let resolvedCwd: string | null = null;
  if (cwd) {
    resolvedCwd = path.resolve(cwd);
    const stat = await fs.stat(resolvedCwd).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Working directory does not exist or is not a directory: ${cwd}`);
    }
  }

  const baseDir = agentsDir || await getAgentsDir();
  const agentId = randomUUID().substring(0, 8);

  const agent = new AgentProcess(
    agentId,
    taskName,
    agentType,
    prompt,
    resolvedCwd,
    'cloud',
    null,
    AgentStatus.RUNNING,
    new Date(),
    null,
    baseDir,
    parentSessionId,
    workspaceDir,
    null,
    CLOUD_PROVIDER_MAP[agentType] || null,
    null
  );

  const agentDir = await agent.getAgentDir();
  await fs.mkdir(agentDir, { recursive: true });

  console.error(`[cloud] Spawning ${agentType} cloud agent ${agentId}...`);

  try {
    const stdoutPath = await agent.getStdoutPath();
    const stdoutFile = await fs.open(stdoutPath, 'w');

    if (agentType === 'claude') {
      const result = await spawnClaudeCloud(prompt, model, resolvedCwd, stdoutFile.fd);
      agent.pid = result.pid;
    } else if (agentType === 'codex') {
      const result = await spawnCodexCloud(prompt, resolvedCwd, stdoutFile.fd);
      agent.pid = result.pid;
      if (result.cloudTaskId) {
        agent.cloudSessionId = result.cloudTaskId;
      }
    }

    await stdoutFile.close().catch(() => {});
    await agent.saveMeta();
  } catch (err: any) {
    try {
      await fs.rm(agentDir, { recursive: true });
    } catch {}
    throw new Error(`Failed to spawn cloud agent: ${err.message}`);
  }

  console.error(`[cloud] Spawned ${agentType} cloud agent ${agentId} with PID ${agent.pid}`);
  return agent;
}

// Poll codex cloud task status and write results to stdout.log
export async function pollCodexCloudStatus(
  cloudTaskId: string,
  stdoutPath: string
): Promise<{ status: string; prUrl: string | null }> {
  try {
    const output = execSync(`codex cloud status ${cloudTaskId}`, {
      encoding: 'utf-8',
      timeout: 15000,
    });

    await fs.appendFile(stdoutPath, output + '\n');

    const prMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    const statusMatch = output.match(/"status"\s*:\s*"(\w+)"/);

    return {
      status: statusMatch?.[1] || 'unknown',
      prUrl: prMatch?.[0] || null,
    };
  } catch {
    return { status: 'unknown', prUrl: null };
  }
}

export function extractPrUrl(events: any[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const content = event?.command || event?.content || '';
    if (typeof content !== 'string') continue;

    const prUrlMatch = content.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    if (prUrlMatch) {
      return prUrlMatch[0];
    }
  }
  return null;
}
