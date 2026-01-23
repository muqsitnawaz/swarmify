#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { checkbox, confirm, select } from '@inquirer/prompts';
import {
  AGENTS,
  ALL_AGENT_IDS,
  MCP_CAPABLE_AGENTS,
  SKILLS_CAPABLE_AGENTS,
  HOOKS_CAPABLE_AGENTS,
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
  getScope,
  setScope,
  removeScope,
  getScopesByPriority,
  getScopePriority,
} from './lib/state.js';
import { SCOPE_PRIORITIES, DEFAULT_SYSTEM_REPO } from './lib/types.js';
import type { ScopeName, ScopeConfig } from './lib/types.js';
import { cloneRepo, parseSource } from './lib/git.js';
import {
  discoverCommands,
  resolveCommandSource,
  installCommand,
  uninstallCommand,
  listInstalledCommands,
  listInstalledCommandsWithScope,
  promoteCommandToUser,
} from './lib/commands.js';
import {
  discoverHooksFromRepo,
  installHooks,
  listInstalledHooksWithScope,
  promoteHookToUser,
  removeHook,
} from './lib/hooks.js';
import {
  discoverSkillsFromRepo,
  installSkill,
  uninstallSkill,
  listInstalledSkillsWithScope,
  promoteSkillToUser,
  getSkillInfo,
  getSkillRules,
} from './lib/skills.js';
import type { AgentId, Manifest } from './lib/types.js';

const program = new Command();

/**
 * Ensure at least one scope is configured.
 * If not, automatically initialize the system scope from DEFAULT_SYSTEM_REPO.
 * Returns the highest priority scope's source.
 */
async function ensureSource(scopeName?: ScopeName): Promise<string> {
  const meta = readState();

  // If specific scope requested, check if it exists
  if (scopeName) {
    const scope = meta.scopes[scopeName];
    if (scope?.source) {
      return scope.source;
    }
    throw new Error(`Scope '${scopeName}' not configured. Run: agents repo add <source> --scope ${scopeName}`);
  }

  // Check if any scope is configured
  const scopes = getScopesByPriority();
  if (scopes.length > 0) {
    // Return highest priority scope's source
    return scopes[scopes.length - 1].config.source;
  }

  // No scopes configured - initialize system scope
  console.log(chalk.gray(`No repo configured. Initializing system scope from ${DEFAULT_SYSTEM_REPO}...`));

  const parsed = parseSource(DEFAULT_SYSTEM_REPO);
  const { commit } = await cloneRepo(DEFAULT_SYSTEM_REPO);

  setScope('system', {
    source: DEFAULT_SYSTEM_REPO,
    branch: parsed.ref || 'main',
    commit,
    lastSync: new Date().toISOString(),
    priority: SCOPE_PRIORITIES.system,
    readonly: true,
  });

  return DEFAULT_SYSTEM_REPO;
}

/**
 * Get repo local path for a scope.
 */
function getScopeLocalPath(scopeName: ScopeName): string | null {
  const scope = getScope(scopeName);
  if (!scope) return null;
  return getRepoLocalPath(scope.source);
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

    console.log(chalk.bold('\nInstalled Skills\n'));
    for (const agentId of SKILLS_CAPABLE_AGENTS) {
      const agent = AGENTS[agentId];
      const skills = listInstalledSkillsWithScope(agentId, cwd);
      const userSkills = skills.filter((s) => s.scope === 'user');
      const projectSkills = skills.filter((s) => s.scope === 'project');

      if (skills.length > 0) {
        const parts: string[] = [];
        if (userSkills.length > 0) {
          parts.push(`${chalk.cyan(userSkills.length)} user`);
        }
        if (projectSkills.length > 0) {
          parts.push(`${chalk.yellow(projectSkills.length)} project`);
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

    const scopes = getScopesByPriority();
    if (scopes.length > 0) {
      console.log(chalk.bold('\nConfigured Scopes\n'));
      for (const { name, config } of scopes) {
        const readonlyTag = config.readonly ? chalk.gray(' (readonly)') : '';
        const priorityTag = chalk.gray(` [priority: ${config.priority}]`);
        console.log(`  ${chalk.bold(name)}${readonlyTag}${priorityTag}`);
        console.log(`    ${config.source}`);
        console.log(`    Branch: ${config.branch}  Commit: ${config.commit.substring(0, 8)}`);
        console.log(`    Last sync: ${new Date(config.lastSync).toLocaleString()}`);
      }
    } else {
      console.log(chalk.bold('\nNo scopes configured\n'));
      console.log(chalk.gray('  Run: agents repo add <source> --scope user'));
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
  .option('-s, --scope <scope>', 'Scope to pull: system, user, project, or custom name', 'user')
  .option('--dry-run', 'Show what would change')
  .option('--skip-clis', 'Skip CLI installation')
  .option('--skip-mcp', 'Skip MCP registration')
  .action(async (source: string | undefined, options) => {
    const scopeName = options.scope as ScopeName;
    const meta = readState();
    const existingScope = meta.scopes[scopeName];
    const targetSource = source || existingScope?.source;

    if (!targetSource) {
      console.log(chalk.red(`No source specified for scope '${scopeName}'.`));
      console.log(chalk.gray(`  Usage: agents pull <source> --scope ${scopeName}`));
      console.log(chalk.gray('  Example: agents pull gh:username/.agents --scope user'));
      process.exit(1);
    }

    // Prevent modification of readonly scopes
    if (existingScope?.readonly && !options.force) {
      console.log(chalk.red(`Scope '${scopeName}' is readonly. Use --force to override.`));
      process.exit(1);
    }

    const parsed = parseSource(targetSource);
    const spinner = ora(`Cloning repository for ${scopeName} scope...`).start();

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
        const src = command.isShared ? 'shared' : command.agentSpecific;
        console.log(`  ${chalk.cyan(command.name.padEnd(20))} ${chalk.gray(src)}`);
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

      // Update scope config
      const priority = getScopePriority(scopeName);
      setScope(scopeName, {
        source: targetSource,
        branch: parsed.ref || 'main',
        commit,
        lastSync: new Date().toISOString(),
        priority,
        readonly: scopeName === 'system',
      });

      console.log(chalk.green(`\nSync complete. Updated scope: ${scopeName}`));
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
  .option('-s, --scope <scope>', 'Scope to push to', 'user')
  .option('--export-only', 'Only export, do not update manifest')
  .action(async (options) => {
    const scopeName = options.scope as ScopeName;
    const scope = getScope(scopeName);

    if (!scope) {
      console.log(chalk.red(`Scope '${scopeName}' not configured.`));
      console.log(chalk.gray(`  Run: agents repo add <source> --scope ${scopeName}`));
      process.exit(1);
    }

    if (scope.readonly) {
      console.log(chalk.red(`Scope '${scopeName}' is readonly. Cannot push.`));
      process.exit(1);
    }

    const localPath = getRepoLocalPath(scope.source);
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
  .option('-a, --agent <agent>', 'Filter by agent')
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
            const desc = cmd.description ? ` - ${chalk.gray(cmd.description)}` : '';
            console.log(`      ${chalk.cyan(cmd.name)}${desc}`);
          }
        }

        if (projectCommands.length > 0 && (options.scope === 'all' || options.scope === 'project')) {
          console.log(`    ${chalk.gray('Project:')}`);
          for (const cmd of projectCommands) {
            const desc = cmd.description ? ` - ${chalk.gray(cmd.description)}` : '';
            console.log(`      ${chalk.yellow(cmd.name)}${desc}`);
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

const hooksCmd = program.command('hooks').description('Manage hooks');

hooksCmd
  .command('list')
  .description('List installed hooks')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-s, --scope <scope>', 'Filter by scope: user, project, or all', 'all')
  .action((options) => {
    console.log(chalk.bold('\nInstalled Hooks\n'));
    const cwd = process.cwd();

    const agents = options.agent
      ? [options.agent as AgentId]
      : (Array.from(HOOKS_CAPABLE_AGENTS) as AgentId[]);

    for (const agentId of agents) {
      const agent = AGENTS[agentId];
      if (!agent.supportsHooks) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('hooks not supported')}`);
        console.log();
        continue;
      }

      let hooks = listInstalledHooksWithScope(agentId, cwd);

      if (options.scope !== 'all') {
        hooks = hooks.filter((h) => h.scope === options.scope);
      }

      if (hooks.length === 0) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
      } else {
        console.log(`  ${chalk.bold(agent.name)}:`);

        const userHooks = hooks.filter((h) => h.scope === 'user');
        const projectHooks = hooks.filter((h) => h.scope === 'project');

        if (userHooks.length > 0 && (options.scope === 'all' || options.scope === 'user')) {
          console.log(`    ${chalk.gray('User:')}`);
          for (const hook of userHooks) {
            console.log(`      ${chalk.cyan(hook.name)}`);
          }
        }

        if (projectHooks.length > 0 && (options.scope === 'all' || options.scope === 'project')) {
          console.log(`    ${chalk.gray('Project:')}`);
          for (const hook of projectHooks) {
            console.log(`      ${chalk.yellow(hook.name)}`);
          }
        }
      }
      console.log();
    }
  });

hooksCmd
  .command('add <source>')
  .description('Install hooks from git repo or local path')
  .option('-a, --agent <agents>', 'Target agents (comma-separated)', 'claude,gemini')
  .action(async (source: string, options) => {
    const spinner = ora('Fetching hooks...').start();

    try {
      const { localPath } = await cloneRepo(source);
      const hooks = discoverHooksFromRepo(localPath);
      const hookNames = new Set<string>();
      for (const name of hooks.shared) {
        hookNames.add(name);
      }
      for (const list of Object.values(hooks.agentSpecific)) {
        for (const name of list) {
          hookNames.add(name);
        }
      }
      spinner.succeed(`Found ${hookNames.size} hooks`);

      const agents = options.agent
        ? (options.agent.split(',') as AgentId[])
        : (['claude', 'gemini'] as AgentId[]);

      const result = await installHooks(localPath, agents, { scope: 'user' });
      const installedByHook = new Map<string, AgentId[]>();
      for (const item of result.installed) {
        const [name, agentId] = item.split(':') as [string, AgentId];
        const list = installedByHook.get(name) || [];
        list.push(agentId);
        installedByHook.set(name, list);
      }

      const orderedHooks = Array.from(installedByHook.keys()).sort((a, b) => a.localeCompare(b));
      for (const name of orderedHooks) {
        console.log(`\n  ${chalk.cyan(name)}`);
        const agentIds = installedByHook.get(name) || [];
        agentIds.sort();
        for (const agentId of agentIds) {
          console.log(`    ${AGENTS[agentId].name}`);
        }
      }

      if (result.errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        for (const error of result.errors) {
          console.log(chalk.red(`  ${error}`));
        }
      }

      if (result.installed.length === 0) {
        console.log(chalk.yellow('\nNo hooks installed.'));
      } else {
        console.log(chalk.green('\nHooks installed.'));
      }
    } catch (err) {
      spinner.fail('Failed to add hooks');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

hooksCmd
  .command('remove <name>')
  .description('Remove a hook')
  .option('-a, --agent <agents>', 'Target agents (comma-separated)')
  .action(async (name: string, options) => {
    const agents = options.agent
      ? (options.agent.split(',') as AgentId[])
      : (Array.from(HOOKS_CAPABLE_AGENTS) as AgentId[]);

    const result = await removeHook(name, agents);
    let removed = 0;
    for (const item of result.removed) {
      const [, agentId] = item.split(':') as [string, AgentId];
      console.log(`  ${AGENTS[agentId].name}`);
      removed++;
    }

    if (result.errors.length > 0) {
      console.log(chalk.red('\nErrors:'));
      for (const error of result.errors) {
        console.log(chalk.red(`  ${error}`));
      }
    }

    if (removed === 0) {
      console.log(chalk.yellow(`Hook '${name}' not found`));
    } else {
      console.log(chalk.green(`\nRemoved from ${removed} agents.`));
    }
  });

hooksCmd
  .command('push <name>')
  .description('Copy project-scoped hook to user scope')
  .option('-a, --agent <agents>', 'Target agents (comma-separated)')
  .action((name: string, options) => {
    const cwd = process.cwd();
    const agents = options.agent
      ? (options.agent.split(',') as AgentId[])
      : (Array.from(HOOKS_CAPABLE_AGENTS) as AgentId[]);

    let pushed = 0;
    for (const agentId of agents) {
      const result = promoteHookToUser(agentId, name, cwd);
      if (result.success) {
        console.log(`  ${AGENTS[agentId].name}`);
        pushed++;
      } else if (result.error && !result.error.includes('not found')) {
        console.log(`  ${AGENTS[agentId].name}: ${result.error}`);
      }
    }

    if (pushed === 0) {
      console.log(chalk.yellow(`Project hook '${name}' not found for any agent`));
    } else {
      console.log(chalk.green(`\nPushed to user scope for ${pushed} agents.`));
    }
  });

// =============================================================================
// SKILLS COMMANDS (Agent Skills)
// =============================================================================

const skillsCmd = program
  .command('skills')
  .description('Manage Agent Skills (SKILL.md + rules/)');

skillsCmd
  .command('list')
  .description('List installed Agent Skills')
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-s, --scope <scope>', 'Filter by scope: user, project, or all', 'all')
  .action((options) => {
    console.log(chalk.bold('\nInstalled Agent Skills\n'));
    const cwd = process.cwd();

    const agents = options.agent
      ? [options.agent as AgentId]
      : SKILLS_CAPABLE_AGENTS;

    for (const agentId of agents) {
      const agent = AGENTS[agentId];
      if (!agent.capabilities.skills) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('skills not supported')}`);
        console.log();
        continue;
      }

      let skills = listInstalledSkillsWithScope(agentId, cwd);

      if (options.scope !== 'all') {
        skills = skills.filter((s) => s.scope === options.scope);
      }

      if (skills.length === 0) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
      } else {
        console.log(`  ${chalk.bold(agent.name)}:`);

        const userSkills = skills.filter((s) => s.scope === 'user');
        const projectSkills = skills.filter((s) => s.scope === 'project');

        if (userSkills.length > 0 && (options.scope === 'all' || options.scope === 'user')) {
          console.log(`    ${chalk.gray('User:')}`);
          for (const skill of userSkills) {
            const desc = skill.metadata.description ? ` - ${chalk.gray(skill.metadata.description)}` : '';
            const ruleInfo = skill.ruleCount > 0 ? chalk.gray(` (${skill.ruleCount} rules)`) : '';
            console.log(`      ${chalk.cyan(skill.name)}${desc}${ruleInfo}`);
          }
        }

        if (projectSkills.length > 0 && (options.scope === 'all' || options.scope === 'project')) {
          console.log(`    ${chalk.gray('Project:')}`);
          for (const skill of projectSkills) {
            const desc = skill.metadata.description ? ` - ${chalk.gray(skill.metadata.description)}` : '';
            const ruleInfo = skill.ruleCount > 0 ? chalk.gray(` (${skill.ruleCount} rules)`) : '';
            console.log(`      ${chalk.yellow(skill.name)}${desc}${ruleInfo}`);
          }
        }
      }
      console.log();
    }
  });

skillsCmd
  .command('add <source>')
  .description('Add Agent Skills from Git repo or local path')
  .option('-a, --agents <list>', 'Comma-separated agents to install to')
  .action(async (source: string, options) => {
    const spinner = ora('Fetching skills...').start();

    try {
      const { localPath } = await cloneRepo(source);
      const skills = discoverSkillsFromRepo(localPath);
      spinner.succeed(`Found ${skills.length} skills`);

      if (skills.length === 0) {
        console.log(chalk.yellow('No skills found (looking for SKILL.md files)'));
        return;
      }

      for (const skill of skills) {
        console.log(`\n  ${chalk.cyan(skill.name)}: ${skill.metadata.description || 'no description'}`);
        if (skill.ruleCount > 0) {
          console.log(`    ${chalk.gray(`${skill.ruleCount} rules`)}`);
        }
      }

      const agents = options.agents
        ? (options.agents.split(',') as AgentId[])
        : await checkbox({
            message: 'Select agents to install skills to:',
            choices: SKILLS_CAPABLE_AGENTS.filter((id) => isCliInstalled(id) || id === 'cursor').map((id) => ({
              name: AGENTS[id].name,
              value: id,
              checked: ['claude', 'codex', 'gemini'].includes(id),
            })),
          });

      if (agents.length === 0) {
        console.log(chalk.yellow('\nNo agents selected.'));
        return;
      }

      const installSpinner = ora('Installing skills...').start();
      let installed = 0;

      for (const skill of skills) {
        const result = installSkill(skill.path, skill.name, agents);
        if (result.success) {
          installed++;
        } else {
          console.log(chalk.red(`\n  Failed to install ${skill.name}: ${result.error}`));
        }
      }

      installSpinner.succeed(`Installed ${installed} skills to ${agents.length} agents`);
      console.log(chalk.green('\nSkills installed.'));
    } catch (err) {
      spinner.fail('Failed to add skills');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

skillsCmd
  .command('remove <name>')
  .description('Remove an Agent Skill')
  .action((name: string) => {
    const result = uninstallSkill(name);
    if (result.success) {
      console.log(chalk.green(`Removed skill '${name}'`));
    } else {
      console.log(chalk.red(result.error || 'Failed to remove skill'));
    }
  });

skillsCmd
  .command('push <name>')
  .description('Save project-scoped skill to user scope')
  .option('-a, --agents <list>', 'Comma-separated agents to push for')
  .action((name: string, options) => {
    const cwd = process.cwd();
    const agents = options.agents
      ? (options.agents.split(',') as AgentId[])
      : SKILLS_CAPABLE_AGENTS;

    let pushed = 0;
    for (const agentId of agents) {
      if (!AGENTS[agentId].capabilities.skills) continue;

      const result = promoteSkillToUser(agentId, name, cwd);
      if (result.success) {
        console.log(`  ${chalk.green('+')} ${AGENTS[agentId].name}`);
        pushed++;
      } else if (result.error && !result.error.includes('not found')) {
        console.log(`  ${chalk.red('x')} ${AGENTS[agentId].name}: ${result.error}`);
      }
    }

    if (pushed === 0) {
      console.log(chalk.yellow(`Project skill '${name}' not found for any agent`));
    } else {
      console.log(chalk.green(`\nPushed to user scope for ${pushed} agents.`));
    }
  });

skillsCmd
  .command('info <name>')
  .description('Show detailed info about an installed skill')
  .action((name: string) => {
    const skill = getSkillInfo(name);
    if (!skill) {
      console.log(chalk.yellow(`Skill '${name}' not found`));
      return;
    }

    console.log(chalk.bold(`\n${skill.metadata.name}\n`));
    if (skill.metadata.description) {
      console.log(`  ${skill.metadata.description}`);
    }
    console.log();
    if (skill.metadata.author) {
      console.log(`  Author: ${skill.metadata.author}`);
    }
    if (skill.metadata.version) {
      console.log(`  Version: ${skill.metadata.version}`);
    }
    if (skill.metadata.license) {
      console.log(`  License: ${skill.metadata.license}`);
    }
    console.log(`  Path: ${skill.path}`);

    const rules = getSkillRules(name);
    if (rules.length > 0) {
      console.log(chalk.bold(`\n  Rules (${rules.length}):\n`));
      for (const rule of rules) {
        console.log(`    ${chalk.cyan(rule)}`);
      }
    }
    console.log();
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
  .option('-a, --agent <agent>', 'Filter by agent')
  .option('-s, --scope <scope>', 'Filter by scope: user, project, or all', 'all')
  .action((options) => {
    console.log(chalk.bold('\nMCP Servers\n'));
    const cwd = process.cwd();

    const agents = options.agent
      ? [options.agent as AgentId]
      : MCP_CAPABLE_AGENTS;

    for (const agentId of agents) {
      const agent = AGENTS[agentId];
      if (!agent.capabilities.mcp) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('mcp not supported')}`);
        console.log();
        continue;
      }
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
  .option('-s, --scope <scope>', 'Scope to read manifest from', 'user')
  .option('--latest', 'Upgrade to latest version (ignore manifest)')
  .action(async (agent: string | undefined, options) => {
    const scopeName = options.scope as ScopeName;
    const scope = getScope(scopeName);
    const localPath = scope ? getRepoLocalPath(scope.source) : null;
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
// REPO COMMANDS
// =============================================================================

const repoCmd = program
  .command('repo')
  .description('Manage .agents repository scopes');

repoCmd
  .command('list')
  .description('List configured repository scopes')
  .action(() => {
    const scopes = getScopesByPriority();

    if (scopes.length === 0) {
      console.log(chalk.yellow('\nNo scopes configured.'));
      console.log(chalk.gray('  Run: agents repo add <source> --scope user'));
      console.log();
      return;
    }

    console.log(chalk.bold('\nConfigured Scopes\n'));
    console.log(chalk.gray('  Scopes are applied in priority order (higher overrides lower)\n'));

    for (const { name, config } of scopes) {
      const readonlyTag = config.readonly ? chalk.gray(' (readonly)') : '';
      console.log(`  ${chalk.bold(name)}${readonlyTag}`);
      console.log(`    Source:   ${config.source}`);
      console.log(`    Branch:   ${config.branch}`);
      console.log(`    Commit:   ${config.commit.substring(0, 8)}`);
      console.log(`    Priority: ${config.priority}`);
      console.log(`    Synced:   ${new Date(config.lastSync).toLocaleString()}`);
      console.log();
    }
  });

repoCmd
  .command('add <source>')
  .description('Add a repository scope')
  .option('-s, --scope <scope>', 'Scope name: system, user, project, or custom', 'user')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (source: string, options) => {
    const scopeName = options.scope as ScopeName;
    const existingScope = getScope(scopeName);

    if (existingScope && !options.yes) {
      const shouldOverwrite = await confirm({
        message: `Scope '${scopeName}' already exists (${existingScope.source}). Overwrite?`,
        default: false,
      });
      if (!shouldOverwrite) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    if (existingScope?.readonly && !options.yes) {
      console.log(chalk.red(`Scope '${scopeName}' is readonly. Cannot overwrite.`));
      return;
    }

    const parsed = parseSource(source);
    const spinner = ora(`Cloning repository for ${scopeName} scope...`).start();

    try {
      const { commit, isNew } = await cloneRepo(source);
      spinner.succeed(isNew ? 'Repository cloned' : 'Repository updated');

      const priority = getScopePriority(scopeName);
      setScope(scopeName, {
        source,
        branch: parsed.ref || 'main',
        commit,
        lastSync: new Date().toISOString(),
        priority,
        readonly: scopeName === 'system',
      });

      console.log(chalk.green(`\nAdded scope '${scopeName}' with priority ${priority}`));
      console.log(chalk.gray(`  Run: agents pull --scope ${scopeName} to sync commands`));
    } catch (err) {
      spinner.fail('Failed to add scope');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

repoCmd
  .command('remove <scope>')
  .description('Remove a repository scope')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (scopeName: string, options) => {
    const existingScope = getScope(scopeName);

    if (!existingScope) {
      console.log(chalk.yellow(`Scope '${scopeName}' not found.`));
      return;
    }

    if (existingScope.readonly) {
      console.log(chalk.red(`Scope '${scopeName}' is readonly. Cannot remove.`));
      return;
    }

    if (!options.yes) {
      const shouldRemove = await confirm({
        message: `Remove scope '${scopeName}' (${existingScope.source})?`,
        default: false,
      });
      if (!shouldRemove) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const removed = removeScope(scopeName);
    if (removed) {
      console.log(chalk.green(`Removed scope '${scopeName}'`));
    } else {
      console.log(chalk.yellow(`Failed to remove scope '${scopeName}'`));
    }
  });

repoCmd
  .command('sync [scope]')
  .description('Sync a specific scope or all scopes')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (scopeName: string | undefined, options) => {
    const scopes = scopeName ? [{ name: scopeName, config: getScope(scopeName) }].filter(s => s.config) : getScopesByPriority();

    if (scopes.length === 0) {
      console.log(chalk.yellow('No scopes to sync.'));
      return;
    }

    for (const { name, config } of scopes) {
      if (!config) continue;

      console.log(chalk.bold(`\nSyncing scope: ${name}`));
      const spinner = ora('Updating repository...').start();

      try {
        const { commit } = await cloneRepo(config.source);
        spinner.succeed('Repository updated');

        setScope(name as ScopeName, {
          ...config,
          commit,
          lastSync: new Date().toISOString(),
        });
      } catch (err) {
        spinner.fail(`Failed to sync ${name}`);
        console.error(chalk.gray((err as Error).message));
      }
    }

    console.log(chalk.green('\nSync complete.'));
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
