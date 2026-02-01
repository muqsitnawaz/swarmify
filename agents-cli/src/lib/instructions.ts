import * as fs from 'fs';
import * as path from 'path';
import { AGENTS, ALL_AGENT_IDS } from './agents.js';
import type { AgentId } from './types.js';

export type InstructionsScope = 'user' | 'project';

export interface InstalledInstructions {
  agentId: AgentId;
  scope: InstructionsScope;
  path: string;
  exists: boolean;
}

export interface DiscoveredInstructions {
  agentId: AgentId;
  sourcePath: string;
  filename: string;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function getInstructionsPath(agentId: AgentId, scope: InstructionsScope, cwd: string = process.cwd()): string {
  const agent = AGENTS[agentId];
  if (scope === 'user') {
    return path.join(agent.configDir, agent.instructionsFile);
  }
  return path.join(cwd, `.${agentId}`, agent.instructionsFile);
}

export function instructionsExists(agentId: AgentId, scope: InstructionsScope = 'user', cwd: string = process.cwd()): boolean {
  const instructionsPath = getInstructionsPath(agentId, scope, cwd);
  return fs.existsSync(instructionsPath);
}

export function discoverInstructionsFromRepo(repoPath: string): DiscoveredInstructions[] {
  const instructions: DiscoveredInstructions[] = [];

  const instructionsDir = path.join(repoPath, 'instructions');
  if (!fs.existsSync(instructionsDir)) {
    return instructions;
  }

  for (const agentId of ALL_AGENT_IDS) {
    const agent = AGENTS[agentId];
    const possibleNames = [
      `${agentId}.md`,
      agent.instructionsFile,
    ];

    for (const filename of possibleNames) {
      const sourcePath = path.join(instructionsDir, filename);
      if (fs.existsSync(sourcePath)) {
        instructions.push({
          agentId,
          sourcePath,
          filename,
        });
        break;
      }
    }
  }

  return instructions;
}

export function resolveInstructionsSource(repoPath: string, agentId: AgentId): string | null {
  const agent = AGENTS[agentId];
  const instructionsDir = path.join(repoPath, 'instructions');

  if (!fs.existsSync(instructionsDir)) {
    return null;
  }

  const possibleNames = [
    `${agentId}.md`,
    agent.instructionsFile,
  ];

  for (const filename of possibleNames) {
    const sourcePath = path.join(instructionsDir, filename);
    if (fs.existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  return null;
}

export function installInstructions(
  sourcePath: string,
  agentId: AgentId,
  method: 'symlink' | 'copy' = 'copy'
): { path: string; method: 'symlink' | 'copy'; error?: string } {
  const agent = AGENTS[agentId];
  const targetPath = path.join(agent.configDir, agent.instructionsFile);

  if (!fs.existsSync(agent.configDir)) {
    fs.mkdirSync(agent.configDir, { recursive: true });
  }

  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.unlinkSync(targetPath);
    }
  }

  try {
    if (method === 'symlink') {
      fs.symlinkSync(sourcePath, targetPath);
      return { path: targetPath, method: 'symlink' };
    }

    fs.copyFileSync(sourcePath, targetPath);
    return { path: targetPath, method: 'copy' };
  } catch (err) {
    return { path: '', method: 'copy', error: (err as Error).message };
  }
}

export function uninstallInstructions(agentId: AgentId): boolean {
  const agent = AGENTS[agentId];
  const targetPath = path.join(agent.configDir, agent.instructionsFile);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return true;
  }
  return false;
}

export function instructionsContentMatches(
  agentId: AgentId,
  sourcePath: string,
  scope: InstructionsScope = 'user',
  cwd: string = process.cwd()
): boolean {
  const installedPath = getInstructionsPath(agentId, scope, cwd);

  if (!fs.existsSync(installedPath) || !fs.existsSync(sourcePath)) {
    return false;
  }

  try {
    const installedContent = fs.readFileSync(installedPath, 'utf-8');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    return normalizeContent(installedContent) === normalizeContent(sourceContent);
  } catch {
    return false;
  }
}

export function listInstalledInstructionsWithScope(
  agentId: AgentId,
  cwd: string = process.cwd()
): InstalledInstructions[] {
  const results: InstalledInstructions[] = [];
  const agent = AGENTS[agentId];

  const userPath = path.join(agent.configDir, agent.instructionsFile);
  results.push({
    agentId,
    scope: 'user',
    path: userPath,
    exists: fs.existsSync(userPath),
  });

  const projectPath = path.join(cwd, `.${agentId}`, agent.instructionsFile);
  results.push({
    agentId,
    scope: 'project',
    path: projectPath,
    exists: fs.existsSync(projectPath),
  });

  return results;
}

export function promoteInstructionsToUser(
  agentId: AgentId,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const agent = AGENTS[agentId];
  const projectPath = path.join(cwd, `.${agentId}`, agent.instructionsFile);

  if (!fs.existsSync(projectPath)) {
    return { success: false, error: `Project instructions not found at ${projectPath}` };
  }

  if (!fs.existsSync(agent.configDir)) {
    fs.mkdirSync(agent.configDir, { recursive: true });
  }

  const targetPath = path.join(agent.configDir, agent.instructionsFile);

  try {
    fs.copyFileSync(projectPath, targetPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function getInstructionsContent(agentId: AgentId, scope: InstructionsScope = 'user', cwd: string = process.cwd()): string | null {
  const instructionsPath = getInstructionsPath(agentId, scope, cwd);
  if (!fs.existsSync(instructionsPath)) {
    return null;
  }
  try {
    return fs.readFileSync(instructionsPath, 'utf-8');
  } catch {
    return null;
  }
}
