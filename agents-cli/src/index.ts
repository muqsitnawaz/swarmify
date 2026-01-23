#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { checkbox, confirm, select } from '@inquirer/prompts';
import {
  AGENTS,
  ALL_AGENT_IDS,
  MCP_CAPABLE_AGENTS,
  getAllCliStates,
  isCliInstalled,
  getCliVersion,
  isMcpRegistered,
  registerMcp,
  unregisterMcp,
  listInstalledMcpsWithScope,
  promoteMcpToUser,
} from './lib/agents.js';
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
  MANIFEST_FILENAME,
} from './lib/manifest.js';
import {
  readState,
  writeState,
  ensureAgentsDir,
  getRepoLocalPath,
} from './lib/state.js';
import { cloneRepo, parseSource } from './lib/git.js';
import {
  discoverCommands,
  resolveCommandSource,
  installCommand,
  uninstallCommand,
  listInstalledCommands,
  listInstalledCommandsWithScope,
  promoteCommandToUser,
} from './lib/skills.js';
import type { AgentId, Manifest } from './lib/types.js';

const DEFAULT_AGENTS_REPO = 'gh:muqsitnawaz/.agents';

const program = new Command();

/**
 * Ensure a .agents repo source is configured.
 * If not, automatically pull from the default repo.
 * Returns the source string.
 */
async function ensureSource(): Promise<string> {
  const state = readState();
  if (state.source) {
    return state.source;
  }

  console.log(chalk.gray(`No repo configured. Initializing from ${DEFAULT_AGENTS_REPO}...`));

  const { localPath } = await cloneRepo(DEFAULT_AGENTS_REPO);

  writeState({
    ...state,
    source: DEFAULT_AGENTS_REPO,
    lastSync: new Date().toISOString(),
  });

  return DEFAULT_AGENTS_REPO;
}

program
  .name('agents')
  .description('Dotfiles manager for AI coding agents')
  .version('1.0.0');

// =============================================================================
// STATUS COMMAND
// =============================================================================

program
  .command('status')
  .description('Show sync status, CLI versions, installed commands and MCP servers')
  .action(() => {
    const state = readState();
    const cliStates = getAllCliStates();
    const cwd = process.cwd();

    console.log(chalk.bold('\nAgent CLIs\n'));
    for (const agentId of ALL_AGENT_IDS) {
      const agent = AGENTS[agentId];
      const cli = cliStates[agentId];
      const status = cli?.installed
        ? chalk.green(cli.version || 'installed')
        : chalk.gray('not installed');
      console.log(`  ${agent.name.padEnd(14)} ${status}`);
    }

    console.log(chalk.bold('\nInstalled Commands\n'));
    for (const agentId of ALL_AGENT_IDS) {
      const agent = AGENTS[agentId];
      const commands = listInstalledCommandsWithScope(agentId, cwd);
      const userCommands = commands.filter((c) => c.scope === 'user');
      const projectCommands = commands.filter((c) => c.scope === 'project');

      if (commands.length > 0) {
        const parts: string[] = [];
        if (userCommands.length > 0) {
          parts.push(`${chalk.cyan(userCommands.length)} user`);
        }
        if (projectCommands.length > 0) {
          parts.push(`${chalk.yellow(projectCommands.length)} project`);
        }
        console.log(`  ${agent.name}: ${parts.join(', ')}`);
      }
    }

    console.log(chalk.bold('\nInstalled MCP Servers\n'));
    for (const agentId of MCP_CAPABLE_AGENTS) {
      const agent = AGENTS[agentId];
      if (!isCliInstalled(agentId)) continue;

      const mcps = listInstalledMcpsWithScope(agentId, cwd);
      const userMcps = mcps.filter((m) => m.scope === 'user');
      const projectMcps = mcps.filter((m) => m.scope === 'project');

      if (mcps.length > 0) {
        const parts: string[] = [];
        if (userMcps.length > 0) {
          parts.push(`${chalk.cyan(userMcps.length)} user`);
        }
        if (projectMcps.length > 0) {
          parts.push(`${chalk.yellow(projectMcps.length)} project`);
        }
        console.log(`  ${agent.name}: ${parts.join(', ')}`);
      }
    }

    if (state.source) {
      console.log(chalk.bold('\nSync Source\n'));
      console.log(`  ${state.source}`);
      if (state.lastSync) {
        console.log(`  Last sync: ${new Date(state.lastSync).toLocaleString()}`);
      }
    }

    console.log();
  });

// =============================================================================
// PULL COMMAND
// =============================================================================

program
  .command('pull [source]')
  .description('Pull and sync from remote .agents repo')
  .option('-y, --yes', 'Skip interactive prompts')
  .option('-f, --force', 'Overwrite local changes')
  .option('--dry-run', 'Show what would change')
  .option('--skip-clis', 'Skip CLI installation')
  .option('--skip-mcp', 'Skip MCP registration')
  .action(async (source: string | undefined, options) => {
    const state = readState();
    const targetSource = source || state.source;

    if (!targetSource) {
      console.log(chalk.red('No source specified. Usage: agents pull <source>'));
      console.log(chalk.gray('  Example: agents pull gh:username/.agents'));
      process.exit(1);
    }

    const spinner = ora('Cloning repository...').start();

    try {
      const { localPath, commit, isNew } = await cloneRepo(targetSource);
      spinner.succeed(isNew ? 'Repository cloned' : 'Repository updated');

      const manifest = readManifest(localPath);
      if (!manifest) {
        console.log(chalk.yellow(`No ${MANIFEST_FILENAME} found in repository`));
      }

      const commands = discoverCommands(localPath);
      console.log(chalk.bold(`\nFound ${commands.length} commands\n`));

      for (const command of commands.slice(0, 10)) {
        const source = command.isShared ? 'shared' : command.agentSpecific;
        console.log(`  ${chalk.cyan(command.name.padEnd(20))} ${chalk.gray(source)}`);
      }
      if (commands.length > 10) {
        console.log(chalk.gray(`  ... and ${commands.length - 10} more`));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\nDry run - no changes made'));
        return;
      }

      let selectedAgents: AgentId[];
      let method: 'symlink' | 'copy';

      if (options.yes) {
        selectedAgents = (manifest?.defaults?.agents || ['claude', 'codex', 'gemini']) as AgentId[];
        method = manifest?.defaults?.method || 'symlink';
      } else {
        const installedAgents = ALL_AGENT_IDS.filter((id) => isCliInstalled(id) || id === 'cursor');

        selectedAgents = await checkbox({
          message: 'Select agents to sync:',
          choices: installedAgents.map((id) => ({
            name: AGENTS[id].name,
            value: id,
            checked: (manifest?.defaults?.agents || ['claude', 'codex', 'gemini']).includes(id),
          })),
        });

        method = await select({
          message: 'Installation method:',
          choices: [
            { name: 'Symlink (updates automatically)', value: 'symlink' as const },
            { name: 'Copy (independent files)', value: 'copy' as const },
          ],
          default: manifest?.defaults?.method || 'symlink',
        });
      }

      const defaultAgents = selectedAgents;

      const installSpinner = ora('Installing commands...').start();
      let installed = 0;

      for (const command of commands) {
        for (const agentId of defaultAgents as AgentId[]) {
          if (!isCliInstalled(agentId) && agentId !== 'cursor') continue;

          const sourcePath = resolveCommandSource(localPath, command.name, agentId);
          if (sourcePath) {
            installCommand(sourcePath, agentId, command.name, method);
            installed++;
          }
        }
      }

      installSpinner.succeed(`Installed ${installed} command instances`);

      if (!options.skipMcp && manifest?.mcp) {
        const mcpSpinner = ora('Registering MCP servers...').start();
        let registered = 0;

        for (const [name, config] of Object.entries(manifest.mcp)) {
          for (const agentId of config.agents) {
            if (!isCliInstalled(agentId)) continue;
            if (isMcpRegistered(agentId, name)) continue;

            const result = registerMcp(agentId, name, config.command, config.scope);
            if (result.success) registered++;
          }
        }

        mcpSpinner.succeed(`Registered ${registered} MCP servers`);
      }

      writeState({
        ...state,
        source: targetSource,
        lastSync: new Date().toISOString(),
      });

      console.log(chalk.green('\nSync complete.'));
    } catch (err) {
      spinner.fail('Failed to sync');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

// =============================================================================
// PUSH COMMAND
// =============================================================================

program
  .command('push')
  .description('Export local configuration to .agents repo for manual commit')
  .option('--export-only', 'Only export, do not update manifest')
  .action(async (options) => {
    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath) || createDefaultManifest();

    console.log(chalk.bold('\nExporting local configuration...\n'));

    const cliStates = getAllCliStates();
    let exported = 0;

    for (const agentId of ALL_AGENT_IDS) {
      const agent = AGENTS[agentId];
      const cli = cliStates[agentId];

      if (cli?.installed && cli.version) {
        manifest.clis = manifest.clis || {};
        manifest.clis[agentId] = {
          package: agent.npmPackage,
          version: cli.version,
        };
        console.log(`  ${chalk.green('+')} ${agent.name} @ ${cli.version}`);
        exported++;
      }
    }

    if (!options.exportOnly) {
      writeManifest(localPath, manifest);
      console.log(chalk.bold(`\nUpdated ${MANIFEST_FILENAME}`));
    }

    console.log(chalk.bold('\nNext steps:'));
    console.log(chalk.gray(`  cd ${localPath}`));
    console.log(chalk.gray('  git add -A'));
    console.log(chalk.gray('  git commit -m "Update agent configuration"'));
    console.log(chalk.gray('  git push'));
    console.log();
  });

// =============================================================================
// SYNC COMMAND
// =============================================================================

program
  .command('sync [source]')
  .description('Bidirectional sync with remote .agents repo')
  .option('-y, --yes', 'Skip interactive prompts')
  .option('-f, --force', 'Overwrite local changes')
  .action(async (source: string | undefined, options) => {
    const args = ['pull'];
    if (source) args.push(source);
    if (options.yes) args.push('-y');
    if (options.force) args.push('-f');
    await program.commands.find((c) => c.name() === 'pull')?.parseAsync(args, { from: 'user' });
  });

// =============================================================================
// COMMANDS COMMANDS
// =============================================================================

const commandsCmd = program
  .command('commands')
  .description('Manage slash commands');

commandsCmd
  .command('list')
  .description('List installed commands')
  .option('-a, --agent <agent>', 'Show commands for specific agent')
  .option('-s, --scope <scope>', 'Filter by scope: user, project, or all', 'all')
  .action((options) => {
    console.log(chalk.bold('\nInstalled Commands\n'));
    const cwd = process.cwd();

    const agents = options.agent
      ? [options.agent as AgentId]
      : ALL_AGENT_IDS;

    for (const agentId of agents) {
      const agent = AGENTS[agentId];
      let commands = listInstalledCommandsWithScope(agentId, cwd);

      if (options.scope !== 'all') {
        commands = commands.filter((c) => c.scope === options.scope);
      }

      if (commands.length === 0) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
      } else {
        console.log(`  ${chalk.bold(agent.name)}:`);

        const userCommands = commands.filter((c) => c.scope === 'user');
        const projectCommands = commands.filter((c) => c.scope === 'project');

        if (userCommands.length > 0 && (options.scope === 'all' || options.scope === 'user')) {
          console.log(`    ${chalk.gray('User:')}`);
          for (const cmd of userCommands) {
            console.log(`      ${chalk.cyan(cmd.name)}`);
          }
        }

        if (projectCommands.length > 0 && (options.scope === 'all' || options.scope === 'project')) {
          console.log(`    ${chalk.gray('Project:')}`);
          for (const cmd of projectCommands) {
            console.log(`      ${chalk.yellow(cmd.name)}`);
          }
        }
      }
      console.log();
    }
  });

commandsCmd
  .command('add <source>')
  .description('Add commands from Git repo or local path')
  .option('-a, --agents <list>', 'Comma-separated agents to install to')
  .action(async (source: string, options) => {
    const spinner = ora('Fetching commands...').start();

    try {
      const { localPath } = await cloneRepo(source);
      const commands = discoverCommands(localPath);
      spinner.succeed(`Found ${commands.length} commands`);

      const agents = options.agents
        ? (options.agents.split(',') as AgentId[])
        : (['claude', 'codex', 'gemini'] as AgentId[]);

      for (const command of commands) {
        console.log(`\n  ${chalk.cyan(command.name)}: ${command.description}`);

        for (const agentId of agents) {
          if (!isCliInstalled(agentId) && agentId !== 'cursor') continue;

          const sourcePath = resolveCommandSource(localPath, command.name, agentId);
          if (sourcePath) {
            installCommand(sourcePath, agentId, command.name, 'symlink');
            console.log(`    ${chalk.green('+')} ${AGENTS[agentId].name}`);
          }
        }
      }

      console.log(chalk.green('\nCommands installed.'));
    } catch (err) {
      spinner.fail('Failed to add commands');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

commandsCmd
  .command('remove <name>')
  .description('Remove a command from all agents')
  .option('-a, --agents <list>', 'Comma-separated agents to remove from')
  .action((name: string, options) => {
    const agents = options.agents
      ? (options.agents.split(',') as AgentId[])
      : ALL_AGENT_IDS;

    let removed = 0;
    for (const agentId of agents) {
      if (uninstallCommand(agentId, name)) {
        console.log(`  ${chalk.red('-')} ${AGENTS[agentId].name}`);
        removed++;
      }
    }

    if (removed === 0) {
      console.log(chalk.yellow(`Command '${name}' not found`));
    } else {
      console.log(chalk.green(`\nRemoved from ${removed} agents.`));
    }
  });

commandsCmd
  .command('push <name>')
  .description('Save project-scoped command to user scope')
  .option('-a, --agents <list>', 'Comma-separated agents to push for')
  .action((name: string, options) => {
    const cwd = process.cwd();
    const agents = options.agents
      ? (options.agents.split(',') as AgentId[])
      : ALL_AGENT_IDS;

    let pushed = 0;
    for (const agentId of agents) {
      if (!isCliInstalled(agentId) && agentId !== 'cursor') continue;

      const result = promoteCommandToUser(agentId, name, cwd);
      if (result.success) {
        console.log(`  ${chalk.green('+')} ${AGENTS[agentId].name}`);
        pushed++;
      } else if (result.error && !result.error.includes('not found')) {
        console.log(`  ${chalk.red('x')} ${AGENTS[agentId].name}: ${result.error}`);
      }
    }

    if (pushed === 0) {
      console.log(chalk.yellow(`Project command '${name}' not found for any agent`));
    } else {
      console.log(chalk.green(`\nPushed to user scope for ${pushed} agents.`));
    }
  });

// =============================================================================
// MCP COMMANDS
// =============================================================================

const mcpCmd = program
  .command('mcp')
  .description('Manage MCP servers');

mcpCmd
  .command('list')
  .description('List MCP servers and registration status')
  .option('-s, --scope <scope>', 'Filter by scope: user, project, or all', 'all')
  .action((options) => {
    console.log(chalk.bold('\nMCP Servers\n'));
    const cwd = process.cwd();

    for (const agentId of MCP_CAPABLE_AGENTS) {
      const agent = AGENTS[agentId];
      if (!isCliInstalled(agentId)) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('CLI not installed')}`);
        continue;
      }

      let mcps = listInstalledMcpsWithScope(agentId, cwd);

      if (options.scope !== 'all') {
        mcps = mcps.filter((m) => m.scope === options.scope);
      }

      if (mcps.length === 0) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
      } else {
        console.log(`  ${chalk.bold(agent.name)}:`);

        const userMcps = mcps.filter((m) => m.scope === 'user');
        const projectMcps = mcps.filter((m) => m.scope === 'project');

        if (userMcps.length > 0 && (options.scope === 'all' || options.scope === 'user')) {
          console.log(`    ${chalk.gray('User:')}`);
          for (const mcp of userMcps) {
            console.log(`      ${chalk.cyan(mcp.name)}`);
          }
        }

        if (projectMcps.length > 0 && (options.scope === 'all' || options.scope === 'project')) {
          console.log(`    ${chalk.gray('Project:')}`);
          for (const mcp of projectMcps) {
            console.log(`      ${chalk.yellow(mcp.name)}`);
          }
        }
      }
      console.log();
    }
  });

mcpCmd
  .command('add <name> <command>')
  .description('Add MCP server to manifest')
  .option('-a, --agents <list>', 'Comma-separated agents', 'claude,codex,gemini')
  .option('-s, --scope <scope>', 'Scope: user or project', 'user')
  .action(async (name: string, command: string, options) => {
    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath) || createDefaultManifest();

    manifest.mcp = manifest.mcp || {};
    manifest.mcp[name] = {
      command,
      transport: 'stdio',
      scope: options.scope as 'user' | 'project',
      agents: options.agents.split(',') as AgentId[],
    };

    writeManifest(localPath, manifest);
    console.log(chalk.green(`Added MCP server '${name}' to manifest`));
    console.log(chalk.gray('Run: agents mcp register to apply'));
  });

mcpCmd
  .command('remove <name>')
  .description('Remove MCP server from agents')
  .option('-a, --agents <list>', 'Comma-separated agents')
  .action((name: string, options) => {
    const agents = options.agents
      ? (options.agents.split(',') as AgentId[])
      : MCP_CAPABLE_AGENTS;

    let removed = 0;
    for (const agentId of agents) {
      if (!isCliInstalled(agentId)) continue;

      const result = unregisterMcp(agentId, name);
      if (result.success) {
        console.log(`  ${chalk.red('-')} ${AGENTS[agentId].name}`);
        removed++;
      }
    }

    if (removed === 0) {
      console.log(chalk.yellow(`MCP '${name}' not found or not registered`));
    } else {
      console.log(chalk.green(`\nRemoved from ${removed} agents.`));
    }
  });

mcpCmd
  .command('register [name]')
  .description('Register MCP server(s) with agent CLIs')
  .option('-a, --agents <list>', 'Comma-separated agents')
  .action(async (name: string | undefined, options) => {
    if (!name) {
      const source = await ensureSource();
      const localPath = getRepoLocalPath(source);
      const manifest = readManifest(localPath);

      if (!manifest?.mcp) {
        console.log(chalk.yellow('No MCP servers in manifest'));
        return;
      }

      for (const [mcpName, config] of Object.entries(manifest.mcp)) {
        console.log(`\n  ${chalk.cyan(mcpName)}:`);
        for (const agentId of config.agents) {
          if (!isCliInstalled(agentId)) continue;

          const result = registerMcp(agentId, mcpName, config.command, config.scope);
          if (result.success) {
            console.log(`    ${chalk.green('+')} ${AGENTS[agentId].name}`);
          } else {
            console.log(`    ${chalk.red('x')} ${AGENTS[agentId].name}: ${result.error}`);
          }
        }
      }
      return;
    }

    console.log(chalk.yellow('Single MCP registration not yet implemented'));
  });

mcpCmd
  .command('push <name>')
  .description('Save project-scoped MCP to user scope')
  .option('-a, --agents <list>', 'Comma-separated agents to push for')
  .action((name: string, options) => {
    const cwd = process.cwd();
    const agents = options.agents
      ? (options.agents.split(',') as AgentId[])
      : MCP_CAPABLE_AGENTS;

    let pushed = 0;
    for (const agentId of agents) {
      if (!isCliInstalled(agentId)) continue;

      const result = promoteMcpToUser(agentId, name, cwd);
      if (result.success) {
        console.log(`  ${chalk.green('+')} ${AGENTS[agentId].name}`);
        pushed++;
      } else if (result.error && !result.error.includes('not found')) {
        console.log(`  ${chalk.red('x')} ${AGENTS[agentId].name}: ${result.error}`);
      }
    }

    if (pushed === 0) {
      console.log(chalk.yellow(`Project MCP '${name}' not found for any agent`));
    } else {
      console.log(chalk.green(`\nPushed to user scope for ${pushed} agents.`));
    }
  });

// =============================================================================
// CLI COMMANDS
// =============================================================================

const cliCmd = program
  .command('cli')
  .description('Manage agent CLIs');

cliCmd
  .command('list')
  .description('List installed agent CLIs')
  .action(() => {
    console.log(chalk.bold('\nAgent CLIs\n'));

    const states = getAllCliStates();
    for (const agentId of ALL_AGENT_IDS) {
      const agent = AGENTS[agentId];
      const state = states[agentId];

      if (state?.installed) {
        console.log(`  ${agent.name.padEnd(14)} ${chalk.green(state.version || 'installed')}`);
        if (state.path) {
          console.log(`  ${''.padEnd(14)} ${chalk.gray(state.path)}`);
        }
      } else {
        console.log(`  ${agent.name.padEnd(14)} ${chalk.gray('not installed')}`);
      }
    }
    console.log();
  });

cliCmd
  .command('add <agent>')
  .description('Add agent CLI to manifest')
  .option('-v, --version <version>', 'Version to pin', 'latest')
  .action(async (agent: string, options) => {
    const agentId = agent.toLowerCase() as AgentId;
    if (!AGENTS[agentId]) {
      console.log(chalk.red(`Unknown agent: ${agent}`));
      console.log(chalk.gray(`Available: ${ALL_AGENT_IDS.join(', ')}`));
      return;
    }

    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath) || createDefaultManifest();

    manifest.clis = manifest.clis || {};
    manifest.clis[agentId] = {
      package: AGENTS[agentId].npmPackage,
      version: options.version,
    };

    writeManifest(localPath, manifest);
    console.log(chalk.green(`Added ${AGENTS[agentId].name} CLI to manifest`));
  });

cliCmd
  .command('remove <agent>')
  .description('Remove agent CLI from manifest')
  .action(async (agent: string) => {
    const source = await ensureSource();
    const agentId = agent.toLowerCase() as AgentId;
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath);

    if (manifest?.clis?.[agentId]) {
      delete manifest.clis[agentId];
      writeManifest(localPath, manifest);
      console.log(chalk.green(`Removed ${AGENTS[agentId]?.name || agent} CLI from manifest`));
    } else {
      console.log(chalk.yellow(`${agent} not in manifest`));
    }
  });

cliCmd
  .command('upgrade [agent]')
  .description('Upgrade agent CLI(s) to version in manifest')
  .option('--latest', 'Upgrade to latest version (ignore manifest)')
  .action(async (agent: string | undefined, options) => {
    const state = readState();
    const localPath = state.source ? getRepoLocalPath(state.source) : null;
    const manifest = localPath ? readManifest(localPath) : null;

    const agentsToUpgrade: AgentId[] = agent
      ? [agent.toLowerCase() as AgentId]
      : ALL_AGENT_IDS.filter((id) => manifest?.clis?.[id] || options.latest);

    if (agentsToUpgrade.length === 0) {
      console.log(chalk.yellow('No CLIs to upgrade. Add CLIs to manifest or use --latest'));
      return;
    }

    const { execSync } = await import('child_process');

    for (const agentId of agentsToUpgrade) {
      const agentConfig = AGENTS[agentId];
      if (!agentConfig) {
        console.log(chalk.red(`Unknown agent: ${agentId}`));
        continue;
      }

      const cliConfig = manifest?.clis?.[agentId];
      const version = options.latest ? 'latest' : (cliConfig?.version || 'latest');
      const pkg = cliConfig?.package || agentConfig.npmPackage;

      const spinner = ora(`Upgrading ${agentConfig.name} to ${version}...`).start();

      try {
        execSync(`npm install -g ${pkg}@${version}`, { stdio: 'pipe' });
        spinner.succeed(`${agentConfig.name} upgraded to ${version}`);
      } catch (err) {
        spinner.fail(`Failed to upgrade ${agentConfig.name}`);
        console.error(chalk.gray((err as Error).message));
      }
    }
  });

// =============================================================================
// INIT COMMAND
// =============================================================================

program
  .command('init')
  .description('Initialize a new .agents repo')
  .action(() => {
    ensureAgentsDir();

    const manifest = createDefaultManifest();
    console.log(chalk.bold('\nDefault agents.yaml:\n'));
    console.log(chalk.gray('clis:'));
    console.log(chalk.gray('  claude:'));
    console.log(chalk.gray('    package: "@anthropic-ai/claude-code"'));
    console.log(chalk.gray('    version: "latest"'));
    console.log(chalk.gray('  codex:'));
    console.log(chalk.gray('    package: "@openai/codex"'));
    console.log(chalk.gray('    version: "latest"'));
    console.log();
    console.log(chalk.green('Create a new repo with this structure:'));
    console.log(chalk.gray('  .agents/'));
    console.log(chalk.gray('    agents.yaml'));
    console.log(chalk.gray('    shared/commands/'));
    console.log(chalk.gray('    claude/hooks/'));
    console.log();
  });

program.parse();
