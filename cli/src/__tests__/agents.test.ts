import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import {
  ALL_AGENTS,
  AGENT_CONFIG_DIRS,
  AGENT_SKILL_DIRS,
  AGENT_SKILL_EXT,
  getAgentSkillsDir,
  getSkillPath,
} from '../agents.js';

describe('agents', () => {
  describe('ALL_AGENTS', () => {
    it('should include all four agents', () => {
      expect(ALL_AGENTS).toContain('claude');
      expect(ALL_AGENTS).toContain('codex');
      expect(ALL_AGENTS).toContain('gemini');
      expect(ALL_AGENTS).toContain('cursor');
      expect(ALL_AGENTS).toHaveLength(4);
    });
  });

  describe('AGENT_CONFIG_DIRS', () => {
    it('should have correct paths for all agents', () => {
      const home = os.homedir();
      expect(AGENT_CONFIG_DIRS.claude).toBe(path.join(home, '.claude'));
      expect(AGENT_CONFIG_DIRS.codex).toBe(path.join(home, '.codex'));
      expect(AGENT_CONFIG_DIRS.gemini).toBe(path.join(home, '.gemini'));
      expect(AGENT_CONFIG_DIRS.cursor).toBe(path.join(home, '.cursor'));
    });
  });

  describe('AGENT_SKILL_DIRS', () => {
    it('should have correct subdirectories', () => {
      expect(AGENT_SKILL_DIRS.claude).toBe('commands');
      expect(AGENT_SKILL_DIRS.codex).toBe('prompts');
      expect(AGENT_SKILL_DIRS.gemini).toBe('commands');
      expect(AGENT_SKILL_DIRS.cursor).toBe('commands');
    });
  });

  describe('AGENT_SKILL_EXT', () => {
    it('should use md for most agents and toml for gemini', () => {
      expect(AGENT_SKILL_EXT.claude).toBe('md');
      expect(AGENT_SKILL_EXT.codex).toBe('md');
      expect(AGENT_SKILL_EXT.gemini).toBe('toml');
      expect(AGENT_SKILL_EXT.cursor).toBe('md');
    });
  });

  describe('getAgentSkillsDir', () => {
    it('should return correct skills directory for each agent', () => {
      const home = os.homedir();
      expect(getAgentSkillsDir('claude')).toBe(path.join(home, '.claude', 'commands'));
      expect(getAgentSkillsDir('codex')).toBe(path.join(home, '.codex', 'prompts'));
      expect(getAgentSkillsDir('gemini')).toBe(path.join(home, '.gemini', 'commands'));
      expect(getAgentSkillsDir('cursor')).toBe(path.join(home, '.cursor', 'commands'));
    });
  });

  describe('getSkillPath', () => {
    it('should return correct skill file path with proper extension', () => {
      const home = os.homedir();
      expect(getSkillPath('claude', 'plan')).toBe(path.join(home, '.claude', 'commands', 'plan.md'));
      expect(getSkillPath('codex', 'debug')).toBe(path.join(home, '.codex', 'prompts', 'debug.md'));
      expect(getSkillPath('gemini', 'test')).toBe(path.join(home, '.gemini', 'commands', 'test.toml'));
      expect(getSkillPath('cursor', 'ship')).toBe(path.join(home, '.cursor', 'commands', 'ship.md'));
    });
  });
});
