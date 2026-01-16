import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  SKILL_DEFINITIONS,
  getCanonicalSkillsDir,
  getCanonicalSkillPath,
  hasCanonicalSkill,
  readCanonicalSkill,
  convertToGeminiToml,
  installSkillToAgent,
  getSkillsStatus,
} from '../skills.js';

describe('skills', () => {
  describe('SKILL_DEFINITIONS', () => {
    it('should have all expected skills', () => {
      const skillNames = SKILL_DEFINITIONS.map(s => s.name);
      expect(skillNames).toContain('swarm');
      expect(skillNames).toContain('plan');
      expect(skillNames).toContain('splan');
      expect(skillNames).toContain('debug');
      expect(skillNames).toContain('sdebug');
      expect(skillNames).toContain('test');
      expect(skillNames).toContain('ship');
      expect(skillNames).toContain('recap');
      expect(skillNames).toContain('simagine');
    });

    it('should mark plan as builtin for claude', () => {
      const planSkill = SKILL_DEFINITIONS.find(s => s.name === 'plan');
      expect(planSkill?.agents.claude).toBe('builtin');
    });

    it('should mark simagine as only supported by codex', () => {
      const simagineSkill = SKILL_DEFINITIONS.find(s => s.name === 'simagine');
      expect(simagineSkill?.agents.codex).toBe('supported');
      expect(simagineSkill?.agents.claude).toBeUndefined();
      expect(simagineSkill?.agents.gemini).toBeUndefined();
      expect(simagineSkill?.agents.cursor).toBeUndefined();
    });

    it('should have descriptions for all skills', () => {
      for (const skill of SKILL_DEFINITIONS) {
        expect(skill.description).toBeTruthy();
        expect(skill.description.length).toBeGreaterThan(5);
      }
    });
  });

  describe('getCanonicalSkillsDir', () => {
    it('should return ~/.swarmify/skills', () => {
      expect(getCanonicalSkillsDir()).toBe(path.join(os.homedir(), '.swarmify', 'skills'));
    });
  });

  describe('getCanonicalSkillPath', () => {
    it('should return correct path for skill', () => {
      const expected = path.join(os.homedir(), '.swarmify', 'skills', 'plan.md');
      expect(getCanonicalSkillPath('plan')).toBe(expected);
    });
  });

  describe('convertToGeminiToml', () => {
    it('should convert markdown to TOML format', () => {
      const markdown = `# Test Skill

This is a test skill.

## Instructions

1. Do something
2. Do something else`;

      const toml = convertToGeminiToml('test', markdown);

      expect(toml).toContain('name = "test"');
      expect(toml).toContain('description = "Run test command"');
      expect(toml).toContain('prompt = """');
      expect(toml).toContain('# Test Skill');
      expect(toml).toContain('This is a test skill.');
      expect(toml).toContain('"""');
    });

    it('should trim trailing whitespace from markdown', () => {
      const markdown = 'Some content   \n\n\n';
      const toml = convertToGeminiToml('trim', markdown);

      // Should not end with extra newlines before closing """
      expect(toml).toMatch(/Some content\n"""\n$/);
    });
  });

  describe('installSkillToAgent', () => {
    const testDir = path.join(os.tmpdir(), 'swarm-cli-test-' + Date.now());
    const originalHome = process.env.HOME;

    beforeEach(() => {
      fs.mkdirSync(testDir, { recursive: true });
      // We can't easily mock os.homedir(), so we'll test the return values
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should return success=false for unknown skill', () => {
      const result = installSkillToAgent('unknown' as any, 'claude', 'content');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Unknown skill');
    });

    it('should return success=false for unsupported agent', () => {
      const result = installSkillToAgent('simagine', 'claude', 'content');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Not supported for this agent');
    });

    it('should return success=true with builtin reason for builtin skills', () => {
      const result = installSkillToAgent('plan', 'claude', 'content');
      expect(result.success).toBe(true);
      expect(result.reason).toBe('Built-in to agent');
    });
  });

  describe('getSkillsStatus', () => {
    it('should return status for all skills', () => {
      const statuses = getSkillsStatus();

      expect(statuses.length).toBe(SKILL_DEFINITIONS.length);

      for (const status of statuses) {
        expect(status.name).toBeTruthy();
        expect(status.description).toBeTruthy();
        expect(typeof status.hasCanonicalSource).toBe('boolean');
        expect(status.agents).toHaveProperty('claude');
        expect(status.agents).toHaveProperty('codex');
        expect(status.agents).toHaveProperty('gemini');
        expect(status.agents).toHaveProperty('cursor');
      }
    });

    it('should correctly identify builtin skills', () => {
      const statuses = getSkillsStatus();
      const planStatus = statuses.find(s => s.name === 'plan');

      expect(planStatus?.agents.claude.builtin).toBe(true);
      expect(planStatus?.agents.codex.builtin).toBe(false);
    });

    it('should correctly identify unsupported skills', () => {
      const statuses = getSkillsStatus();
      const simagineStatus = statuses.find(s => s.name === 'simagine');

      expect(simagineStatus?.agents.codex.supported).toBe(true);
      expect(simagineStatus?.agents.claude.supported).toBe(false);
      expect(simagineStatus?.agents.gemini.supported).toBe(false);
      expect(simagineStatus?.agents.cursor.supported).toBe(false);
    });
  });

  describe('hasCanonicalSkill and readCanonicalSkill', () => {
    // These depend on filesystem state, which may vary
    // The tests check the integration with the init command

    it('hasCanonicalSkill should return boolean', () => {
      const result = hasCanonicalSkill('nonexistent-skill-xyz');
      expect(typeof result).toBe('boolean');
    });

    it('readCanonicalSkill should return null for missing skill', () => {
      const result = readCanonicalSkill('nonexistent-skill-xyz');
      expect(result).toBeNull();
    });
  });
});
