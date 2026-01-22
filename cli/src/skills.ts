/**
 * Skill definitions and synchronization logic
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  PromptPackAgent,
  ALL_AGENTS,
  getAgentSkillsDir,
  getSkillPath,
  isSkillInstalled,
  AGENT_SKILL_EXT,
} from './agents.js';

export type SkillName =
  | 'swarm'
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
  /** Which agents support this skill. 'builtin' means the agent has it natively */
  agents: Partial<Record<PromptPackAgent, 'supported' | 'builtin'>>;
}

/**
 * All available skills and their agent support matrix
 */
export const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    name: 'swarm',
    description: 'Master orchestration command for multi-agent workflows',
    agents: { claude: 'supported', codex: 'supported', gemini: 'supported', cursor: 'supported', opencode: 'supported' },
  },
  {
    name: 'plan',
    description: 'Create a concise implementation plan',
    agents: { claude: 'builtin', codex: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'splan',
    description: 'Sprint-sized plan with parallel steps',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'debug',
    description: 'Diagnose the root cause before fixing',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'sdebug',
    description: 'Parallelize the debugging investigation',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'sconfirm',
    description: 'Confirm with parallel checks',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'clean',
    description: 'Refactor safely for clarity',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'sclean',
    description: 'Parallel refactor plan',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'test',
    description: 'Design a lean test plan',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'stest',
    description: 'Parallelize test creation',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'ship',
    description: 'Pre-launch verification',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'sship',
    description: 'Ship with independent assessment',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'recap',
    description: 'Facts + grounded hypotheses for handoff',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'srecap',
    description: 'Agents investigate gaps before handoff',
    agents: { claude: 'supported', codex: 'supported', cursor: 'supported', gemini: 'supported', opencode: 'supported' },
  },
  {
    name: 'simagine',
    description: 'Swarm visual asset prompting',
    agents: { codex: 'supported' },
  },
];

/**
 * Get the canonical commands directory (single source of truth)
 */
export function getCanonicalSkillsDir(): string {
  return path.join(os.homedir(), '.agents', 'commands');
}

/**
 * Get the path to a canonical skill source file
 */
export function getCanonicalSkillPath(skillName: string): string {
  return path.join(getCanonicalSkillsDir(), `${skillName}.md`);
}

/**
 * Check if a canonical skill source exists
 */
export function hasCanonicalSkill(skillName: string): boolean {
  return fs.existsSync(getCanonicalSkillPath(skillName));
}

/**
 * Read a canonical skill's content
 */
export function readCanonicalSkill(skillName: string): string | null {
  const skillPath = getCanonicalSkillPath(skillName);
  if (!fs.existsSync(skillPath)) {
    return null;
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

/**
 * Convert markdown content to Gemini TOML format
 */
export function convertToGeminiToml(skillName: string, markdown: string): string {
  return [
    `name = "${skillName}"`,
    `description = "Run ${skillName} command"`,
    'prompt = """',
    markdown.trimEnd(),
    '"""',
    '',
  ].join('\n');
}

export interface InstallResult {
  agent: PromptPackAgent;
  skill: SkillName;
  success: boolean;
  reason?: string;
}

/**
 * Install a skill to a specific agent
 */
export function installSkillToAgent(
  skillName: SkillName,
  agent: PromptPackAgent,
  content: string
): InstallResult {
  const result: InstallResult = { agent, skill: skillName, success: false };

  // Check if skill supports this agent
  const skillDef = SKILL_DEFINITIONS.find(s => s.name === skillName);
  if (!skillDef) {
    result.reason = 'Unknown skill';
    return result;
  }

  const agentSupport = skillDef.agents[agent];
  if (!agentSupport) {
    result.reason = 'Not supported for this agent';
    return result;
  }

  if (agentSupport === 'builtin') {
    result.success = true;
    result.reason = 'Built-in to agent';
    return result;
  }

  // Convert content for Gemini if needed
  const finalContent = agent === 'gemini'
    ? convertToGeminiToml(skillName, content)
    : content;

  // Ensure directory exists
  const skillsDir = getAgentSkillsDir(agent);
  try {
    fs.mkdirSync(skillsDir, { recursive: true });
  } catch (err) {
    result.reason = `Failed to create directory: ${(err as Error).message}`;
    return result;
  }

  // Write the skill file
  const targetPath = getSkillPath(agent, skillName);
  try {
    fs.writeFileSync(targetPath, finalContent);
    result.success = true;
  } catch (err) {
    result.reason = `Failed to write file: ${(err as Error).message}`;
  }

  return result;
}

/**
 * Sync a skill from canonical source to all supported agents
 */
export function syncSkillToAllAgents(skillName: SkillName): InstallResult[] {
  const results: InstallResult[] = [];
  const content = readCanonicalSkill(skillName);

  if (!content) {
    return ALL_AGENTS.map(agent => ({
      agent,
      skill: skillName,
      success: false,
      reason: 'No canonical source found',
    }));
  }

  for (const agent of ALL_AGENTS) {
    results.push(installSkillToAgent(skillName, agent, content));
  }

  return results;
}

/**
 * Sync all skills to all agents
 */
export function syncAllSkills(): Map<SkillName, InstallResult[]> {
  const results = new Map<SkillName, InstallResult[]>();

  for (const skillDef of SKILL_DEFINITIONS) {
    const content = readCanonicalSkill(skillDef.name);
    if (!content) {
      results.set(skillDef.name, ALL_AGENTS.map(agent => ({
        agent,
        skill: skillDef.name,
        success: false,
        reason: 'No canonical source found',
      })));
      continue;
    }

    const skillResults: InstallResult[] = [];
    for (const agent of ALL_AGENTS) {
      skillResults.push(installSkillToAgent(skillDef.name, agent, content));
    }
    results.set(skillDef.name, skillResults);
  }

  return results;
}

export interface SkillStatus {
  name: SkillName;
  description: string;
  hasCanonicalSource: boolean;
  agents: Record<PromptPackAgent, {
    supported: boolean;
    builtin: boolean;
    installed: boolean;
  }>;
}

/**
 * Get the status of all skills across all agents
 */
export function getSkillsStatus(): SkillStatus[] {
  const statuses: SkillStatus[] = [];

  for (const skillDef of SKILL_DEFINITIONS) {
    const status: SkillStatus = {
      name: skillDef.name,
      description: skillDef.description,
      hasCanonicalSource: hasCanonicalSkill(skillDef.name),
      agents: {
        claude: { supported: false, builtin: false, installed: false },
        codex: { supported: false, builtin: false, installed: false },
        gemini: { supported: false, builtin: false, installed: false },
        cursor: { supported: false, builtin: false, installed: false },
        opencode: { supported: false, builtin: false, installed: false },
      },
    };

    for (const agent of ALL_AGENTS) {
      const agentSupport = skillDef.agents[agent];
      status.agents[agent] = {
        supported: !!agentSupport,
        builtin: agentSupport === 'builtin',
        installed: agentSupport === 'builtin' || isSkillInstalled(agent, skillDef.name),
      };
    }

    statuses.push(status);
  }

  return statuses;
}
