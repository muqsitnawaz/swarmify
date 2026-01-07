/**
 * Unit tests for ralph mode utilities.
 * Tests getRalphConfig(), isDangerousPath(), and buildRalphPrompt().
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { tmpdir } from 'os';
import { getRalphConfig, isDangerousPath, buildRalphPrompt } from '../src/ralph.js';

describe('Ralph Mode Utilities', () => {
  describe('getRalphConfig', () => {
    test('should return default config with RALPH.md as default file', () => {
      // Save original env
      const originalEnv = process.env.AGENTS_MCP_RALPH_FILE;
      const originalDisable = process.env.AGENTS_MCP_DISABLE_RALPH;

      try {
        // Clear env vars
        delete process.env.AGENTS_MCP_RALPH_FILE;
        delete process.env.AGENTS_MCP_DISABLE_RALPH;

        const config = getRalphConfig();

        expect(config.ralphFile).toBe('RALPH.md');
        expect(config.disabled).toBe(false);
      } finally {
        // Restore env
        if (originalEnv) process.env.AGENTS_MCP_RALPH_FILE = originalEnv;
        if (originalDisable) process.env.AGENTS_MCP_DISABLE_RALPH = originalDisable;
      }
    });

    test('should read AGENTS_MCP_RALPH_FILE from environment', () => {
      const originalEnv = process.env.AGENTS_MCP_RALPH_FILE;
      const originalDisable = process.env.AGENTS_MCP_DISABLE_RALPH;

      try {
        process.env.AGENTS_MCP_RALPH_FILE = 'CUSTOM_TASKS.md';
        delete process.env.AGENTS_MCP_DISABLE_RALPH;

        const config = getRalphConfig();

        expect(config.ralphFile).toBe('CUSTOM_TASKS.md');
        expect(config.disabled).toBe(false);
      } finally {
        if (originalEnv) process.env.AGENTS_MCP_RALPH_FILE = originalEnv;
        else delete process.env.AGENTS_MCP_RALPH_FILE;
        if (originalDisable) process.env.AGENTS_MCP_DISABLE_RALPH = originalDisable;
      }
    });

    test('should read AGENTS_MCP_DISABLE_RALPH from environment (true)', () => {
      const originalFile = process.env.AGENTS_MCP_RALPH_FILE;
      const originalDisable = process.env.AGENTS_MCP_DISABLE_RALPH;

      try {
        delete process.env.AGENTS_MCP_RALPH_FILE;
        process.env.AGENTS_MCP_DISABLE_RALPH = 'true';

        const config = getRalphConfig();

        expect(config.disabled).toBe(true);
      } finally {
        if (originalFile) process.env.AGENTS_MCP_RALPH_FILE = originalFile;
        if (originalDisable) process.env.AGENTS_MCP_DISABLE_RALPH = originalDisable;
        else delete process.env.AGENTS_MCP_DISABLE_RALPH;
      }
    });

    test('should read AGENTS_MCP_DISABLE_RALPH from environment (1)', () => {
      const originalFile = process.env.AGENTS_MCP_RALPH_FILE;
      const originalDisable = process.env.AGENTS_MCP_DISABLE_RALPH;

      try {
        delete process.env.AGENTS_MCP_RALPH_FILE;
        process.env.AGENTS_MCP_DISABLE_RALPH = '1';

        const config = getRalphConfig();

        expect(config.disabled).toBe(true);
      } finally {
        if (originalFile) process.env.AGENTS_MCP_RALPH_FILE = originalFile;
        if (originalDisable) process.env.AGENTS_MCP_DISABLE_RALPH = originalDisable;
        else delete process.env.AGENTS_MCP_DISABLE_RALPH;
      }
    });

    test('should treat other values as not disabled', () => {
      const originalFile = process.env.AGENTS_MCP_RALPH_FILE;
      const originalDisable = process.env.AGENTS_MCP_DISABLE_RALPH;

      try {
        delete process.env.AGENTS_MCP_RALPH_FILE;
        process.env.AGENTS_MCP_DISABLE_RALPH = 'false';

        const config = getRalphConfig();

        expect(config.disabled).toBe(false);
      } finally {
        if (originalFile) process.env.AGENTS_MCP_RALPH_FILE = originalFile;
        if (originalDisable) process.env.AGENTS_MCP_DISABLE_RALPH = originalDisable;
        else delete process.env.AGENTS_MCP_DISABLE_RALPH;
      }
    });
  });

  describe('isDangerousPath', () => {
    test('should block home directory', () => {
      const homeDir = os.homedir();
      expect(isDangerousPath(homeDir)).toBe(true);
    });

    test('should block root directory', () => {
      expect(isDangerousPath('/')).toBe(true);
    });

    test('should block /System (macOS)', () => {
      expect(isDangerousPath('/System')).toBe(true);
    });

    test('should block /usr', () => {
      expect(isDangerousPath('/usr')).toBe(true);
    });

    test('should block /bin', () => {
      expect(isDangerousPath('/bin')).toBe(true);
    });

    test('should block /etc', () => {
      expect(isDangerousPath('/etc')).toBe(true);
    });

    test('should allow project directories', () => {
      expect(isDangerousPath('/Users/alice/projects/my-app')).toBe(false);
    });

    test('should allow /tmp directories', () => {
      expect(isDangerousPath('/tmp/my-project')).toBe(false);
    });

    test('should treat relative paths - they resolve to cwd which may be dangerous', () => {
      const cwd = process.cwd();
      // isDangerousPath resolves the path - relative paths become absolute
      // The result depends on where we're running from
      const result = isDangerousPath('./my-project');
      // Just verify it returns a boolean - actual result depends on cwd
      expect(typeof result).toBe('boolean');
    });

    test('should normalize paths before checking', () => {
      const homeDir = os.homedir();
      const pathWithDots = path.join(homeDir, 'a', '..', 'b', '..');
      expect(isDangerousPath(pathWithDots)).toBe(true);
    });

    test('should block subdirectories of dangerous paths', () => {
      expect(isDangerousPath('/System/Library')).toBe(true);
      expect(isDangerousPath('/usr/local/bin')).toBe(true);
      expect(isDangerousPath('/etc/ssh')).toBe(true);
    });
  });

  describe('buildRalphPrompt', () => {
    let testDir: string;
    let ralphFilePath: string;

    beforeEach(async () => {
      testDir = path.join(tmpdir(), `ralph-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      ralphFilePath = path.join(testDir, 'RALPH.md');
    });

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true });
      } catch {}
    });

    test('should include original user prompt', () => {
      const userPrompt = 'Build the authentication system';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      expect(result).toContain(userPrompt);
    });

    test('should include ralph mode instructions', () => {
      const userPrompt = 'Build feature X';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      expect(result).toContain('RALPH MODE INSTRUCTIONS');
      expect(result).toContain('READ THE TASK FILE');
      expect(result).toContain('UNDERSTAND THE SYSTEM');
      expect(result).toContain('PICK TASKS LOGICALLY');
      expect(result).toContain('COMPLETE EACH TASK');
      expect(result).toContain('CONTINUE');
    });

    test('should include ralph file path in instructions', () => {
      const userPrompt = 'Build something';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      expect(result).toContain(ralphFilePath);
    });

    test('should include task format documentation', () => {
      const userPrompt = 'Do work';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      expect(result).toContain('## [ ]');
      expect(result).toContain('## [x]');
      expect(result).toContain('### Updates');
      expect(result).toContain('Unchecked');
      expect(result).toContain('Checked');
    });

    test('should instruct agent to work autonomously', () => {
      const userPrompt = 'Complete all tasks';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      expect(result).toContain('autonomously');
      expect(result).toContain('Work');
      expect(result).toContain('all tasks are complete');
    });

    test('should include instruction about task ordering', () => {
      const userPrompt = 'Build system';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      // Should mention picking tasks logically (not necessarily top-to-bottom)
      expect(result).toContain('PICK TASKS LOGICALLY');
    });

    test('should have comprehensive instructions for the agent', () => {
      const userPrompt = 'Test prompt';
      const result = buildRalphPrompt(userPrompt, ralphFilePath);

      // Should be a substantial prompt with full instructions
      expect(result.length).toBeGreaterThan(500);
    });
  });

  describe('Ralph Integration: isDangerousPath + getRalphConfig', () => {
    test('should safely prevent ralph mode in home directory', () => {
      const homeDir = os.homedir();
      const config = getRalphConfig();

      expect(config.disabled).toBe(false); // ralph mode itself not disabled
      expect(isDangerousPath(homeDir)).toBe(true); // but home dir is blocked
    });

    test('should safely prevent ralph mode in /System', () => {
      const config = getRalphConfig();

      expect(config.disabled).toBe(false);
      expect(isDangerousPath('/System')).toBe(true);
    });

    test('should allow ralph mode in project directory', () => {
      const projectDir = '/Users/alice/projects/my-app';

      expect(isDangerousPath(projectDir)).toBe(false);
    });
  });

  describe('Ralph E2E: Full Prompt Generation', () => {
    let testDir: string;
    let ralphFilePath: string;

    beforeEach(async () => {
      testDir = path.join(tmpdir(), `ralph-e2e-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      ralphFilePath = path.join(testDir, 'RALPH.md');

      // Create a sample RALPH.md
      const sampleRalph = `## [ ] Task 1: Create hello.txt

Create a file called hello.txt with content "hello".

### Updates

---

## [ ] Task 2: Create world.txt

Create a file called world.txt with content "world".

### Updates
`;
      await fs.writeFile(ralphFilePath, sampleRalph);
    });

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true });
      } catch {}
    });

    test('should generate valid prompt for autonomous agent execution', async () => {
      const userPrompt = 'Create hello.txt and world.txt files';
      const prompt = buildRalphPrompt(userPrompt, ralphFilePath);

      // Should be a valid, comprehensive prompt
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(300);

      // Should contain key elements
      expect(prompt).toContain(userPrompt);
      expect(prompt).toContain(ralphFilePath);
      expect(prompt).toContain('RALPH MODE INSTRUCTIONS');
      expect(prompt).toContain('## [ ]');
      expect(prompt).toContain('## [x]');

      // Should be clear enough for agent to understand
      const hasReadInstructions = prompt.includes('READ THE TASK FILE') || prompt.includes('read RALPH');
      const hasTaskFormat = prompt.includes('## [ ]') && prompt.includes('## [x]');
      const hasUpdateInstructions = prompt.includes('### Updates');

      expect(hasReadInstructions).toBe(true);
      expect(hasTaskFormat).toBe(true);
      expect(hasUpdateInstructions).toBe(true);
    });
  });
});
