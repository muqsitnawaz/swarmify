import * as fs from 'fs';
import * as path from 'path';
import { AGENTS, ALL_AGENT_IDS } from './agents.js';
import type { AgentId, InstalledHook } from './types.js';

type HookEntry = { name: string; scriptPath: string; dataFile?: string };

const SCRIPT_EXTENSIONS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.rb',
  '.pl',
  '.ps1',
  '.cmd',
  '.bat',
]);

function isExecutable(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

function getHooksDir(agentId: AgentId): string {
  const agent = AGENTS[agentId];
  return path.join(agent.configDir, agent.hooksDir);
}

function getProjectHooksDir(agentId: AgentId, cwd: string): string {
  const agent = AGENTS[agentId];
  return path.join(cwd, `.${agentId}`, agent.hooksDir);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeHookFiles(dir: string, name: string): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    if (base === name) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

function listHookEntriesFromDir(dir: string): HookEntry[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: {
    name: string;
    base: string;
    ext: string;
    fullPath: string;
    isExec: boolean;
  }[] = [];

  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    files.push({
      name: file,
      base,
      ext,
      fullPath,
      isExec: isExecutable(stat.mode),
    });
  }

  const grouped = new Map<string, typeof files>();
  for (const file of files) {
    const list = grouped.get(file.base) || [];
    list.push(file);
    grouped.set(file.base, list);
  }

  const entries: HookEntry[] = [];
  for (const [base, group] of grouped) {
    group.sort((a, b) => a.name.localeCompare(b.name));
    const script =
      group.find((f) => f.isExec) ||
      group.find((f) => SCRIPT_EXTENSIONS.has(f.ext.toLowerCase())) ||
      group[0];
    if (!script) continue;
    const data = group.find((f) => f !== script);
    entries.push({
      name: base,
      scriptPath: script.fullPath,
      dataFile: data ? data.fullPath : undefined,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildHookMap(entries: HookEntry[]): Map<string, HookEntry> {
  const map = new Map<string, HookEntry>();
  for (const entry of entries) {
    map.set(entry.name, entry);
  }
  return map;
}

function copyHook(entry: HookEntry, targetDir: string): void {
  ensureDir(targetDir);
  removeHookFiles(targetDir, entry.name);

  const scriptTarget = path.join(targetDir, path.basename(entry.scriptPath));
  fs.copyFileSync(entry.scriptPath, scriptTarget);
  const scriptStat = fs.statSync(entry.scriptPath);
  fs.chmodSync(scriptTarget, scriptStat.mode);

  if (entry.dataFile) {
    const dataTarget = path.join(targetDir, path.basename(entry.dataFile));
    fs.copyFileSync(entry.dataFile, dataTarget);
  }
}

export function listInstalledHooksWithScope(
  agentId: AgentId,
  cwd: string = process.cwd()
): InstalledHook[] {
  const agent = AGENTS[agentId];
  if (!agent.supportsHooks) {
    return [];
  }

  const results: InstalledHook[] = [];

  const userDir = getHooksDir(agentId);
  const userHooks = listHookEntriesFromDir(userDir);
  for (const hook of userHooks) {
    results.push({
      name: hook.name,
      path: hook.scriptPath,
      dataFile: hook.dataFile,
      scope: 'user',
      agent: agentId,
    });
  }

  const projectDir = getProjectHooksDir(agentId, cwd);
  const projectHooks = listHookEntriesFromDir(projectDir);
  for (const hook of projectHooks) {
    results.push({
      name: hook.name,
      path: hook.scriptPath,
      dataFile: hook.dataFile,
      scope: 'project',
      agent: agentId,
    });
  }

  return results;
}

export async function installHooks(
  source: string,
  agents: AgentId[],
  options: { scope?: 'user' | 'project' } = {}
): Promise<{ installed: string[]; errors: string[] }> {
  const installed: string[] = [];
  const errors: string[] = [];
  const scope = options.scope || 'user';
  const cwd = process.cwd();

  const sharedDir = path.join(source, 'shared', 'hooks');
  const sharedHooks = buildHookMap(listHookEntriesFromDir(sharedDir));

  const uniqueAgents = Array.from(new Set(agents));
  for (const agentId of uniqueAgents) {
    const agent = AGENTS[agentId];
    if (!agent || !agent.supportsHooks) {
      errors.push(`${agentId}:Agent does not support hooks`);
      continue;
    }

    const agentDir = path.join(source, agentId, agent.hooksDir);
    const agentHooks = buildHookMap(listHookEntriesFromDir(agentDir));
    const hooks = new Map(sharedHooks);
    for (const [name, entry] of agentHooks) {
      hooks.set(name, entry);
    }

    const targetDir =
      scope === 'project' ? getProjectHooksDir(agentId, cwd) : getHooksDir(agentId);

    for (const entry of hooks.values()) {
      try {
        copyHook(entry, targetDir);
        installed.push(`${entry.name}:${agentId}`);
      } catch (err) {
        errors.push(`${entry.name}:${agentId}:${(err as Error).message}`);
      }
    }
  }

  return { installed, errors };
}

export async function removeHook(
  name: string,
  agents: AgentId[]
): Promise<{ removed: string[]; errors: string[] }> {
  const removed: string[] = [];
  const errors: string[] = [];

  const uniqueAgents = Array.from(new Set(agents));
  for (const agentId of uniqueAgents) {
    const agent = AGENTS[agentId];
    if (!agent || !agent.supportsHooks) {
      errors.push(`${agentId}:Agent does not support hooks`);
      continue;
    }

    try {
      const dir = getHooksDir(agentId);
      const filesBefore = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      removeHookFiles(dir, name);
      const filesAfter = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      if (filesBefore.length !== filesAfter.length) {
        removed.push(`${name}:${agentId}`);
      }
    } catch (err) {
      errors.push(`${name}:${agentId}:${(err as Error).message}`);
    }
  }

  return { removed, errors };
}

export function promoteHookToUser(
  agentId: AgentId,
  name: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const agent = AGENTS[agentId];
  if (!agent.supportsHooks) {
    return { success: false, error: 'Agent does not support hooks' };
  }

  const projectDir = getProjectHooksDir(agentId, cwd);
  const hooks = listHookEntriesFromDir(projectDir);
  const hook = hooks.find((h) => h.name === name);
  if (!hook) {
    return { success: false, error: `Project hook '${name}' not found` };
  }

  try {
    const userDir = getHooksDir(agentId);
    copyHook(hook, userDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function discoverHooksFromRepo(
  repoPath: string
): { shared: string[]; agentSpecific: Record<AgentId, string[]> } {
  const sharedDir = path.join(repoPath, 'shared', 'hooks');
  const shared = listHookEntriesFromDir(sharedDir).map((h) => h.name);

  const agentSpecific = {} as Record<AgentId, string[]>;
  for (const agentId of ALL_AGENT_IDS) {
    const agent = AGENTS[agentId];
    const agentDir = path.join(repoPath, agentId, agent.hooksDir);
    agentSpecific[agentId] = listHookEntriesFromDir(agentDir).map((h) => h.name);
  }

  return { shared, agentSpecific };
}
