import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const EXTENSION_PATH = process.cwd();

let tempDir: string;

function makeTarget(agent: 'claude' | 'codex' | 'gemini', command: string): string {
  const ext = agent === 'gemini' ? 'toml' : 'md';
  return path.join(tempDir, `${agent}-${command}.${ext}`);
}

function setupMocks() {
  mock.module('./swarm.detect', () => {
    return {
      getAgentCommandPath: (agent: 'claude' | 'codex' | 'gemini', command = 'swarm') =>
        makeTarget(agent, command),
      isAgentCliAvailable: async () => true,
      isAgentMcpEnabled: async () => true,
      isAgentCommandInstalled: (agent: 'claude' | 'codex' | 'gemini', command = 'swarm') =>
        fs.existsSync(makeTarget(agent, command)),
    };
  });

  mock.module('vscode', () => ({
    window: {
      showWarningMessage: () => {},
      showErrorMessage: () => {},
      showInformationMessage: () => {},
    },
    env: {},
    commands: { executeCommand: () => {} },
  }));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-status-'));
});

afterEach(() => {
  mock.restore();
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('skills status and install', () => {
  test('marks builtin claude skills as installed and others missing', async () => {
    setupMocks();
    const mod = await import('./swarm.vscode');
    const status = await mod.getSkillsStatus();

    const plan = status.commands.find(c => c.name === 'plan');
    expect(plan).toBeDefined();
    expect(plan?.agents.claude.installed).toBe(true);
    expect(plan?.agents.claude.builtIn).toBe(true);
    expect(plan?.agents.codex.installed).toBe(false);
    expect(plan?.agents.gemini.installed).toBe(false);
  });

  test('installSkillCommand writes the file and flips status', async () => {
    setupMocks();
    const mod = await import('./swarm.vscode');
    const ctx = { extensionPath: EXTENSION_PATH } as any;

    const target = makeTarget('codex', 'plan');
    expect(fs.existsSync(target)).toBe(false);

    const ok = await mod.installSkillCommand('plan', 'codex', ctx);
    expect(ok).toBe(true);
    expect(fs.existsSync(target)).toBe(true);

    const status = await mod.getSkillsStatus();
    const plan = status.commands.find(c => c.name === 'plan');
    expect(plan?.agents.codex.installed).toBe(true);
  });
});
