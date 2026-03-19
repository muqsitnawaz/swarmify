#!/usr/bin/env node

/**
 * Postinstall script for @swarmify/agents-mcp
 * Detects installed agent CLIs and registers this MCP server with each.
 */

import { execSync, spawnSync } from 'child_process';

const MCP_NAME = 'Swarm';
const MCP_COMMAND = 'npx -y @swarmify/agents-mcp@latest';

// Agent configurations: CLI name, detection command, register command
const AGENTS = {
  claude: {
    name: 'Claude Code',
    cli: 'claude',
    register: `claude mcp add --scope user ${MCP_NAME} -- ${MCP_COMMAND}`,
    unregister: `claude mcp remove ${MCP_NAME} --scope user`,
  },
  codex: {
    name: 'Codex',
    cli: 'codex',
    register: `codex mcp add ${MCP_NAME.toLowerCase()} -- ${MCP_COMMAND}`,
    unregister: `codex mcp remove ${MCP_NAME.toLowerCase()}`,
  },
  gemini: {
    name: 'Gemini CLI',
    cli: 'gemini',
    register: `gemini mcp add ${MCP_NAME} "${MCP_COMMAND}"`,
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

function registerWithAgent(agentId, config) {
  try {
    const result = spawnSync('sh', ['-c', config.register], {
      stdio: 'pipe',
      timeout: 30000,
    });

    if (result.status === 0) {
      return { success: true };
    } else {
      const stderr = result.stderr?.toString() || '';
      if (stderr.includes('already exists') || stderr.includes('already registered')) {
        return { success: true, alreadyExists: true };
      }
      return { success: false, error: stderr || 'Unknown error' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function main() {
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  if (process.env.AGENTS_MCP_SKIP_POSTINSTALL === '1') {
    return;
  }

  console.log('\n@swarmify/agents-mcp - Auto-registering with detected agents...\n');

  const detected = [];
  const registered = [];
  const skipped = [];
  const failed = [];

  for (const [agentId, config] of Object.entries(AGENTS)) {
    if (isCliInstalled(config.cli)) {
      detected.push(config.name);
      const result = registerWithAgent(agentId, config);

      if (result.success) {
        if (result.alreadyExists) {
          skipped.push(`${config.name} (already registered)`);
        } else {
          registered.push(config.name);
        }
      } else {
        failed.push(`${config.name}: ${result.error}`);
      }
    }
  }

  if (detected.length === 0) {
    console.log('  No supported agent CLIs detected.');
    console.log('  Install Claude, Codex, or Gemini CLI, then run:');
    console.log('    npx @swarmify/agents-mcp --register\n');
    return;
  }

  if (registered.length > 0) {
    console.log('  Registered with:');
    for (const name of registered) {
      console.log(`    + ${name}`);
    }
  }

  if (skipped.length > 0) {
    console.log('  Already registered:');
    for (const name of skipped) {
      console.log(`    - ${name}`);
    }
  }

  if (failed.length > 0) {
    console.log('  Failed:');
    for (const msg of failed) {
      console.log(`    x ${msg}`);
    }
  }

  console.log('\n  Restart your agent to use Swarm tools.\n');
}

main();
