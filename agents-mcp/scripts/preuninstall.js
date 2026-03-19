#!/usr/bin/env node

/**
 * Preuninstall script for @swarmify/agents-mcp
 * Unregisters this MCP server from all detected agents.
 */

import { execSync, spawnSync } from 'child_process';

const MCP_NAME = 'Swarm';

const AGENTS = {
  claude: {
    name: 'Claude Code',
    cli: 'claude',
    unregister: `claude mcp remove ${MCP_NAME} --scope user`,
  },
  codex: {
    name: 'Codex',
    cli: 'codex',
    unregister: `codex mcp remove ${MCP_NAME.toLowerCase()}`,
  },
  gemini: {
    name: 'Gemini CLI',
    cli: 'gemini',
    unregister: `gemini mcp remove ${MCP_NAME}`,
  },
};

function isCliInstalled(cli) {
  try {
    execSync(`which ${cli}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function unregisterFromAgent(config) {
  try {
    const result = spawnSync('sh', ['-c', config.unregister], {
      stdio: 'pipe',
      timeout: 30000,
    });
    return { success: result.status === 0 };
  } catch {
    return { success: false };
  }
}

function main() {
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  if (process.env.AGENTS_MCP_SKIP_PREUNINSTALL === '1') {
    return;
  }

  console.log('\n@swarmify/agents-mcp - Unregistering from agents...\n');

  const removed = [];

  for (const [agentId, config] of Object.entries(AGENTS)) {
    if (isCliInstalled(config.cli)) {
      const result = unregisterFromAgent(config);
      if (result.success) {
        removed.push(config.name);
      }
    }
  }

  if (removed.length > 0) {
    console.log('  Unregistered from:');
    for (const name of removed) {
      console.log(`    - ${name}`);
    }
    console.log('');
  }
}

main();
