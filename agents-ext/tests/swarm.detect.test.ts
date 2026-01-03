import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  AGENT_COMMAND_PATHS,
  AgentCli,
  isAgentCliAvailable,
  isAgentCommandInstalled,
  isAgentMcpEnabled,
} from '../src/swarm.detect';

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

  test.each(AGENTS)('%s: MCP detection matches `<cli> mcp list` output', async (agent) => {
    const cliAvailable = await isAgentCliAvailable(agent);
    const detected = await isAgentMcpEnabled(agent);

    if (!cliAvailable) {
      expect(detected).toBe(false);
      return;
    }

    let listOutput = '';
    try {
      listOutput = execSync(`${agent} mcp list`, { encoding: 'utf8' });
    } catch {
      listOutput = '';
    }
    const expected = /swarm/i.test(listOutput) || /swarmify-agents/i.test(listOutput);
    expect(detected).toBe(expected);
  });

  test.each(AGENTS)('%s: slash command file detection matches filesystem', (agent) => {
    const path = AGENT_COMMAND_PATHS[agent];
    const expected = path ? fs.existsSync(path) : false;
    const installed = isAgentCommandInstalled(agent);
    expect(installed).toBe(expected);
  });
});
