import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { AGENTS, ensureCommandsDir } from './agents.js';
import { markdownToToml } from './convert.js';
import type { AgentId, CommandInstallation } from './types.js';

export type CommandScope = 'user' | 'project';

export interface CommandMetadata {
  name: string;
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DiscoveredCommand {
  name: string;
  description: string;
  sourcePath: string;
  isShared: boolean;
  agentSpecific?: AgentId;
  validation: ValidationResult;
}

export interface InstalledCommand {
  name: string;
  scope: CommandScope;
  path: string;
  description?: string;
}

export function parseCommandMetadata(filePath: string): CommandMetadata | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check for YAML frontmatter
    if (lines[0] === '---') {
      const endIndex = lines.slice(1).findIndex((l) => l === '---');
      if (endIndex > 0) {
        const frontmatter = lines.slice(1, endIndex + 1).join('\n');
        const parsed = yaml.parse(frontmatter);
        return {
          name: parsed.name || '',
          description: parsed.description || '',
        };
      }
    }

    // Check for TOML format
    const tomlNameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const tomlDescMatch = content.match(/description\s*=\s*"([^"]+)"/);
    if (tomlNameMatch || tomlDescMatch) {
      return {
        name: tomlNameMatch?.[1] || '',
        description: tomlDescMatch?.[1] || '',
      };
    }

    // No valid frontmatter found
    return null;
  } catch {
    return null;
  }
}

export function validateCommandMetadata(
  metadata: CommandMetadata | null,
  commandName: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!metadata) {
    errors.push('Missing YAML frontmatter with name and description');
    return { valid: false, errors, warnings };
  }

  // name is required
  if (!metadata.name || metadata.name.trim() === '') {
    errors.push('Missing required field: name');
  } else if (metadata.name.length > 64) {
    warnings.push(`name exceeds 64 characters (${metadata.name.length})`);
  }

  // description is required
  if (!metadata.description || metadata.description.trim() === '') {
    errors.push('Missing required field: description');
  } else if (metadata.description.length > 1024) {
    warnings.push(`description exceeds 1024 characters (${metadata.description.length})`);
  }

  return { valid: errors.length === 0, errors, warnings };
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
        const metadata = parseCommandMetadata(sourcePath);
        const validation = validateCommandMetadata(metadata, name);
        commands.push({
          name,
          description: metadata?.description || extractDescription(fs.readFileSync(sourcePath, 'utf-8')),
          sourcePath,
          isShared: true,
          validation,
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
            const metadata = parseCommandMetadata(sourcePath);
            const validation = validateCommandMetadata(metadata, name);
            commands.push({
              name,
              description: metadata?.description || extractDescription(fs.readFileSync(sourcePath, 'utf-8')),
              sourcePath,
              isShared: false,
              agentSpecific: agentId,
              validation,
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
): CommandInstallation & { error?: string; warnings?: string[] } {
  // Validate command metadata before installation
  const metadata = parseCommandMetadata(sourcePath);
  const validation = validateCommandMetadata(metadata, commandName);

  if (!validation.valid) {
    return {
      path: '',
      method: 'copy',
      error: `Invalid command: ${validation.errors.join(', ')}`,
      warnings: validation.warnings,
    };
  }

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
    return { path: targetPath, method: 'copy', warnings: validation.warnings };
  }

  if (method === 'symlink') {
    fs.symlinkSync(sourcePath, targetPath);
    return { path: targetPath, method: 'symlink', warnings: validation.warnings };
  }

  fs.copyFileSync(sourcePath, targetPath);
  return { path: targetPath, method: 'copy', warnings: validation.warnings };
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
 * Check if a command exists for an agent.
 */
export function commandExists(agentId: AgentId, commandName: string): boolean {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const targetPath = path.join(agent.commandsDir, `${commandName}${ext}`);
  return fs.existsSync(targetPath);
}

/**
 * Normalize content for comparison (trim, normalize line endings).
 */
function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

/**
 * Check if installed command content matches source content.
 * Handles format conversion (markdown to TOML for Gemini).
 */
export function commandContentMatches(
  agentId: AgentId,
  commandName: string,
  sourcePath: string
): boolean {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const installedPath = path.join(agent.commandsDir, `${commandName}${ext}`);

  if (!fs.existsSync(installedPath) || !fs.existsSync(sourcePath)) {
    return false;
  }

  try {
    const installedContent = fs.readFileSync(installedPath, 'utf-8');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

    const sourceIsMarkdown = sourcePath.endsWith('.md');
    const needsConversion = agent.format === 'toml' && sourceIsMarkdown;

    if (needsConversion) {
      const convertedSource = markdownToToml(commandName, sourceContent);
      return normalizeContent(installedContent) === normalizeContent(convertedSource);
    }

    return normalizeContent(installedContent) === normalizeContent(sourceContent);
  } catch {
    return false;
  }
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
