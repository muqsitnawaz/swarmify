import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { JobConfig, RunMeta } from './jobs.js';
import {
  resolveJobPrompt,
  parseTimeout,
  writeRunMeta,
  getRunDir,
} from './jobs.js';
import { getRunsDir } from './state.js';
import type { AgentId } from './types.js';
import { prepareJobHome } from './sandbox.js';

export interface RunResult {
  meta: RunMeta;
  reportPath: string | null;
}

const AGENT_COMMANDS: Record<string, string[]> = {
  claude: ['claude', '-p', '--verbose', '{prompt}', '--output-format', 'stream-json', '--permission-mode', 'plan'],
  codex: ['codex', 'exec', '--sandbox', 'workspace-write', '{prompt}', '--json'],
  gemini: ['gemini', '{prompt}', '--output-format', 'stream-json'],
};

export function buildJobCommand(config: JobConfig, resolvedPrompt: string): string[] {
  const template = AGENT_COMMANDS[config.agent];
  if (!template) {
    throw new Error(`Unsupported agent for daemon jobs: ${config.agent}`);
  }

  let cmd = template.map((part) => part.replace('{prompt}', resolvedPrompt));

  if (config.agent === 'claude') {
    if (config.mode === 'edit') {
      const planIndex = cmd.indexOf('plan');
      if (planIndex !== -1) cmd[planIndex] = 'acceptEdits';
    }

    if (config.allow?.dirs) {
      for (const dir of config.allow.dirs) {
        const resolved = dir.replace(/^~/, os.homedir());
        cmd.push('--add-dir', resolved);
      }
    }

    const model = config.config?.model as string | undefined;
    if (model) {
      cmd.push('--model', model);
    }
  }

  if (config.agent === 'codex') {
    if (config.mode === 'edit') {
      cmd.push('--full-auto');
    }

    const model = config.config?.model as string | undefined;
    if (model) {
      cmd.push('--model', model);
    }
  }

  if (config.agent === 'gemini') {
    if (config.mode === 'edit') {
      cmd.push('--yolo');
    }

    const model = config.config?.model as string | undefined;
    if (model) {
      cmd.push('--model', model);
    }
  }

  return cmd;
}

function generateRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function executeJob(config: JobConfig): Promise<RunResult> {
  const resolvedPrompt = resolveJobPrompt(config);
  const cmd = buildJobCommand(config, resolvedPrompt);

  const overlayHome = prepareJobHome(config);

  const runId = generateRunId();
  const runDir = getRunDir(config.name, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const stdoutPath = path.join(runDir, 'stdout.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');

  const spawnEnv = { ...process.env, HOME: overlayHome };

  const meta: RunMeta = {
    jobName: config.name,
    runId,
    agent: config.agent,
    pid: null,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
  };
  writeRunMeta(meta);

  const timeoutMs = parseTimeout(config.timeout) || 30 * 60 * 1000;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['ignore', stdoutFd, stdoutFd],
      detached: true,
      env: spawnEnv,
    });

    meta.pid = child.pid || null;
    writeRunMeta(meta);

    let settled = false;

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {}

      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000);

      meta.status = 'timeout';
      meta.completedAt = new Date().toISOString();
      writeRunMeta(meta);

      const reportPath = extractAndSaveReport(stdoutPath, config.agent, runDir);
      resolve({ meta, reportPath });
    }, timeoutMs);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);

      try { fs.closeSync(stdoutFd); } catch {}

      meta.exitCode = code;
      meta.status = code === 0 ? 'completed' : 'failed';
      meta.completedAt = new Date().toISOString();
      writeRunMeta(meta);

      const reportPath = extractAndSaveReport(stdoutPath, config.agent, runDir);
      resolve({ meta, reportPath });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);

      try { fs.closeSync(stdoutFd); } catch {}

      meta.status = 'failed';
      meta.completedAt = new Date().toISOString();
      writeRunMeta(meta);
      resolve({ meta, reportPath: null });
    });

    child.unref();
  });
}

export async function executeJobDetached(config: JobConfig): Promise<RunMeta> {
  const resolvedPrompt = resolveJobPrompt(config);
  const cmd = buildJobCommand(config, resolvedPrompt);

  const overlayHome = prepareJobHome(config);

  const runId = generateRunId();
  const runDir = getRunDir(config.name, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const stdoutPath = path.join(runDir, 'stdout.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');

  const spawnEnv = { ...process.env, HOME: overlayHome };

  const meta: RunMeta = {
    jobName: config.name,
    runId,
    agent: config.agent,
    pid: null,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
  };

  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: ['ignore', stdoutFd, stdoutFd],
    detached: true,
    env: spawnEnv,
  });

  child.unref();
  try { fs.closeSync(stdoutFd); } catch {}

  meta.pid = child.pid || null;
  writeRunMeta(meta);

  return meta;
}

function extractAndSaveReport(
  stdoutPath: string,
  agentType: AgentId,
  runDir: string
): string | null {
  try {
    const report = extractReport(stdoutPath, agentType);
    if (report) {
      const reportPath = path.join(runDir, 'report.md');
      fs.writeFileSync(reportPath, report, 'utf-8');
      return reportPath;
    }
  } catch {}
  return null;
}

export function extractReport(stdoutPath: string, agentType: AgentId): string | null {
  if (!fs.existsSync(stdoutPath)) return null;

  try {
    const content = fs.readFileSync(stdoutPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());

    let lastMessage = '';

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (agentType === 'claude') {
          if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === 'text' && block.text) {
                lastMessage = block.text;
              }
            }
          }
        }

        if (agentType === 'codex') {
          if (parsed.type === 'message' && parsed.content) {
            lastMessage = typeof parsed.content === 'string'
              ? parsed.content
              : JSON.stringify(parsed.content);
          }
        }

        if (agentType === 'gemini') {
          if (parsed.type === 'text' && parsed.text) {
            lastMessage = parsed.text;
          }
        }
      } catch {}
    }

    return lastMessage || null;
  } catch {
    return null;
  }
}

export function monitorRunningJobs(): void {
  const runsDir = getRunsDir();
  if (!fs.existsSync(runsDir)) return;

  const jobDirs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  for (const jobDir of jobDirs) {
    const jobRunsPath = path.join(runsDir, jobDir.name);
    const runDirs = fs.readdirSync(jobRunsPath, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    for (const runDirEntry of runDirs) {
      const metaPath = path.join(jobRunsPath, runDirEntry.name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;

      try {
        const meta: RunMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.status !== 'running') continue;
        if (!meta.pid) continue;

        try {
          process.kill(meta.pid, 0);
        } catch {
          meta.status = 'failed';
          meta.completedAt = new Date().toISOString();
          writeRunMeta(meta);

          const stdoutPath = path.join(jobRunsPath, runDirEntry.name, 'stdout.log');
          extractAndSaveReport(stdoutPath, meta.agent, path.join(jobRunsPath, runDirEntry.name));
        }
      } catch {}
    }
  }
}
