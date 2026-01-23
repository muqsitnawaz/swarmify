import * as fs from 'fs';
import * as path from 'path';
import { AGENTS, ensureCommandsDir } from './agents.js';
import { markdownToToml } from './convert.js';
import type { AgentId, CommandInstallation } from './types.js';

export type CommandScope = 'user' | 'project';

export interface DiscoveredCommand {
  name: string;
  description: string;
  sourcePath: string;
  isShared: boolean;
  agentSpecific?: AgentId;
}

export interface InstalledCommand {
  name: string;
  scope: CommandScope;
  path: string;
  description?: string;
}

export function discoverCommands(repoPath: string): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  const seen = new Set<string>();

  const sharedDir = path.join(repoPath, 'shared', 'commands');
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir)) {
      if (file.endsWith('.md')) {
        const name = file.replace('.md', '');
        const sourcePath = path.join(sharedDir, file);
        const content = fs.readFileSync(sourcePath, 'utf-8');
        const description = extractDescription(content);
        commands.push({
          name,
          description,
          sourcePath,
          isShared: true,
        });
        seen.add(name);
      }
    }
  }

  for (const agentId of Object.keys(AGENTS) as AgentId[]) {
    const agent = AGENTS[agentId];
    const agentDir = path.join(repoPath, agentId, agent.commandsSubdir);
    if (fs.existsSync(agentDir)) {
      const ext = agent.format === 'toml' ? '.toml' : '.md';
      for (const file of fs.readdirSync(agentDir)) {
        if (file.endsWith(ext)) {
          const name = file.replace(ext, '');
          if (!seen.has(name)) {
            const sourcePath = path.join(agentDir, file);
            const content = fs.readFileSync(sourcePath, 'utf-8');
            const description = extractDescription(content);
            commands.push({
              name,
              description,
              sourcePath,
              isShared: false,
              agentSpecific: agentId,
            });
            seen.add(name);
          }
        }
      }
    }
  }

  return commands;
}

function extractDescription(content: string): string {
  const match = content.match(/description:\s*(.+)/i);
  if (match) return match[1].trim();

  const tomlMatch = content.match(/description\s*=\s*"([^"]+)"/);
  if (tomlMatch) return tomlMatch[1];

  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('---'));
  return firstLine?.slice(0, 80) || '';
}

export function resolveCommandSource(
  repoPath: string,
  commandName: string,
  agentId: AgentId
): string | null {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';

  const agentSpecific = path.join(
    repoPath,
    agentId,
    agent.commandsSubdir,
    `${commandName}${ext}`
  );
  if (fs.existsSync(agentSpecific)) {
    return agentSpecific;
  }

  const shared = path.join(repoPath, 'shared', 'commands', `${commandName}.md`);
  if (fs.existsSync(shared)) {
    return shared;
  }

  return null;
}

export function installCommand(
  sourcePath: string,
  agentId: AgentId,
  commandName: string,
  method: 'symlink' | 'copy' = 'symlink'
): CommandInstallation {
  const agent = AGENTS[agentId];
  ensureCommandsDir(agentId);

  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const targetPath = path.join(agent.commandsDir, `${commandName}${ext}`);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  const sourceIsMarkdown = sourcePath.endsWith('.md');
  const needsConversion = agent.format === 'toml' && sourceIsMarkdown;

  if (needsConversion) {
    const tomlContent = markdownToToml(commandName, sourceContent);
    fs.writeFileSync(targetPath, tomlContent, 'utf-8');
    return { path: targetPath, method: 'copy' };
  }

  if (method === 'symlink') {
    fs.symlinkSync(sourcePath, targetPath);
    return { path: targetPath, method: 'symlink' };
  }

  fs.copyFileSync(sourcePath, targetPath);
  return { path: targetPath, method: 'copy' };
}

export function uninstallCommand(agentId: AgentId, commandName: string): boolean {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const targetPath = path.join(agent.commandsDir, `${commandName}${ext}`);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return true;
  }
  return false;
}

export function listInstalledCommands(agentId: AgentId): string[] {
  const agent = AGENTS[agentId];
  if (!fs.existsSync(agent.commandsDir)) {
    return [];
  }

  const ext = agent.format === 'toml' ? '.toml' : '.md';
  return fs
    .readdirSync(agent.commandsDir)
    .filter((f) => f.endsWith(ext))
    .map((f) => f.replace(ext, ''));
}

/**
 * Get the project-scoped commands directory for an agent.
 * Claude: .claude/commands/
 * Codex: .codex/prompts/
 * Gemini: .gemini/commands/
 */
function getProjectCommandsDir(agentId: AgentId, cwd: string = process.cwd()): string {
  const agent = AGENTS[agentId];
  return path.join(cwd, `.${agentId}`, agent.commandsSubdir);
}

/**
 * List commands from a specific directory.
 */
function listCommandsFromDir(dir: string, format: 'markdown' | 'toml'): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const ext = format === 'toml' ? '.toml' : '.md';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => f.replace(ext, ''));
}

/**
 * List installed commands with scope information.
 */
export function listInstalledCommandsWithScope(
  agentId: AgentId,
  cwd: string = process.cwd()
): InstalledCommand[] {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const results: InstalledCommand[] = [];

  // User-scoped commands
  const userCommands = listCommandsFromDir(agent.commandsDir, agent.format);
  for (const name of userCommands) {
    const commandPath = path.join(agent.commandsDir, `${name}${ext}`);
    results.push({
      name,
      scope: 'user',
      path: commandPath,
      description: getCommandDescription(commandPath),
    });
  }

  // Project-scoped commands
  const projectDir = getProjectCommandsDir(agentId, cwd);
  const projectCommands = listCommandsFromDir(projectDir, agent.format);
  for (const name of projectCommands) {
    const commandPath = path.join(projectDir, `${name}${ext}`);
    results.push({
      name,
      scope: 'project',
      path: commandPath,
      description: getCommandDescription(commandPath),
    });
  }

  return results;
}

/**
 * Get command description from file.
 */
function getCommandDescription(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return extractDescription(content) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copy a project-scoped command to user scope.
 */
export function promoteCommandToUser(
  agentId: AgentId,
  commandName: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';

  const projectDir = getProjectCommandsDir(agentId, cwd);
  const sourcePath = path.join(projectDir, `${commandName}${ext}`);

  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Project command '${commandName}' not found` };
  }

  ensureCommandsDir(agentId);
  const targetPath = path.join(agent.commandsDir, `${commandName}${ext}`);

  try {
    fs.copyFileSync(sourcePath, targetPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
