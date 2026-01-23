import * as fs from 'fs';
import * as path from 'path';
import { AGENTS, ensureCommandsDir } from './agents.js';
import { markdownToToml } from './convert.js';
import type { AgentId, SkillInstallation } from './types.js';

export interface DiscoveredSkill {
  name: string;
  description: string;
  sourcePath: string;
  isShared: boolean;
  agentSpecific?: AgentId;
}

export function discoverSkills(repoPath: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const seen = new Set<string>();

  const sharedDir = path.join(repoPath, 'shared', 'commands');
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir)) {
      if (file.endsWith('.md')) {
        const name = file.replace('.md', '');
        const sourcePath = path.join(sharedDir, file);
        const content = fs.readFileSync(sourcePath, 'utf-8');
        const description = extractDescription(content);
        skills.push({
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
            skills.push({
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

  return skills;
}

function extractDescription(content: string): string {
  const match = content.match(/description:\s*(.+)/i);
  if (match) return match[1].trim();

  const tomlMatch = content.match(/description\s*=\s*"([^"]+)"/);
  if (tomlMatch) return tomlMatch[1];

  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('---'));
  return firstLine?.slice(0, 80) || '';
}

export function resolveSkillSource(
  repoPath: string,
  skillName: string,
  agentId: AgentId
): string | null {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';

  const agentSpecific = path.join(
    repoPath,
    agentId,
    agent.commandsSubdir,
    `${skillName}${ext}`
  );
  if (fs.existsSync(agentSpecific)) {
    return agentSpecific;
  }

  const shared = path.join(repoPath, 'shared', 'commands', `${skillName}.md`);
  if (fs.existsSync(shared)) {
    return shared;
  }

  return null;
}

export function installSkill(
  sourcePath: string,
  agentId: AgentId,
  skillName: string,
  method: 'symlink' | 'copy' = 'symlink'
): SkillInstallation {
  const agent = AGENTS[agentId];
  ensureCommandsDir(agentId);

  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const targetPath = path.join(agent.commandsDir, `${skillName}${ext}`);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  const sourceIsMarkdown = sourcePath.endsWith('.md');
  const needsConversion = agent.format === 'toml' && sourceIsMarkdown;

  if (needsConversion) {
    const tomlContent = markdownToToml(skillName, sourceContent);
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

export function uninstallSkill(agentId: AgentId, skillName: string): boolean {
  const agent = AGENTS[agentId];
  const ext = agent.format === 'toml' ? '.toml' : '.md';
  const targetPath = path.join(agent.commandsDir, `${skillName}${ext}`);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return true;
  }
  return false;
}

export function listInstalledSkills(agentId: AgentId): string[] {
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
