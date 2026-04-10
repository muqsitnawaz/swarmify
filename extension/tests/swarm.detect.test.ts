import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  AGENT_COMMAND_PATHS,
  AgentCli,
  isAgentCliAvailable,
  isAgentCommandInstalled,
  isAgentMcpEnabled,
} from '../src/core/swarm.detect';

const AGENTS: AgentCli[] = ['claude', 'codex', 'gemini'];

function whichExists(binary: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${binary}` : `which ${binary}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('swarm.detect integration (uses local CLIs)', () => {
  test.each(AGENTS)('%s: CLI availability matches system lookup', async (agent) => {
    const expected = whichExists(agent);
    const available = await isAgentCliAvailable(agent);
    expect(available).toBe(expected);
  });

  test.each(AGENTS)(
    '%s: MCP detection returns boolean without throwing',
    async (agent) => {
      const detected = await isAgentMcpEnabled(agent);
      expect(typeof detected).toBe('boolean');

      if (!await isAgentCliAvailable(agent)) {
        expect(detected).toBe(false);
      }
    },
    10000,
  );

  test.each(AGENTS)('%s: slash command file detection matches filesystem', (agent) => {
    const path = AGENT_COMMAND_PATHS[agent];
    const expected = path ? fs.existsSync(path) : false;
    const installed = isAgentCommandInstalled(agent);
    expect(installed).toBe(expected);
  });
});
