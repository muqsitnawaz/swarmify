import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { resolveAgentsDir, type ModelOverrides } from './persistence.js';
import { normalizeEvents, AgentType } from './parsers.js';

export enum AgentStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STOPPED = 'stopped',
}

export type { AgentType } from './parsers.js';

// Base commands for plan mode (read-only, may prompt for confirmation)
export const AGENT_COMMANDS: Record<AgentType, string[]> = {
  codex: ['codex', 'exec', '--sandbox', 'workspace-write', '{prompt}', '--json'],
  cursor: ['cursor-agent', '-p', '--output-format', 'stream-json', '{prompt}'],
  gemini: ['gemini', '{prompt}', '--output-format', 'stream-json'],
  claude: ['claude', '-p', '--verbose', '{prompt}', '--output-format', 'stream-json', '--permission-mode', 'plan'],
};

// Effort level type
export type EffortLevel = 'fast' | 'default' | 'detailed';
export type EffortModelMap = Record<EffortLevel, Record<AgentType, string>>;

// Model mappings by effort level per agent type
// - fast: smallest, cheapest models for quick tasks
// - default: balanced models (implicit when effort is omitted)
// - detailed: max-capability models
export const EFFORT_MODEL_MAP: EffortModelMap = {
  fast: {
    codex: 'gpt-5.2-codex',
    gemini: 'gemini-3-flash-preview',
    claude: 'claude-haiku-4-5-20251001',
    cursor: 'composer-1',
  },
  default: {
    codex: 'gpt-5.2-codex',
    gemini: 'gemini-3-flash-preview',
    claude: 'claude-sonnet-4-5',
    cursor: 'composer-1',
  },
  detailed: {
    codex: 'gpt-5.1-codex-max',
    gemini: 'gemini-3-pro-preview',
    claude: 'claude-opus-4-5',
    cursor: 'composer-1',
  },
};

export function resolveEffortModelMap(
  base: EffortModelMap,
  overrides: ModelOverrides | null | undefined
): EffortModelMap {
  const resolved: EffortModelMap = {
    fast: { ...base.fast },
    default: { ...base.default },
    detailed: { ...base.detailed },
  };

  if (!overrides) return resolved;

  for (const [agentType, effortOverrides] of Object.entries(overrides)) {
    if (!effortOverrides) continue;
    if (!['codex', 'gemini', 'cursor', 'claude'].includes(agentType)) continue;
    const typedAgent = agentType as AgentType;
    for (const level of ['fast', 'default', 'detailed'] as const) {
      const model = effortOverrides[level];
      if (typeof model === 'string') {
        const trimmed = model.trim();
        if (trimmed) {
          resolved[level][typedAgent] = trimmed;
        }
      }
    }
  }

  return resolved;
}

// Suffix appended to all prompts to ensure agents provide a summary
const PROMPT_SUFFIX = `

When you're done, provide a brief summary of:
1. What you did (1-2 sentences)
2. Key files modified and why
3. Any important classes, functions, or components you added/changed`;

// Prefix for Claude agents in plan mode - explains the headless plan mode restrictions
const CLAUDE_PLAN_MODE_PREFIX = `You are running in HEADLESS PLAN MODE. This mode works like normal plan mode with one exception: you cannot write to ~/.claude/plans/ directory. Instead of writing a plan file, output your complete plan/response as your final message.

`;

const VALID_MODES = ['plan', 'edit', 'ralph'] as const;
type Mode = typeof VALID_MODES[number];

function normalizeModeValue(modeValue: string | null | undefined): Mode | null {
  if (!modeValue) return null;
  const normalized = modeValue.trim().toLowerCase();
  if (VALID_MODES.includes(normalized as Mode)) {
    return normalized as Mode;
  }
  return null;
}

function defaultModeFromEnv(): Mode {
  for (const envVar of ['AGENTS_MCP_MODE', 'AGENTS_MCP_DEFAULT_MODE']) {
    const rawValue = process.env[envVar];
    const parsed = normalizeModeValue(rawValue);
    if (parsed) {
      return parsed;
    }
    if (rawValue) {
      console.warn(`Invalid ${envVar}='${rawValue}'. Use 'plan' or 'edit'. Falling back to plan mode.`);
    }
  }
  return 'plan';
}

function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      const ms = numeric < 1e12 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date;
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function extractTimestamp(raw: any): Date | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [
    raw.timestamp,
    raw.time,
    raw.created_at,
    raw.createdAt,
    raw.ts,
    raw.started_at,
    raw.startedAt,
  ];

  for (const candidate of candidates) {
    const date = coerceDate(candidate);
    if (date) return date;
  }

  return null;
}

export function resolveMode(
  requestedMode: string | null | undefined,
  defaultMode: Mode = 'plan'
): Mode {
  const normalizedDefault = normalizeModeValue(defaultMode);
  if (!normalizedDefault) {
    throw new Error(`Invalid default mode '${defaultMode}'. Use 'plan' or 'edit'.`);
  }

  if (requestedMode !== null && requestedMode !== undefined) {
    const normalizedMode = normalizeModeValue(requestedMode);
    if (!normalizedMode) {
      throw new Error(`Invalid mode '${requestedMode}'. Valid modes: 'plan' (read-only) or 'edit' (can write).`);
    }
    return normalizedMode;
  }

  return normalizedDefault;
}

export function checkCliAvailable(agentType: AgentType): [boolean, string | null] {
  const cmdTemplate = AGENT_COMMANDS[agentType];
  if (!cmdTemplate) {
    return [false, `Unknown agent type: ${agentType}`];
  }

  const executable = cmdTemplate[0];
  try {
    const whichPath = execSync(`which ${executable}`, { encoding: 'utf-8' }).trim();
    return [true, whichPath];
  } catch {
    return [false, `CLI tool '${executable}' not found in PATH. Install it first.`];
  }
}

export function checkAllClis(): Record<string, { installed: boolean; path: string | null; error: string | null }> {
  const results: Record<string, { installed: boolean; path: string | null; error: string | null }> = {};
  for (const agentType of Object.keys(AGENT_COMMANDS) as AgentType[]) {
    const [available, pathOrError] = checkCliAvailable(agentType);
    if (available) {
      results[agentType] = { installed: true, path: pathOrError, error: null };
    } else {
      results[agentType] = { installed: false, path: null, error: pathOrError };
    }
  }
  return results;
}

let AGENTS_DIR: string | null = null;

export async function getAgentsDir(): Promise<string> {
  if (!AGENTS_DIR) {
    AGENTS_DIR = await resolveAgentsDir();
  }
  return AGENTS_DIR;
}

export class AgentProcess {
  agentId: string;
  taskName: string;
  agentType: AgentType;
  prompt: string;
  cwd: string | null;
  mode: Mode = 'plan';
  pid: number | null = null;
  status: AgentStatus = AgentStatus.RUNNING;
  startedAt: Date = new Date();
  completedAt: Date | null = null;
  parentSessionId: string | null = null;
  private eventsCache: any[] = [];
  private lastReadPos: number = 0;
  private baseDir: string | null = null;

  constructor(
    agentId: string,
    taskName: string,
    agentType: AgentType,
    prompt: string,
    cwd: string | null = null,
    mode: Mode = 'plan',
    pid: number | null = null,
    status: AgentStatus = AgentStatus.RUNNING,
    startedAt: Date = new Date(),
    completedAt: Date | null = null,
    baseDir: string | null = null,
    parentSessionId: string | null = null
  ) {
    this.agentId = agentId;
    this.taskName = taskName;
    this.agentType = agentType;
    this.prompt = prompt;
    this.cwd = cwd;
    this.mode = mode;
    this.pid = pid;
    this.status = status;
    this.startedAt = startedAt;
    this.completedAt = completedAt;
    this.baseDir = baseDir;
    this.parentSessionId = parentSessionId;
  }

  get isEditMode(): boolean {
    return this.mode === 'edit';
  }

  async getAgentDir(): Promise<string> {
    const base = this.baseDir || await getAgentsDir();
    return path.join(base, this.agentId);
  }

  async getStdoutPath(): Promise<string> {
    return path.join(await this.getAgentDir(), 'stdout.log');
  }

  async getMetaPath(): Promise<string> {
    return path.join(await this.getAgentDir(), 'meta.json');
  }

  toDict(): any {
    return {
      agent_id: this.agentId,
      task_name: this.taskName,
      agent_type: this.agentType,
      status: this.status,
      started_at: this.startedAt.toISOString(),
      completed_at: this.completedAt?.toISOString() || null,
      event_count: this.events.length,
      duration: this.duration(),
      mode: this.mode,
      parent_session_id: this.parentSessionId,
    };
  }

  duration(): string | null {
    let seconds: number;
    if (this.completedAt) {
      seconds = (this.completedAt.getTime() - this.startedAt.getTime()) / 1000;
    } else if (this.status === AgentStatus.RUNNING) {
      seconds = (Date.now() - this.startedAt.getTime()) / 1000;
    } else {
      return null;
    }

    if (seconds < 60) {
      return `${Math.floor(seconds)} seconds`;
    } else {
      const minutes = seconds / 60;
      return `${minutes.toFixed(1)} minutes`;
    }
  }

  get events(): any[] {
    return this.eventsCache;
  }

  /**
   * Return the latest timestamp we have seen in the agent's events.
   * Falls back to null when none are available.
   */
  private getLatestEventTime(): Date | null {
    let latest: Date | null = null;

    for (const event of this.eventsCache) {
      const ts = event?.timestamp;
      if (!ts) continue;
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) {
        if (!latest || parsed > latest) {
          latest = parsed;
        }
      }
    }

    return latest;
  }

  async readNewEvents(): Promise<void> {
    const stdoutPath = await this.getStdoutPath();
    try {
      const stats = await fs.stat(stdoutPath).catch(() => null);
      if (!stats) return;
      const fallbackTimestamp = (stats.mtime || new Date()).toISOString();

      const fd = await fs.open(stdoutPath, 'r');
      const buffer = Buffer.alloc(1024 * 1024);
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, this.lastReadPos);
      await fd.close();

      if (bytesRead === 0) return;

      const newContent = buffer.toString('utf-8', 0, bytesRead);
      this.lastReadPos += bytesRead;

      const lines = newContent.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        try {
          const rawEvent = JSON.parse(line);
          const events = normalizeEvents(this.agentType, rawEvent);
          const resolvedTimestamp = extractTimestamp(rawEvent)?.toISOString() || fallbackTimestamp;
          for (const event of events) {
            event.timestamp = resolvedTimestamp;
            this.eventsCache.push(event);

            if (event.type === 'result' || event.type === 'turn.completed' || event.type === 'thread.completed') {
              if (event.status === 'success' || event.type === 'turn.completed') {
                this.status = AgentStatus.COMPLETED;
                this.completedAt = event.timestamp ? new Date(event.timestamp) : new Date();
              } else if (event.status === 'error') {
                this.status = AgentStatus.FAILED;
                this.completedAt = event.timestamp ? new Date(event.timestamp) : new Date();
              }
            }
          }
        } catch {
          this.eventsCache.push({
            type: 'raw',
            content: line,
            timestamp: fallbackTimestamp,
          });
        }
      }
    } catch (err) {
      console.error(`Error reading events for agent ${this.agentId}:`, err);
    }
  }

  async saveMeta(): Promise<void> {
    const agentDir = await this.getAgentDir();
    await fs.mkdir(agentDir, { recursive: true });
    const meta = {
      agent_id: this.agentId,
      task_name: this.taskName,
      agent_type: this.agentType,
      prompt: this.prompt,
      cwd: this.cwd,
      mode: this.mode,
      pid: this.pid,
      status: this.status,
      started_at: this.startedAt.toISOString(),
      completed_at: this.completedAt?.toISOString() || null,
      parent_session_id: this.parentSessionId,
    };
    const metaPath = await this.getMetaPath();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  static async loadFromDisk(agentId: string, baseDir: string | null = null): Promise<AgentProcess | null> {
    const base = baseDir || await getAgentsDir();
    const agentDir = path.join(base, agentId);
    const metaPath = path.join(agentDir, 'meta.json');

    try {
      await fs.access(metaPath);
    } catch {
      return null;
    }

    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);

      const agent = new AgentProcess(
        meta.agent_id,
        meta.task_name || 'default',
        meta.agent_type,
        meta.prompt,
        meta.cwd || null,
        meta.mode === 'edit' ? 'edit' : 'plan',
        meta.pid || null,
        AgentStatus[meta.status as keyof typeof AgentStatus] || AgentStatus.RUNNING,
        new Date(meta.started_at),
        meta.completed_at ? new Date(meta.completed_at) : null,
        baseDir,
        meta.parent_session_id || null
      );
      return agent;
    } catch {
      return null;
    }
  }

  isProcessAlive(): boolean {
    if (!this.pid) return false;
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async updateStatusFromProcess(): Promise<void> {
    if (!this.pid) return;

    if (this.isProcessAlive()) {
      await this.readNewEvents();
      return;
    }

    if (this.status === AgentStatus.RUNNING) {
      const exitCode = await this.reapProcess();
      await this.readNewEvents();

      if (this.status === AgentStatus.RUNNING) {
        const fallbackCompletion =
          this.getLatestEventTime() || this.startedAt || new Date();
        if (exitCode !== null && exitCode !== 0) {
          this.status = AgentStatus.FAILED;
        } else {
          this.status = AgentStatus.COMPLETED;
        }
        this.completedAt = fallbackCompletion;
      }
    } else if (!this.completedAt) {
      await this.readNewEvents();
      const fallbackCompletion =
        this.getLatestEventTime() || this.startedAt || new Date();
      this.completedAt = fallbackCompletion;
    }

    await this.saveMeta();
  }

  private async reapProcess(): Promise<number | null> {
    if (!this.pid) return null;
    try {
      process.kill(this.pid, 0);
      return null;
    } catch {
      return 1;
    }
  }
}

export class AgentManager {
  private agents: Map<string, AgentProcess> = new Map();
  private maxAgents: number;
  private maxConcurrent: number;
  private agentsDir: string = '';
  private filterByCwd: string | null;
  private cleanupAgeDays: number;
  private defaultMode: Mode;
  private effortModelMap: EffortModelMap = EFFORT_MODEL_MAP;

  private constructorAgentsDir: string | null = null;

  constructor(
    maxAgents: number = 50,
    maxConcurrent: number = 10,
    agentsDir: string | null = null,
    defaultMode: Mode | null = null,
    filterByCwd: string | null = null,
    cleanupAgeDays: number = 7,
    modelOverrides: ModelOverrides | null = null
  ) {
    this.maxAgents = maxAgents;
    this.maxConcurrent = maxConcurrent;
    this.constructorAgentsDir = agentsDir;
    this.filterByCwd = filterByCwd;
    this.cleanupAgeDays = cleanupAgeDays;
    const resolvedDefaultMode = defaultMode ? normalizeModeValue(defaultMode) : defaultModeFromEnv();
    if (!resolvedDefaultMode) {
      throw new Error(`Invalid default_mode '${defaultMode}'. Use 'plan' or 'edit'.`);
    }
    this.defaultMode = resolvedDefaultMode;
    this.effortModelMap = resolveEffortModelMap(EFFORT_MODEL_MAP, modelOverrides);

    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.agentsDir = this.constructorAgentsDir || await getAgentsDir();
    await fs.mkdir(this.agentsDir, { recursive: true });
    await this.loadExistingAgents();
  }

  getDefaultMode(): Mode {
    return this.defaultMode;
  }

  setModelOverrides(overrides: ModelOverrides | null | undefined): void {
    this.effortModelMap = resolveEffortModelMap(EFFORT_MODEL_MAP, overrides);
  }

  private async loadExistingAgents(): Promise<void> {
    try {
      await fs.access(this.agentsDir);
    } catch {
      return;
    }

    const cutoffDate = new Date(Date.now() - this.cleanupAgeDays * 24 * 60 * 60 * 1000);
    let loadedCount = 0;
    let skippedCwd = 0;
    let cleanedOld = 0;

    const entries = await fs.readdir(this.agentsDir);
    for (const entry of entries) {
      const agentDir = path.join(this.agentsDir, entry);
      const stat = await fs.stat(agentDir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const agentId = entry;
      const agent = await AgentProcess.loadFromDisk(agentId, this.agentsDir);
      if (!agent) continue;

      if (agent.completedAt && agent.completedAt < cutoffDate) {
        try {
          await fs.rm(agentDir, { recursive: true });
          cleanedOld++;
        } catch (err) {
          console.warn(`Failed to cleanup old agent ${agentId}:`, err);
        }
        continue;
      }

      if (this.filterByCwd !== null) {
        const agentCwd = agent.cwd;
        if (agentCwd !== this.filterByCwd) {
          skippedCwd++;
          continue;
        }
      }

      await agent.updateStatusFromProcess();
      this.agents.set(agentId, agent);
      loadedCount++;
    }

    if (cleanedOld > 0) {
      console.error(`Cleaned up ${cleanedOld} old agents (older than ${this.cleanupAgeDays} days)`);
    }
    if (skippedCwd > 0) {
      console.error(`Skipped ${skippedCwd} agents (different CWD)`);
    }
    console.error(`Loaded ${loadedCount} agents from disk`);
  }

  async spawn(
    taskName: string,
    agentType: AgentType,
    prompt: string,
    cwd: string | null = null,
    mode: Mode | null = null,
    effort: EffortLevel = 'default',
    parentSessionId: string | null = null
  ): Promise<AgentProcess> {
    await this.initialize();
    const resolvedMode = resolveMode(mode, this.defaultMode);

    // Resolve model from effort level
    const resolvedModel: string = this.effortModelMap[effort][agentType];

    const running = await this.listRunning();
    if (running.length >= this.maxConcurrent) {
      throw new Error(
        `Maximum concurrent agents (${this.maxConcurrent}) reached. Wait for an agent to complete or stop one first.`
      );
    }

    const [available, pathOrError] = checkCliAvailable(agentType);
    if (!available) {
      throw new Error(pathOrError || 'CLI tool not available');
    }

    // Resolve and validate cwd
    let resolvedCwd: string | null = null;
    if (cwd !== null) {
      resolvedCwd = path.resolve(cwd);
      const stat = await fs.stat(resolvedCwd).catch(() => null);
      if (!stat) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Working directory is not a directory: ${cwd}`);
      }
    }

    const agentId = randomUUID().substring(0, 8);
    const cmd = this.buildCommand(agentType, prompt, resolvedMode, resolvedModel, resolvedCwd);

    const agent = new AgentProcess(
      agentId,
      taskName,
      agentType,
      prompt,
      resolvedCwd,
      resolvedMode,
      null,
      AgentStatus.RUNNING,
      new Date(),
      null,
      this.agentsDir,
      parentSessionId
    );

    const agentDir = await agent.getAgentDir();
    try {
      await fs.mkdir(agentDir, { recursive: true });
    } catch (err: any) {
      this.agents.delete(agent.agentId);
      throw new Error(`Failed to create agent directory: ${err.message}`);
    }

    console.error(`Spawning ${agentType} agent ${agentId} [${resolvedMode}]: ${cmd.slice(0, 3).join(' ')}...`);

    try {
      const stdoutPath = await agent.getStdoutPath();
      const stdoutFile = await fs.open(stdoutPath, 'w');
      const stdoutFd = stdoutFile.fd;

      const childProcess = spawn(cmd[0], cmd.slice(1), {
        stdio: ['ignore', stdoutFd, stdoutFd],
        cwd: resolvedCwd || undefined,
        detached: true,
      });

      childProcess.unref();
      stdoutFile.close().catch(() => {});

      agent.pid = childProcess.pid || null;

      await agent.saveMeta();
    } catch (err: any) {
      await this.cleanupPartialAgent(agent);
      console.error(`Failed to spawn agent ${agentId}:`, err);
      throw new Error(`Failed to spawn agent: ${err.message}`);
    }

    this.agents.set(agentId, agent);
    await this.cleanupOldAgents();

    console.error(`Spawned agent ${agentId} with PID ${agent.pid}`);
    return agent;
  }

  private buildCommand(
    agentType: AgentType,
    prompt: string,
    mode: Mode,
    model: string,
    cwd: string | null = null
  ): string[] {
    const cmdTemplate = AGENT_COMMANDS[agentType];
    if (!cmdTemplate) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }

    const isEditMode = mode === 'edit';

    // Build the full prompt with prefix (for plan mode) and suffix
    let fullPrompt = prompt + PROMPT_SUFFIX;

    // For Claude in plan mode, add prefix explaining headless plan mode restrictions
    if (agentType === 'claude' && !isEditMode) {
      fullPrompt = CLAUDE_PLAN_MODE_PREFIX + fullPrompt;
    }

    let cmd = cmdTemplate.map(part => part.replace('{prompt}', fullPrompt));

    // For Claude agents, load user's settings.json to inherit permissions
    // and grant access to the working directory
    if (agentType === 'claude') {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      cmd.push('--settings', settingsPath);

      if (cwd) {
        cmd.push('--add-dir', cwd);
      }
    }

    // Add model flag for each agent type
    if (agentType === 'codex') {
      const execIndex = cmd.indexOf('exec');
      const sandboxIndex = cmd.indexOf('--sandbox');
      const insertIndex = sandboxIndex !== -1 ? sandboxIndex : execIndex + 1;
      cmd.splice(insertIndex, 0, '--model', model);
    } else if (agentType === 'cursor') {
      cmd.push('--model', model);
    } else if (agentType === 'gemini' || agentType === 'claude') {
      cmd.push('--model', model);
    }

    if (mode === 'ralph') {
      cmd = this.applyRalphMode(agentType, cmd);
    } else if (isEditMode) {
      cmd = this.applyEditMode(agentType, cmd);
    }

    return cmd;
  }

  private applyEditMode(agentType: AgentType, cmd: string[]): string[] {
    const editCmd: string[] = [...cmd];

    switch (agentType) {
      case 'codex':
        editCmd.push('--full-auto');
        break;

      case 'cursor':
        editCmd.push('-f');
        break;

      case 'gemini':
        // Gemini CLI uses --yolo flag for auto-approve
        editCmd.push('--yolo');
        break;

      case 'claude':
        const permModeIndex = editCmd.indexOf('--permission-mode');
        if (permModeIndex !== -1 && permModeIndex + 1 < editCmd.length) {
          editCmd[permModeIndex + 1] = 'acceptEdits';
        }
        break;
    }

    return editCmd;
  }

  private applyRalphMode(agentType: AgentType, cmd: string[]): string[] {
    const ralphCmd: string[] = [...cmd];

    switch (agentType) {
      case 'codex':
        ralphCmd.push('--full-auto');
        break;

      case 'cursor':
        ralphCmd.push('-f');
        break;

      case 'gemini':
        ralphCmd.push('--yolo');
        break;

      case 'claude':
        // Replace --permission-mode plan with --dangerously-skip-permissions
        const permModeIndex = ralphCmd.indexOf('--permission-mode');
        if (permModeIndex !== -1) {
          ralphCmd.splice(permModeIndex, 2); // Remove --permission-mode and its value
        }
        ralphCmd.push('--dangerously-skip-permissions');
        break;
    }

    return ralphCmd;
  }

  async get(agentId: string): Promise<AgentProcess | null> {
    await this.initialize();
    let agent = this.agents.get(agentId) || null;
    if (agent) {
      await agent.readNewEvents();
      await agent.updateStatusFromProcess();
      return agent;
    }

    agent = await AgentProcess.loadFromDisk(agentId, this.agentsDir);
    if (agent) {
      await agent.readNewEvents();
      await agent.updateStatusFromProcess();
      this.agents.set(agentId, agent);
      return agent;
    }

    return null;
  }

  async listAll(): Promise<AgentProcess[]> {
    const agents = Array.from(this.agents.values());
    for (const agent of agents) {
      await agent.readNewEvents();
      await agent.updateStatusFromProcess();
    }
    return agents;
  }

  async listRunning(): Promise<AgentProcess[]> {
    const all = await this.listAll();
    return all.filter(a => a.status === AgentStatus.RUNNING);
  }

  async listCompleted(): Promise<AgentProcess[]> {
    const all = await this.listAll();
    return all.filter(a => a.status !== AgentStatus.RUNNING);
  }

  async listByTask(taskName: string): Promise<AgentProcess[]> {
    const all = await this.listAll();
    return all.filter(a => a.taskName === taskName);
  }

  async listByParentSession(parentSessionId: string): Promise<AgentProcess[]> {
    const all = await this.listAll();
    return all.filter(a => a.parentSessionId === parentSessionId);
  }

  async stopByTask(taskName: string): Promise<{ stopped: string[]; alreadyStopped: string[] }> {
    const agents = await this.listByTask(taskName);
    const stopped: string[] = [];
    const alreadyStopped: string[] = [];

    for (const agent of agents) {
      if (agent.status === AgentStatus.RUNNING) {
        const success = await this.stop(agent.agentId);
        if (success) {
          stopped.push(agent.agentId);
        }
      } else {
        alreadyStopped.push(agent.agentId);
      }
    }

    return { stopped, alreadyStopped };
  }

  async stop(agentId: string): Promise<boolean> {
    await this.initialize();
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    if (agent.pid && agent.status === AgentStatus.RUNNING) {
      try {
        process.kill(-agent.pid, 'SIGTERM');
        console.error(`Sent SIGTERM to agent ${agentId} (PID ${agent.pid})`);

        await new Promise(resolve => setTimeout(resolve, 2000));
        if (agent.isProcessAlive()) {
          process.kill(-agent.pid, 'SIGKILL');
          console.error(`Sent SIGKILL to agent ${agentId}`);
        }
      } catch {
      }

      agent.status = AgentStatus.STOPPED;
      agent.completedAt = new Date();
      await agent.saveMeta();
      console.error(`Stopped agent ${agentId}`);
      return true;
    }

    return false;
  }

  private async cleanupPartialAgent(agent: AgentProcess): Promise<void> {
    this.agents.delete(agent.agentId);
    try {
      const agentDir = await agent.getAgentDir();
      await fs.rm(agentDir, { recursive: true });
    } catch (err) {
      console.warn(`Failed to clean up agent directory:`, err);
    }
  }

  private async cleanupOldAgents(): Promise<void> {
    const completed = await this.listCompleted();
    if (completed.length > this.maxAgents) {
      completed.sort((a, b) => {
        const aTime = a.completedAt?.getTime() || 0;
        const bTime = b.completedAt?.getTime() || 0;
        return aTime - bTime;
      });
      for (const agent of completed.slice(0, completed.length - this.maxAgents)) {
        this.agents.delete(agent.agentId);
        try {
          const agentDir = await agent.getAgentDir();
          await fs.rm(agentDir, { recursive: true });
        } catch (err) {
          console.warn(`Failed to cleanup old agent ${agent.agentId}:`, err);
        }
      }
    }
  }
}
