import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import type { AgentId, SkillMetadata, InstalledSkill, SkillState } from './types.js';
import { AGENTS, SKILLS_CAPABLE_AGENTS, ensureSkillsDir } from './agents.js';
import { readMeta, writeMeta, getAgentsDir } from './state.js';

const HOME = os.homedir();

export function getSkillsDir(): string {
  return path.join(getAgentsDir(), 'skills');
}

export function ensureCentralSkillsDir(): void {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getAgentSkillsDir(agentId: AgentId): string {
  return AGENTS[agentId].skillsDir;
}

export function getProjectSkillsDir(agentId: AgentId, cwd: string = process.cwd()): string {
  return path.join(cwd, `.${agentId}`, 'skills');
}

export function parseSkillMetadata(skillDir: string): SkillMetadata | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const lines = content.split('\n');

    // Check for YAML frontmatter
    if (lines[0] === '---') {
      const endIndex = lines.slice(1).findIndex((l) => l === '---');
      if (endIndex > 0) {
        const frontmatter = lines.slice(1, endIndex + 1).join('\n');
        const parsed = yaml.parse(frontmatter);
        return {
          name: parsed.name || path.basename(skillDir),
          description: parsed.description || '',
          author: parsed.author,
          version: parsed.version,
          license: parsed.license,
          keywords: parsed.keywords,
        };
      }
    }

    // Fallback: extract from markdown content
    const name = path.basename(skillDir);
    const descMatch = content.match(/^#\s+.+\n+(.+)/m);
    return {
      name,
      description: descMatch ? descMatch[1].trim() : '',
    };
  } catch {
    return {
      name: path.basename(skillDir),
      description: '',
    };
  }
}

export function countSkillRules(skillDir: string): number {
  const rulesDir = path.join(skillDir, 'rules');
  if (!fs.existsSync(rulesDir)) {
    return 0;
  }

  try {
    const files = fs.readdirSync(rulesDir);
    return files.filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

export interface DiscoveredSkill {
  name: string;
  path: string;
  metadata: SkillMetadata;
  ruleCount: number;
}

export function discoverSkillsFromRepo(repoPath: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];

  // Look for skills in common locations
  const searchPaths = [
    path.join(repoPath, 'skills'),
    path.join(repoPath, 'agent-skills'),
    repoPath, // Root level skill directories
  ];

  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue;

    try {
      const entries = fs.readdirSync(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(searchPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        if (fs.existsSync(skillMdPath)) {
          const metadata = parseSkillMetadata(skillDir);
          if (metadata) {
            skills.push({
              name: entry.name,
              path: skillDir,
              metadata,
              ruleCount: countSkillRules(skillDir),
            });
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return skills;
}

export function installSkill(
  sourcePath: string,
  skillName: string,
  agents: AgentId[],
  method: 'symlink' | 'copy' = 'symlink'
): { success: boolean; error?: string } {
  ensureCentralSkillsDir();

  const centralPath = path.join(getSkillsDir(), skillName);

  // Copy to central location if not already there
  if (!fs.existsSync(centralPath)) {
    try {
      fs.cpSync(sourcePath, centralPath, { recursive: true });
    } catch (err) {
      return { success: false, error: `Failed to copy skill: ${(err as Error).message}` };
    }
  }

  // Symlink to each agent
  for (const agentId of agents) {
    if (!SKILLS_CAPABLE_AGENTS.includes(agentId)) {
      continue;
    }

    ensureSkillsDir(agentId);
    const agentSkillPath = path.join(getAgentSkillsDir(agentId), skillName);

    // Remove existing if present
    if (fs.existsSync(agentSkillPath)) {
      try {
        fs.rmSync(agentSkillPath, { recursive: true, force: true });
      } catch {
        // Ignore removal errors
      }
    }

    try {
      if (method === 'symlink') {
        fs.symlinkSync(centralPath, agentSkillPath, 'dir');
      } else {
        fs.cpSync(centralPath, agentSkillPath, { recursive: true });
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to ${method} skill to ${agentId}: ${(err as Error).message}`,
      };
    }
  }

  // Update state
  const meta = readMeta();
  const metadata = parseSkillMetadata(centralPath);
  meta.skills[skillName] = {
    source: sourcePath,
    ruleCount: countSkillRules(centralPath),
    installations: agents.reduce(
      (acc, agentId) => {
        acc[agentId] = {
          path: path.join(getAgentSkillsDir(agentId), skillName),
          method,
        };
        return acc;
      },
      {} as SkillState['installations']
    ),
  };
  writeMeta(meta);

  return { success: true };
}

export function uninstallSkill(skillName: string): { success: boolean; error?: string } {
  const meta = readMeta();
  const skillState = meta.skills[skillName];

  if (!skillState) {
    return { success: false, error: `Skill '${skillName}' not found` };
  }

  // Remove from all agents
  for (const [agentId, installation] of Object.entries(skillState.installations)) {
    if (installation?.path && fs.existsSync(installation.path)) {
      try {
        fs.rmSync(installation.path, { recursive: true, force: true });
      } catch {
        // Ignore removal errors
      }
    }
  }

  // Remove from central location
  const centralPath = path.join(getSkillsDir(), skillName);
  if (fs.existsSync(centralPath)) {
    try {
      fs.rmSync(centralPath, { recursive: true, force: true });
    } catch {
      // Ignore removal errors
    }
  }

  // Update state
  delete meta.skills[skillName];
  writeMeta(meta);

  return { success: true };
}

export function listInstalledSkills(): Map<string, DiscoveredSkill> {
  const skills = new Map<string, DiscoveredSkill>();
  const centralDir = getSkillsDir();

  if (!fs.existsSync(centralDir)) {
    return skills;
  }

  try {
    const entries = fs.readdirSync(centralDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(centralDir, entry.name);
      const metadata = parseSkillMetadata(skillDir);

      if (metadata) {
        skills.set(entry.name, {
          name: entry.name,
          path: skillDir,
          metadata,
          ruleCount: countSkillRules(skillDir),
        });
      }
    }
  } catch {
    // Ignore errors
  }

  return skills;
}

export function listInstalledSkillsWithScope(
  agentId: AgentId,
  cwd: string = process.cwd()
): InstalledSkill[] {
  const results: InstalledSkill[] = [];

  // User-scoped skills
  const userSkillsDir = getAgentSkillsDir(agentId);
  if (fs.existsSync(userSkillsDir)) {
    try {
      const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(userSkillsDir, entry.name);
        const metadata = parseSkillMetadata(skillDir);

        if (metadata) {
          results.push({
            name: entry.name,
            path: skillDir,
            metadata,
            ruleCount: countSkillRules(skillDir),
            scope: 'user',
            agent: agentId,
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Project-scoped skills
  const projectSkillsDir = getProjectSkillsDir(agentId, cwd);
  if (fs.existsSync(projectSkillsDir)) {
    try {
      const entries = fs.readdirSync(projectSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(projectSkillsDir, entry.name);
        const metadata = parseSkillMetadata(skillDir);

        if (metadata) {
          results.push({
            name: entry.name,
            path: skillDir,
            metadata,
            ruleCount: countSkillRules(skillDir),
            scope: 'project',
            agent: agentId,
          });
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return results;
}

export function promoteSkillToUser(
  agentId: AgentId,
  skillName: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const projectSkillsDir = getProjectSkillsDir(agentId, cwd);
  const projectSkillPath = path.join(projectSkillsDir, skillName);

  if (!fs.existsSync(projectSkillPath)) {
    return { success: false, error: `Project skill '${skillName}' not found` };
  }

  ensureSkillsDir(agentId);
  const userSkillPath = path.join(getAgentSkillsDir(agentId), skillName);

  // Check if already exists
  if (fs.existsSync(userSkillPath)) {
    return { success: false, error: `User skill '${skillName}' already exists` };
  }

  try {
    fs.cpSync(projectSkillPath, userSkillPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to copy skill: ${(err as Error).message}` };
  }
}

export function getSkillInfo(skillName: string): DiscoveredSkill | null {
  const centralPath = path.join(getSkillsDir(), skillName);
  if (!fs.existsSync(centralPath)) {
    return null;
  }

  const metadata = parseSkillMetadata(centralPath);
  if (!metadata) {
    return null;
  }

  return {
    name: skillName,
    path: centralPath,
    metadata,
    ruleCount: countSkillRules(centralPath),
  };
}

export function getSkillRules(skillName: string): string[] {
  const centralPath = path.join(getSkillsDir(), skillName);
  const rulesDir = path.join(centralPath, 'rules');

  if (!fs.existsSync(rulesDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(rulesDir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}
