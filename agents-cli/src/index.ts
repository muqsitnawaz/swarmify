#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { checkbox, confirm, select } from '@inquirer/prompts';

// Get version from package.json
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

function isPromptCancelled(err: unknown): boolean {
  return err instanceof Error && (
    err.name === 'ExitPromptError' ||
    err.message.includes('force closed') ||
    err.message.includes('User force closed')
  );
}
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
  commandExists,
} from './lib/commands.js';
import {
  discoverHooksFromRepo,
  installHooks,
  listInstalledHooksWithScope,
  promoteHookToUser,
  removeHook,
  hookExists,
} from './lib/hooks.js';
import {
  discoverSkillsFromRepo,
  installSkill,
  uninstallSkill,
  listInstalledSkillsWithScope,
  promoteSkillToUser,
  getSkillInfo,
  getSkillRules,
  skillExists,
} from './lib/skills.js';
import type { AgentId, Manifest, RegistryType } from './lib/types.js';
import { DEFAULT_REGISTRIES } from './lib/types.js';
import {
  search as searchRegistries,
  getRegistries,
  getEnabledRegistries,
  setRegistry,
  removeRegistry,
  resolvePackage,
  getMcpServerInfo,
} from './lib/registry.js';

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
  .version(VERSION);

// Check for updates (non-blocking, shows hint if update available)
async function checkForUpdates(): Promise<void> {
  try {
    const response = await fetch('https://registry.npmjs.org/@swarmify/agents-cli/latest', {
      signal: AbortSignal.timeout(2000), // 2s timeout
    });
    if (!response.ok) return;

    const data = (await response.json()) as { version: string };
    const latestVersion = data.version;

    if (latestVersion !== VERSION && compareVersions(latestVersion, VERSION) > 0) {
      console.log(chalk.yellow(`\nUpdate available: ${VERSION} -> ${latestVersion}`));
      console.log(chalk.gray(`Run: agents upgrade\n`));
    }
  } catch {
    // Silently ignore - don't block CLI usage
  }
}

// Run update check after command completes (non-blocking)
program.hook('postAction', async () => {
  // Don't check on upgrade command itself
  const args = process.argv.slice(2);
  if (args[0] === 'upgrade' || args[0] === '--version' || args[0] === '-V' || args[0] === '--help' || args[0] === '-h') {
    return;
  }
  await checkForUpdates();
});

// =============================================================================
// STATUS COMMAND
// =============================================================================

program
  .command('status [agent]')
  .description('Show sync status, CLI versions, installed commands and MCP servers')
  .action((agentFilter?: string) => {
    const state = readState();
    const cliStates = getAllCliStates();
    const cwd = process.cwd();

    // Resolve agent filter to AgentId
    let filterAgentId: AgentId | undefined;
    if (agentFilter) {
      // Map common names to AgentId
      const agentMap: Record<string, AgentId> = {
        claude: 'claude',
        'claude-code': 'claude',
        codex: 'codex',
        gemini: 'gemini',
        cursor: 'cursor',
        opencode: 'opencode',
      };
      filterAgentId = agentMap[agentFilter.toLowerCase()];
      if (!filterAgentId) {
        console.log(chalk.red(`Unknown agent: ${agentFilter}`));
        console.log(chalk.gray(`Valid agents: claude, codex, gemini, cursor, opencode`));
        process.exit(1);
      }
    }

    const agentsToShow = filterAgentId ? [filterAgentId] : ALL_AGENT_IDS;
    const skillAgentsToShow = filterAgentId
      ? SKILLS_CAPABLE_AGENTS.filter((id) => id === filterAgentId)
      : SKILLS_CAPABLE_AGENTS;
    const mcpAgentsToShow = filterAgentId
      ? MCP_CAPABLE_AGENTS.filter((id) => id === filterAgentId)
      : MCP_CAPABLE_AGENTS;

    // Helper to format MCP with version
    const formatMcp = (m: { name: string; version?: string }, color: (s: string) => string) => {
      return m.version ? color(`${m.name}@${m.version}`) : color(m.name);
    };

    console.log(chalk.bold('Agent CLIs\n'));
    for (const agentId of agentsToShow) {
      const agent = AGENTS[agentId];
      const cli = cliStates[agentId];
      const status = cli?.installed
        ? chalk.green(cli.version || 'installed')
        : chalk.gray('not installed');
      console.log(`  ${agent.name.padEnd(14)} ${status}`);
    }

    console.log(chalk.bold('\nInstalled Commands\n'));
    for (const agentId of agentsToShow) {
      const agent = AGENTS[agentId];
      const commands = listInstalledCommandsWithScope(agentId, cwd);
      const userCommands = commands.filter((c) => c.scope === 'user');
      const projectCommands = commands.filter((c) => c.scope === 'project');

      if (commands.length === 0) {
        console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
      } else {
        console.log(`  ${chalk.bold(agent.name)}:`);
        if (userCommands.length > 0) {
          console.log(`    ${chalk.gray('User:')} ${userCommands.map((c) => chalk.cyan(c.name)).join(', ')}`);
        }
        if (projectCommands.length > 0) {
          console.log(`    ${chalk.gray('Project:')} ${projectCommands.map((c) => chalk.yellow(c.name)).join(', ')}`);
        }
      }
    }

    if (skillAgentsToShow.length > 0) {
      console.log(chalk.bold('\nInstalled Skills\n'));
      for (const agentId of skillAgentsToShow) {
        const agent = AGENTS[agentId];
        const skills = listInstalledSkillsWithScope(agentId, cwd);
        const userSkills = skills.filter((s) => s.scope === 'user');
        const projectSkills = skills.filter((s) => s.scope === 'project');

        if (skills.length === 0) {
          console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
        } else {
          console.log(`  ${chalk.bold(agent.name)}:`);
          if (userSkills.length > 0) {
            console.log(`    ${chalk.gray('User:')} ${userSkills.map((s) => chalk.cyan(s.name)).join(', ')}`);
          }
          if (projectSkills.length > 0) {
            console.log(`    ${chalk.gray('Project:')} ${projectSkills.map((s) => chalk.yellow(s.name)).join(', ')}`);
          }
        }
      }
    }

    if (mcpAgentsToShow.length > 0) {
      console.log(chalk.bold('\nInstalled MCP Servers\n'));
      for (const agentId of mcpAgentsToShow) {
        const agent = AGENTS[agentId];
        if (!isCliInstalled(agentId)) continue;

        const mcps = listInstalledMcpsWithScope(agentId, cwd);
        const userMcps = mcps.filter((m) => m.scope === 'user');
        const projectMcps = mcps.filter((m) => m.scope === 'project');

        if (mcps.length === 0) {
          console.log(`  ${chalk.bold(agent.name)}: ${chalk.gray('none')}`);
        } else {
          console.log(`  ${chalk.bold(agent.name)}:`);
          if (userMcps.length > 0) {
            console.log(`    ${chalk.gray('User:')} ${userMcps.map((m) => formatMcp(m, chalk.cyan)).join(', ')}`);
          }
          if (projectMcps.length > 0) {
            console.log(`    ${chalk.gray('Project:')} ${projectMcps.map((m) => formatMcp(m, chalk.yellow)).join(', ')}`);
          }
        }
      }
    }

    // Only show scopes when not filtering by agent
    if (!filterAgentId) {
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
        console.log(chalk.gray('  Run: agents repo add <source>'));
      }
    }

    console.log();
  });

// =============================================================================
// PULL COMMAND
// =============================================================================

// Agent name aliases for flexible input
const AGENT_NAME_ALIASES: Record<string, AgentId> = {
  claude: 'claude',
  'claude-code': 'claude',
  cc: 'claude',
  codex: 'codex',
  'openai-codex': 'codex',
  cx: 'codex',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  gx: 'gemini',
  cursor: 'cursor',
  'cursor-agent': 'cursor',
  cr: 'cursor',
  opencode: 'opencode',
  oc: 'opencode',
};

function resolveAgentName(input: string): AgentId | null {
  return AGENT_NAME_ALIASES[input.toLowerCase()] || null;
}

function isAgentName(input: string): boolean {
  return resolveAgentName(input) !== null;
}

// Resource item for tracking new vs existing
interface ResourceItem {
  type: 'command' | 'skill' | 'hook' | 'mcp';
  name: string;
  agents: AgentId[];
  isNew: boolean;
}

// Per-resource conflict decision
type ResourceDecision = 'overwrite' | 'skip';

program
  .command('pull [source] [agent]')
  .description('Pull and sync from remote .agents repo')
  .option('-y, --yes', 'Auto-confirm and skip all conflicts')
  .option('-f, --force', 'Auto-confirm and overwrite all conflicts')
  .option('-s, --scope <scope>', 'Target scope (default: user)', 'user')
  .option('--dry-run', 'Show what would change')
  .option('--skip-clis', 'Skip CLI version sync')
  .option('--skip-mcp', 'Skip MCP registration')
  .action(async (arg1: string | undefined, arg2: string | undefined, options) => {
    // Parse source and agent filter from positional args
    let targetSource: string | undefined;
    let agentFilter: AgentId | undefined;

    if (arg1) {
      if (isAgentName(arg1)) {
        // agents pull claude
        agentFilter = resolveAgentName(arg1)!;
      } else {
        // agents pull gh:user/repo [agent]
        targetSource = arg1;
        if (arg2 && isAgentName(arg2)) {
          agentFilter = resolveAgentName(arg2)!;
        }
      }
    }

    const scopeName = options.scope as ScopeName;
    const meta = readState();
    const existingScope = meta.scopes[scopeName];

    // Try: 1) provided source, 2) existing scope source, 3) fall back to system scope
    targetSource = targetSource || existingScope?.source;
    let effectiveScope = scopeName;

    if (!targetSource && scopeName === 'user') {
      const systemScope = meta.scopes['system'];
      if (systemScope?.source) {
        targetSource = systemScope.source;
        effectiveScope = 'system';
        console.log(chalk.gray(`No user scope configured, using system scope: ${targetSource}\n`));
      }
    }

    if (!targetSource) {
      if (scopeName === 'user' && Object.keys(meta.scopes).length === 0) {
        console.log(chalk.gray(`First run detected. Initializing from ${DEFAULT_SYSTEM_REPO}...\n`));
        targetSource = DEFAULT_SYSTEM_REPO;
        effectiveScope = 'system';
      } else {
        console.log(chalk.red(`No source specified for scope '${scopeName}'.`));
        const scopeHint = scopeName === 'user' ? '' : ` --scope ${scopeName}`;
        console.log(chalk.gray(`  Usage: agents pull <source>${scopeHint}`));
        console.log(chalk.gray('  Example: agents pull gh:username/.agents'));
        process.exit(1);
      }
    }

    const targetScopeConfig = meta.scopes[effectiveScope];
    const isReadonly = targetScopeConfig?.readonly || effectiveScope === 'system';
    const isUserScope = effectiveScope === 'user';

    const parsed = parseSource(targetSource);
    const spinner = ora(`Syncing from ${effectiveScope} scope...`).start();

    try {
      const { localPath, commit, isNew } = await cloneRepo(targetSource);
      spinner.succeed(isNew ? 'Repository cloned' : 'Repository updated');

      const manifest = readManifest(localPath);
      if (!manifest) {
        console.log(chalk.yellow(`No ${MANIFEST_FILENAME} found in repository`));
      }

      // Discover all assets
      const allCommands = discoverCommands(localPath);
      const allSkills = discoverSkillsFromRepo(localPath);
      const discoveredHooks = discoverHooksFromRepo(localPath);

      // Determine which agents to sync
      let selectedAgents: AgentId[];
      if (agentFilter) {
        // Single agent filter
        selectedAgents = [agentFilter];
        console.log(chalk.gray(`\nFiltering for ${AGENTS[agentFilter].name} only\n`));
      } else if (options.yes || options.force) {
        selectedAgents = (manifest?.defaults?.agents || ['claude', 'codex', 'gemini']) as AgentId[];
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
      }

      // Filter agents to only installed ones (plus cursor which doesn't need CLI)
      selectedAgents = selectedAgents.filter((id) => isCliInstalled(id) || id === 'cursor');

      if (selectedAgents.length === 0) {
        console.log(chalk.yellow('\nNo agents selected or installed. Nothing to sync.'));
        return;
      }

      // Build resource items with conflict detection
      const newItems: ResourceItem[] = [];
      const existingItems: ResourceItem[] = [];

      // Process commands
      for (const command of allCommands) {
        const applicableAgents = selectedAgents.filter((agentId) => {
          const sourcePath = resolveCommandSource(localPath, command.name, agentId);
          return sourcePath !== null;
        });
        if (applicableAgents.length === 0) continue;

        const conflictingAgents = applicableAgents.filter((agentId) => commandExists(agentId, command.name));
        const newAgents = applicableAgents.filter((agentId) => !commandExists(agentId, command.name));

        if (conflictingAgents.length > 0) {
          existingItems.push({ type: 'command', name: command.name, agents: conflictingAgents, isNew: false });
        }
        if (newAgents.length > 0) {
          newItems.push({ type: 'command', name: command.name, agents: newAgents, isNew: true });
        }
      }

      // Process skills
      const skillAgents = SKILLS_CAPABLE_AGENTS.filter((id) => selectedAgents.includes(id));
      for (const skill of allSkills) {
        const conflictingAgents = skillAgents.filter((agentId) => skillExists(agentId, skill.name));
        const newAgents = skillAgents.filter((agentId) => !skillExists(agentId, skill.name));

        if (conflictingAgents.length > 0) {
          existingItems.push({ type: 'skill', name: skill.name, agents: conflictingAgents, isNew: false });
        }
        if (newAgents.length > 0) {
          newItems.push({ type: 'skill', name: skill.name, agents: newAgents, isNew: true });
        }
      }

      // Process hooks
      const hookAgents = selectedAgents.filter(
        (id) => HOOKS_CAPABLE_AGENTS.includes(id as typeof HOOKS_CAPABLE_AGENTS[number]) && isCliInstalled(id)
      );
      const allHookNames = [
        ...discoveredHooks.shared,
        ...Object.entries(discoveredHooks.agentSpecific)
          .filter(([agentId]) => hookAgents.includes(agentId as AgentId))
          .flatMap(([_, hooks]) => hooks),
      ];
      const uniqueHookNames = [...new Set(allHookNames)];

      for (const hookName of uniqueHookNames) {
        const conflictingAgents = hookAgents.filter((agentId) => hookExists(agentId, hookName));
        const newAgents = hookAgents.filter((agentId) => !hookExists(agentId, hookName));

        if (conflictingAgents.length > 0) {
          existingItems.push({ type: 'hook', name: hookName, agents: conflictingAgents, isNew: false });
        }
        if (newAgents.length > 0) {
          newItems.push({ type: 'hook', name: hookName, agents: newAgents, isNew: true });
        }
      }

      // Process MCPs
      if (!options.skipMcp && manifest?.mcp) {
        for (const [name, config] of Object.entries(manifest.mcp)) {
          if (config.transport === 'http' || !config.command) continue;
          const mcpAgents = config.agents.filter((agentId) => selectedAgents.includes(agentId) && isCliInstalled(agentId));
          if (mcpAgents.length === 0) continue;

          const conflictingAgents = mcpAgents.filter((agentId) => isMcpRegistered(agentId, name));
          const newAgents = mcpAgents.filter((agentId) => !isMcpRegistered(agentId, name));

          if (conflictingAgents.length > 0) {
            existingItems.push({ type: 'mcp', name, agents: conflictingAgents, isNew: false });
          }
          if (newAgents.length > 0) {
            newItems.push({ type: 'mcp', name, agents: newAgents, isNew: true });
          }
        }
      }

      // Display overview
      console.log(chalk.bold('\nOverview\n'));

      const formatAgentList = (agents: AgentId[]) =>
        agents.map((id) => AGENTS[id].name).join(', ');

      if (newItems.length > 0) {
        console.log(chalk.green('  NEW (will install):\n'));
        const byType = { command: [] as ResourceItem[], skill: [] as ResourceItem[], hook: [] as ResourceItem[], mcp: [] as ResourceItem[] };
        for (const item of newItems) byType[item.type].push(item);

        if (byType.command.length > 0) {
          console.log(`    Commands:`);
          for (const item of byType.command) {
            console.log(`      ${chalk.cyan(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.skill.length > 0) {
          console.log(`    Skills:`);
          for (const item of byType.skill) {
            console.log(`      ${chalk.cyan(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.hook.length > 0) {
          console.log(`    Hooks:`);
          for (const item of byType.hook) {
            console.log(`      ${chalk.cyan(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.mcp.length > 0) {
          console.log(`    MCP Servers:`);
          for (const item of byType.mcp) {
            console.log(`      ${chalk.cyan(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        console.log();
      }

      if (existingItems.length > 0) {
        console.log(chalk.yellow('  EXISTING (conflicts):\n'));
        const byType = { command: [] as ResourceItem[], skill: [] as ResourceItem[], hook: [] as ResourceItem[], mcp: [] as ResourceItem[] };
        for (const item of existingItems) byType[item.type].push(item);

        if (byType.command.length > 0) {
          console.log(`    Commands:`);
          for (const item of byType.command) {
            console.log(`      ${chalk.yellow(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.skill.length > 0) {
          console.log(`    Skills:`);
          for (const item of byType.skill) {
            console.log(`      ${chalk.yellow(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.hook.length > 0) {
          console.log(`    Hooks:`);
          for (const item of byType.hook) {
            console.log(`      ${chalk.yellow(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        if (byType.mcp.length > 0) {
          console.log(`    MCP Servers:`);
          for (const item of byType.mcp) {
            console.log(`      ${chalk.yellow(item.name.padEnd(20))} ${chalk.gray(formatAgentList(item.agents))}`);
          }
        }
        console.log();
      }

      if (newItems.length === 0 && existingItems.length === 0) {
        console.log(chalk.gray('  Nothing to sync.\n'));
        return;
      }

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - no changes made'));
        return;
      }

      // Confirmation prompt
      if (!options.yes && !options.force) {
        const proceed = await confirm({
          message: 'Proceed with installation?',
          default: true,
        });
        if (!proceed) {
          console.log(chalk.yellow('\nSync cancelled'));
          return;
        }
      }

      // Determine installation method
      let method: 'symlink' | 'copy';
      if (options.yes || options.force) {
        method = manifest?.defaults?.method || 'symlink';
      } else {
        method = await select({
          message: 'Installation method:',
          choices: [
            { name: 'Symlink (updates automatically)', value: 'symlink' as const },
            { name: 'Copy (independent files)', value: 'copy' as const },
          ],
          default: manifest?.defaults?.method || 'symlink',
        });
      }

      // Per-resource conflict decisions
      const decisions = new Map<string, ResourceDecision>();

      if (existingItems.length > 0 && !options.force && !options.yes) {
        console.log(chalk.bold('\nResolve conflicts:\n'));

        for (const item of existingItems) {
          const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
          const agentList = formatAgentList(item.agents);

          const decision = await select({
            message: `${typeLabel} '${item.name}' exists (${agentList})`,
            choices: [
              { name: 'Overwrite', value: 'overwrite' as const },
              { name: 'Skip', value: 'skip' as const },
              { name: 'Cancel all', value: 'cancel' as const },
            ],
          });

          if (decision === 'cancel') {
            console.log(chalk.yellow('\nSync cancelled'));
            return;
          }

          decisions.set(`${item.type}:${item.name}`, decision);
        }
      } else if (options.force) {
        // Force mode: overwrite all
        for (const item of existingItems) {
          decisions.set(`${item.type}:${item.name}`, 'overwrite');
        }
      } else if (options.yes) {
        // Yes mode: skip all conflicts
        for (const item of existingItems) {
          decisions.set(`${item.type}:${item.name}`, 'skip');
        }
      }

      // Install new items (no conflicts)
      console.log();
      let installed = { commands: 0, skills: 0, hooks: 0, mcps: 0 };
      let skipped = { commands: 0, skills: 0, hooks: 0, mcps: 0 };

      // Install commands
      const cmdSpinner = ora('Installing commands...').start();
      for (const item of [...newItems, ...existingItems].filter((i) => i.type === 'command')) {
        const decision = item.isNew ? 'overwrite' : decisions.get(`command:${item.name}`);
        if (decision === 'skip') {
          skipped.commands++;
          continue;
        }

        for (const agentId of item.agents) {
          const sourcePath = resolveCommandSource(localPath, item.name, agentId);
          if (sourcePath) {
            installCommand(sourcePath, agentId, item.name, method);
            installed.commands++;
          }
        }
      }
      if (skipped.commands > 0) {
        cmdSpinner.succeed(`Installed ${installed.commands} commands (skipped ${skipped.commands})`);
      } else if (installed.commands > 0) {
        cmdSpinner.succeed(`Installed ${installed.commands} commands`);
      } else {
        cmdSpinner.info('No commands to install');
      }

      // Install skills
      const skillItems = [...newItems, ...existingItems].filter((i) => i.type === 'skill');
      if (skillItems.length > 0) {
        const skillSpinner = ora('Installing skills...').start();
        for (const item of skillItems) {
          const decision = item.isNew ? 'overwrite' : decisions.get(`skill:${item.name}`);
          if (decision === 'skip') {
            skipped.skills++;
            continue;
          }

          const skill = allSkills.find((s) => s.name === item.name);
          if (skill) {
            const result = installSkill(skill.path, skill.name, item.agents);
            if (result.success) installed.skills++;
          }
        }
        if (skipped.skills > 0) {
          skillSpinner.succeed(`Installed ${installed.skills} skills (skipped ${skipped.skills})`);
        } else if (installed.skills > 0) {
          skillSpinner.succeed(`Installed ${installed.skills} skills`);
        } else {
          skillSpinner.info('No skills to install');
        }
      }

      // Install hooks
      const hookItems = [...newItems, ...existingItems].filter((i) => i.type === 'hook');
      if (hookItems.length > 0 && hookAgents.length > 0) {
        const hookSpinner = ora('Installing hooks...').start();
        const result = await installHooks(localPath, hookAgents, { scope: 'user' });
        hookSpinner.succeed(`Installed ${result.installed.length} hooks`);
      }

      // Register MCP servers
      const mcpItems = [...newItems, ...existingItems].filter((i) => i.type === 'mcp');
      if (mcpItems.length > 0 && manifest?.mcp) {
        const mcpSpinner = ora('Registering MCP servers...').start();
        for (const item of mcpItems) {
          const decision = item.isNew ? 'overwrite' : decisions.get(`mcp:${item.name}`);
          if (decision === 'skip') {
            skipped.mcps++;
            continue;
          }

          const config = manifest.mcp[item.name];
          if (!config || !config.command) continue;

          for (const agentId of item.agents) {
            if (!item.isNew) {
              unregisterMcp(agentId, item.name);
            }
            const result = registerMcp(agentId, item.name, config.command, config.scope);
            if (result.success) installed.mcps++;
          }
        }
        if (skipped.mcps > 0) {
          mcpSpinner.succeed(`Registered ${installed.mcps} MCP servers (skipped ${skipped.mcps})`);
        } else if (installed.mcps > 0) {
          mcpSpinner.succeed(`Registered ${installed.mcps} MCP servers`);
        } else {
          mcpSpinner.info('No MCP servers to register');
        }
      }

      // Sync CLI versions (user scope only)
      if (isUserScope && !options.skipClis && manifest?.clis) {
        const cliSpinner = ora('Checking CLI versions...').start();
        const cliUpdates: string[] = [];

        for (const [agentIdStr, cliConfig] of Object.entries(manifest.clis)) {
          const agentId = agentIdStr as AgentId;
          if (agentFilter && agentId !== agentFilter) continue;

          const agent = AGENTS[agentId];
          if (!agent || !cliConfig.package) continue;

          const currentVersion = getCliVersion(agentId);
          const targetVersion = cliConfig.version;

          if (currentVersion === targetVersion) continue;
          if (targetVersion === 'latest' && currentVersion) continue;

          cliUpdates.push(`${agent.name}: ${currentVersion || 'not installed'} -> ${targetVersion}`);
        }

        if (cliUpdates.length > 0) {
          cliSpinner.info('CLI version differences detected');
          console.log(chalk.gray('  Run `agents cli upgrade` to update CLIs'));
          for (const update of cliUpdates) {
            console.log(chalk.gray(`    ${update}`));
          }
        } else {
          cliSpinner.succeed('CLI versions match');
        }
      }

      // Update scope config
      if (!isReadonly) {
        const priority = getScopePriority(effectiveScope);
        setScope(effectiveScope, {
          source: targetSource,
          branch: parsed.ref || 'main',
          commit,
          lastSync: new Date().toISOString(),
          priority,
          readonly: false,
        });
      }

      console.log(chalk.green(`\nSync complete from ${effectiveScope} scope`));
    } catch (err) {
      if (isPromptCancelled(err)) {
        console.log(chalk.yellow('\nCancelled'));
        process.exit(0);
      }
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
  .option('-s, --scope <scope>', 'Target scope (default: user)', 'user')
  .option('--export-only', 'Only export, do not update manifest')
  .action(async (options) => {
    const scopeName = options.scope as ScopeName;
    const scope = getScope(scopeName);

    if (!scope) {
      console.log(chalk.red(`Scope '${scopeName}' not configured.`));
      const scopeHint = scopeName === 'user' ? '' : ` --scope ${scopeName}`;
      console.log(chalk.gray(`  Run: agents repo add <source>${scopeHint}`));
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
    console.log(chalk.bold('Installed Commands\n'));
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
    console.log(chalk.bold('Installed Hooks\n'));
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
    console.log(chalk.bold('Installed Agent Skills\n'));
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
  .command('view [name]')
  .alias('info')
  .description('View detailed info about an installed skill')
  .action(async (name?: string) => {
    // If no name provided, show interactive select
    if (!name) {
      const cwd = process.cwd();
      const allSkills: Array<{ name: string; description: string }> = [];
      const seenNames = new Set<string>();

      for (const agentId of SKILLS_CAPABLE_AGENTS) {
        const skills = listInstalledSkillsWithScope(agentId, cwd);
        for (const skill of skills) {
          if (!seenNames.has(skill.name)) {
            seenNames.add(skill.name);
            allSkills.push({
              name: skill.name,
              description: skill.metadata.description || '',
            });
          }
        }
      }

      if (allSkills.length === 0) {
        console.log(chalk.yellow('No skills installed'));
        return;
      }

      try {
        name = await select({
          message: 'Select a skill to view',
          choices: allSkills.map((s) => ({
            value: s.name,
            name: s.description ? `${s.name} - ${s.description}` : s.name,
          })),
        });
      } catch (err) {
        if (isPromptCancelled(err)) {
          console.log(chalk.gray('Cancelled'));
          return;
        }
        throw err;
      }
    }

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
    console.log(chalk.bold('MCP Servers\n'));
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
  .command('add <name> [command_or_url...]')
  .description('Add MCP server (stdio: use -- before command, http: use URL)')
  .option('-a, --agents <list>', 'Comma-separated agents', MCP_CAPABLE_AGENTS.join(','))
  .option('-s, --scope <scope>', 'Scope: user or project', 'user')
  .option('-t, --transport <type>', 'Transport: stdio or http', 'stdio')
  .option('-H, --header <header>', 'HTTP header (name:value), can be repeated', (val, acc: string[]) => {
    acc.push(val);
    return acc;
  }, [])
  .action(async (name: string, commandOrUrl: string[], options) => {
    const transport = options.transport as 'stdio' | 'http';

    if (commandOrUrl.length === 0) {
      console.error(chalk.red('Error: Command or URL required'));
      console.log(chalk.gray('Stdio: agents mcp add <name> -- <command...>'));
      console.log(chalk.gray('HTTP:  agents mcp add <name> <url> --transport http'));
      process.exit(1);
    }

    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath) || createDefaultManifest();

    manifest.mcp = manifest.mcp || {};

    if (transport === 'http') {
      const url = commandOrUrl[0];
      const headers: Record<string, string> = {};

      if (options.header && options.header.length > 0) {
        for (const h of options.header) {
          const [key, ...valueParts] = h.split(':');
          if (key && valueParts.length > 0) {
            headers[key.trim()] = valueParts.join(':').trim();
          }
        }
      }

      manifest.mcp[name] = {
        url,
        transport: 'http',
        scope: options.scope as 'user' | 'project',
        agents: options.agents.split(',') as AgentId[],
        ...(Object.keys(headers).length > 0 && { headers }),
      };
    } else {
      const command = commandOrUrl.join(' ');
      manifest.mcp[name] = {
        command,
        transport: 'stdio',
        scope: options.scope as 'user' | 'project',
        agents: options.agents.split(',') as AgentId[],
      };
    }

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
        // Skip HTTP transport MCPs for now (need different registration)
        if (config.transport === 'http' || !config.command) {
          console.log(`\n  ${chalk.cyan(mcpName)}: ${chalk.yellow('HTTP transport not yet supported')}`);
          continue;
        }

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
    console.log(chalk.bold('Agent CLIs\n'));

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
  .description('Install agent CLI and add to manifest')
  .option('-v, --version <version>', 'Version to install', 'latest')
  .option('--manifest-only', 'Only add to manifest, do not install')
  .action(async (agent: string, options) => {
    const agentId = agent.toLowerCase() as AgentId;
    if (!AGENTS[agentId]) {
      console.log(chalk.red(`Unknown agent: ${agent}`));
      console.log(chalk.gray(`Available: ${ALL_AGENT_IDS.join(', ')}`));
      return;
    }

    const agentConfig = AGENTS[agentId];
    const pkg = agentConfig.npmPackage;
    const version = options.version;

    // Install the CLI
    if (!options.manifestOnly) {
      if (!pkg) {
        console.log(chalk.yellow(`${agentConfig.name} has no npm package. Install manually.`));
      } else {
        const { execSync } = await import('child_process');
        const spinner = ora(`Installing ${agentConfig.name}@${version}...`).start();

        try {
          execSync(`npm install -g ${pkg}@${version}`, { stdio: 'pipe' });
          spinner.succeed(`Installed ${agentConfig.name}@${version}`);
        } catch (err) {
          spinner.fail(`Failed to install ${agentConfig.name}`);
          console.error(chalk.gray((err as Error).message));
          return;
        }
      }
    }

    // Add to manifest
    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath) || createDefaultManifest();

    manifest.clis = manifest.clis || {};
    manifest.clis[agentId] = {
      package: pkg,
      version: version,
    };

    writeManifest(localPath, manifest);
    console.log(chalk.green(`Added ${agentConfig.name} to manifest`));
  });

cliCmd
  .command('remove <agent>')
  .description('Uninstall agent CLI and remove from manifest')
  .option('--manifest-only', 'Only remove from manifest, do not uninstall')
  .action(async (agent: string, options) => {
    const agentId = agent.toLowerCase() as AgentId;
    if (!AGENTS[agentId]) {
      console.log(chalk.red(`Unknown agent: ${agent}`));
      console.log(chalk.gray(`Available: ${ALL_AGENT_IDS.join(', ')}`));
      return;
    }

    const agentConfig = AGENTS[agentId];
    const pkg = agentConfig.npmPackage;

    // Uninstall the CLI
    if (!options.manifestOnly) {
      if (!pkg) {
        console.log(chalk.yellow(`${agentConfig.name} has no npm package.`));
      } else if (!isCliInstalled(agentId)) {
        console.log(chalk.gray(`${agentConfig.name} is not installed`));
      } else {
        const { execSync } = await import('child_process');
        const spinner = ora(`Uninstalling ${agentConfig.name}...`).start();

        try {
          execSync(`npm uninstall -g ${pkg}`, { stdio: 'pipe' });
          spinner.succeed(`Uninstalled ${agentConfig.name}`);
        } catch (err) {
          spinner.fail(`Failed to uninstall ${agentConfig.name}`);
          console.error(chalk.gray((err as Error).message));
        }
      }
    }

    // Remove from manifest
    const source = await ensureSource();
    const localPath = getRepoLocalPath(source);
    const manifest = readManifest(localPath);

    if (manifest?.clis?.[agentId]) {
      delete manifest.clis[agentId];
      writeManifest(localPath, manifest);
      console.log(chalk.green(`Removed ${agentConfig.name} from manifest`));
    }
  });

cliCmd
  .command('upgrade [agent]')
  .description('Upgrade agent CLI(s) to version in manifest')
  .option('-s, --scope <scope>', 'Target scope (default: user)', 'user')
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
      console.log(chalk.yellow('No scopes configured.'));
      console.log(chalk.gray('  Run: agents repo add <source>'));
      console.log();
      return;
    }

    console.log(chalk.bold('Configured Scopes\n'));
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
  .option('-s, --scope <scope>', 'Target scope (default: user)', 'user')
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
      const scopeHint = scopeName === 'user' ? '' : ` --scope ${scopeName}`;
      console.log(chalk.gray(`  Run: agents pull${scopeHint} to sync commands`));
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

// =============================================================================
// REGISTRY COMMANDS
// =============================================================================

const registryCmd = program
  .command('registry')
  .description('Manage package registries (MCP servers, skills)');

registryCmd
  .command('list')
  .description('List configured registries')
  .option('-t, --type <type>', 'Filter by type: mcp or skill')
  .action((options) => {
    const types: RegistryType[] = options.type ? [options.type] : ['mcp', 'skill'];

    console.log(chalk.bold('Configured Registries\n'));

    for (const type of types) {
      console.log(chalk.bold(`  ${type.toUpperCase()}`));

      const registries = getRegistries(type);
      const entries = Object.entries(registries);

      if (entries.length === 0) {
        console.log(chalk.gray('    No registries configured'));
      } else {
        for (const [name, config] of entries) {
          const status = config.enabled ? chalk.green('enabled') : chalk.gray('disabled');
          const isDefault = DEFAULT_REGISTRIES[type]?.[name] ? chalk.gray(' (default)') : '';
          console.log(`    ${name}${isDefault}: ${status}`);
          console.log(chalk.gray(`      ${config.url}`));
        }
      }
      console.log();
    }
  });

registryCmd
  .command('add <type> <name> <url>')
  .description('Add a registry (type: mcp or skill)')
  .option('--api-key <key>', 'API key for authentication')
  .action((type: string, name: string, url: string, options) => {
    if (type !== 'mcp' && type !== 'skill') {
      console.log(chalk.red(`Invalid type '${type}'. Use 'mcp' or 'skill'.`));
      process.exit(1);
    }

    setRegistry(type as RegistryType, name, {
      url,
      enabled: true,
      apiKey: options.apiKey,
    });

    console.log(chalk.green(`Added ${type} registry '${name}'`));
  });

registryCmd
  .command('remove <type> <name>')
  .description('Remove a registry')
  .action((type: string, name: string) => {
    if (type !== 'mcp' && type !== 'skill') {
      console.log(chalk.red(`Invalid type '${type}'. Use 'mcp' or 'skill'.`));
      process.exit(1);
    }

    // Check if it's a default registry
    if (DEFAULT_REGISTRIES[type as RegistryType]?.[name]) {
      console.log(chalk.yellow(`Cannot remove default registry '${name}'. Use 'agents registry disable' instead.`));
      process.exit(1);
    }

    if (removeRegistry(type as RegistryType, name)) {
      console.log(chalk.green(`Removed ${type} registry '${name}'`));
    } else {
      console.log(chalk.yellow(`Registry '${name}' not found`));
    }
  });

registryCmd
  .command('enable <type> <name>')
  .description('Enable a registry')
  .action((type: string, name: string) => {
    if (type !== 'mcp' && type !== 'skill') {
      console.log(chalk.red(`Invalid type '${type}'. Use 'mcp' or 'skill'.`));
      process.exit(1);
    }

    const registries = getRegistries(type as RegistryType);
    if (!registries[name]) {
      console.log(chalk.yellow(`Registry '${name}' not found`));
      process.exit(1);
    }

    setRegistry(type as RegistryType, name, { enabled: true });
    console.log(chalk.green(`Enabled ${type} registry '${name}'`));
  });

registryCmd
  .command('disable <type> <name>')
  .description('Disable a registry')
  .action((type: string, name: string) => {
    if (type !== 'mcp' && type !== 'skill') {
      console.log(chalk.red(`Invalid type '${type}'. Use 'mcp' or 'skill'.`));
      process.exit(1);
    }

    const registries = getRegistries(type as RegistryType);
    if (!registries[name]) {
      console.log(chalk.yellow(`Registry '${name}' not found`));
      process.exit(1);
    }

    setRegistry(type as RegistryType, name, { enabled: false });
    console.log(chalk.green(`Disabled ${type} registry '${name}'`));
  });

registryCmd
  .command('config <type> <name>')
  .description('Configure a registry')
  .option('--api-key <key>', 'Set API key')
  .option('--url <url>', 'Update URL')
  .action((type: string, name: string, options) => {
    if (type !== 'mcp' && type !== 'skill') {
      console.log(chalk.red(`Invalid type '${type}'. Use 'mcp' or 'skill'.`));
      process.exit(1);
    }

    const registries = getRegistries(type as RegistryType);
    if (!registries[name]) {
      console.log(chalk.yellow(`Registry '${name}' not found`));
      process.exit(1);
    }

    const updates: Record<string, unknown> = {};
    if (options.apiKey) updates.apiKey = options.apiKey;
    if (options.url) updates.url = options.url;

    if (Object.keys(updates).length === 0) {
      console.log(chalk.yellow('No options provided. Use --api-key or --url.'));
      process.exit(1);
    }

    setRegistry(type as RegistryType, name, updates);
    console.log(chalk.green(`Updated ${type} registry '${name}'`));
  });

// =============================================================================
// SEARCH COMMAND
// =============================================================================

program
  .command('search <query>')
  .description('Search registries for packages (MCP servers, skills)')
  .option('-t, --type <type>', 'Filter by type: mcp or skill')
  .option('-r, --registry <name>', 'Search specific registry')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (query: string, options) => {
    const spinner = ora('Searching registries...').start();

    try {
      const results = await searchRegistries(query, {
        type: options.type as RegistryType | undefined,
        registry: options.registry,
        limit: parseInt(options.limit, 10),
      });

      spinner.stop();

      if (results.length === 0) {
        console.log(chalk.yellow('\nNo packages found.'));

        if (!options.type) {
          console.log(chalk.gray('\nTip: skill registries not yet available. Use gh:user/repo for skills.'));
        }
        return;
      }

      console.log(chalk.bold(`Found ${results.length} packages`));

      // Group by type
      const mcpResults = results.filter((r) => r.type === 'mcp');
      const skillResults = results.filter((r) => r.type === 'skill');

      if (mcpResults.length > 0) {
        console.log(chalk.bold('\n  MCP Servers'));
        for (const result of mcpResults) {
          const desc = result.description
            ? chalk.gray(` - ${result.description.slice(0, 50)}${result.description.length > 50 ? '...' : ''}`)
            : '';
          console.log(`    ${chalk.cyan(result.name)}${desc}`);
          console.log(chalk.gray(`      Registry: ${result.registry}  Install: agents add mcp:${result.name}`));
        }
      }

      if (skillResults.length > 0) {
        console.log(chalk.bold('\n  Skills'));
        for (const result of skillResults) {
          const desc = result.description
            ? chalk.gray(` - ${result.description.slice(0, 50)}${result.description.length > 50 ? '...' : ''}`)
            : '';
          console.log(`    ${chalk.cyan(result.name)}${desc}`);
          console.log(chalk.gray(`      Registry: ${result.registry}  Install: agents add skill:${result.name}`));
        }
      }
    } catch (err) {
      spinner.fail('Search failed');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

// =============================================================================
// ADD COMMAND (unified package installation)
// =============================================================================

program
  .command('add <identifier>')
  .description('Add a package (mcp:name, skill:user/repo, or gh:user/repo)')
  .option('-a, --agents <list>', 'Comma-separated agents to install to')
  .action(async (identifier: string, options) => {
    const spinner = ora('Resolving package...').start();

    try {
      const resolved = await resolvePackage(identifier);

      if (!resolved) {
        spinner.fail('Package not found');
        console.log(chalk.gray('\nTip: Use explicit prefix (mcp:, skill:, gh:) or check the identifier.'));
        process.exit(1);
      }

      spinner.succeed(`Found ${resolved.type} package`);

      if (resolved.type === 'mcp') {
        // Install MCP server
        const entry = resolved.mcpEntry;
        if (!entry) {
          console.log(chalk.red('Failed to get MCP server details'));
          process.exit(1);
        }

        console.log(chalk.bold(`\n${entry.name}`));
        if (entry.description) {
          console.log(chalk.gray(`  ${entry.description}`));
        }
        if (entry.repository?.url) {
          console.log(chalk.gray(`  ${entry.repository.url}`));
        }

        // Get package info
        const pkg = entry.packages?.[0];
        if (!pkg) {
          console.log(chalk.yellow('\nNo installable package found for this server.'));
          console.log(chalk.gray('You may need to install it manually.'));
          process.exit(1);
        }

        console.log(chalk.bold('\nPackage:'));
        console.log(`  Name: ${pkg.name || pkg.registry_name}`);
        console.log(`  Runtime: ${pkg.runtime || 'unknown'}`);
        console.log(`  Transport: ${pkg.transport || 'stdio'}`);

        if (pkg.packageArguments && pkg.packageArguments.length > 0) {
          console.log(chalk.bold('\nRequired arguments:'));
          for (const arg of pkg.packageArguments) {
            const req = arg.required ? chalk.red('*') : '';
            console.log(`  ${arg.name}${req}: ${arg.description || ''}`);
          }
        }

        // Determine command based on runtime
        let command: string;
        if (pkg.runtime === 'node') {
          command = `npx -y ${pkg.name || pkg.registry_name}`;
        } else if (pkg.runtime === 'python') {
          command = `uvx ${pkg.name || pkg.registry_name}`;
        } else {
          command = pkg.name || pkg.registry_name;
        }

        const agents = options.agents
          ? (options.agents.split(',') as AgentId[])
          : MCP_CAPABLE_AGENTS.filter((id) => isCliInstalled(id));

        if (agents.length === 0) {
          console.log(chalk.yellow('\nNo MCP-capable agents installed.'));
          process.exit(1);
        }

        console.log(chalk.bold('\nInstalling to agents...'));
        for (const agentId of agents) {
          if (!isCliInstalled(agentId)) continue;

          const result = registerMcp(agentId, entry.name, command, 'user');
          if (result.success) {
            console.log(`  ${chalk.green('+')} ${AGENTS[agentId].name}`);
          } else {
            console.log(`  ${chalk.red('x')} ${AGENTS[agentId].name}: ${result.error}`);
          }
        }

        console.log(chalk.green('\nMCP server installed.'));
      } else if (resolved.type === 'git' || resolved.type === 'skill') {
        // Install from git source (skills/commands/hooks)
        console.log(chalk.bold(`\nInstalling from ${resolved.source}`));

        const { localPath } = await cloneRepo(resolved.source);

        // Discover what's in the repo
        const commands = discoverCommands(localPath);
        const skills = discoverSkillsFromRepo(localPath);
        const hooks = discoverHooksFromRepo(localPath);

        const hasCommands = commands.length > 0;
        const hasSkills = skills.length > 0;
        const hasHooks = hooks.shared.length > 0 || Object.values(hooks.agentSpecific).some((h) => h.length > 0);

        if (!hasCommands && !hasSkills && !hasHooks) {
          console.log(chalk.yellow('No installable content found in repository.'));
          process.exit(1);
        }

        console.log(chalk.bold('\nFound:'));
        if (hasCommands) console.log(`  ${commands.length} commands`);
        if (hasSkills) console.log(`  ${skills.length} skills`);
        if (hasHooks) console.log(`  ${hooks.shared.length + Object.values(hooks.agentSpecific).flat().length} hooks`);

        const agents = options.agents
          ? (options.agents.split(',') as AgentId[])
          : (['claude', 'codex', 'gemini'] as AgentId[]);

        // Install commands
        if (hasCommands) {
          console.log(chalk.bold('\nInstalling commands...'));
          let installed = 0;
          for (const command of commands) {
            for (const agentId of agents) {
              if (!isCliInstalled(agentId) && agentId !== 'cursor') continue;

              const sourcePath = resolveCommandSource(localPath, command.name, agentId);
              if (sourcePath) {
                installCommand(sourcePath, agentId, command.name, 'symlink');
                installed++;
              }
            }
          }
          console.log(`  Installed ${installed} command instances`);
        }

        // Install skills
        if (hasSkills) {
          console.log(chalk.bold('\nInstalling skills...'));
          for (const skill of skills) {
            const result = installSkill(skill.path, skill.name, agents);
            if (result.success) {
              console.log(`  ${chalk.green('+')} ${skill.name}`);
            } else {
              console.log(`  ${chalk.red('x')} ${skill.name}: ${result.error}`);
            }
          }
        }

        // Install hooks
        if (hasHooks) {
          console.log(chalk.bold('\nInstalling hooks...'));
          const hookAgents = agents.filter((id) => AGENTS[id].supportsHooks) as AgentId[];
          const result = await installHooks(localPath, hookAgents, { scope: 'user' });
          console.log(`  Installed ${result.installed.length} hooks`);
        }

        console.log(chalk.green('\nPackage installed.'));
      }
    } catch (err) {
      spinner.fail('Installation failed');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

// Self-upgrade command
program
  .command('upgrade')
  .description('Upgrade agents-cli to the latest version')
  .action(async () => {
    const spinner = ora('Checking for updates...').start();

    try {
      // Get current version from package.json
      const currentVersion = program.version() || '0.0.0';

      // Fetch latest version from npm
      const response = await fetch('https://registry.npmjs.org/@swarmify/agents-cli/latest');
      if (!response.ok) {
        throw new Error('Failed to fetch latest version');
      }
      const data = (await response.json()) as { version: string };
      const latestVersion = data.version;

      if (currentVersion === latestVersion) {
        spinner.succeed(`Already on latest version (${currentVersion})`);
        return;
      }

      spinner.text = `Upgrading to ${latestVersion}...`;

      // Detect package manager
      const { execSync } = await import('child_process');
      let cmd: string;

      // Check if installed globally via npm, bun, or other
      try {
        const npmList = execSync('npm list -g @swarmify/agents-cli 2>/dev/null', { encoding: 'utf-8' });
        if (npmList.includes('@swarmify/agents-cli')) {
          cmd = 'npm install -g @swarmify/agents-cli@latest';
        } else {
          throw new Error('not npm');
        }
      } catch {
        try {
          const bunList = execSync('bun pm ls -g 2>/dev/null', { encoding: 'utf-8' });
          if (bunList.includes('@swarmify/agents-cli')) {
            cmd = 'bun install -g @swarmify/agents-cli@latest';
          } else {
            throw new Error('not bun');
          }
        } catch {
          // Default to npm
          cmd = 'npm install -g @swarmify/agents-cli@latest';
        }
      }

      // Run silently (suppress npm/bun output)
      execSync(cmd, { stdio: 'pipe' });
      spinner.succeed(`Upgraded to ${latestVersion}`);

      // Show what's new from changelog
      await showWhatsNew(currentVersion, latestVersion);
    } catch (err) {
      spinner.fail('Upgrade failed');
      console.error(chalk.red((err as Error).message));
      console.log(chalk.gray('\nManual upgrade: npm install -g @swarmify/agents-cli@latest'));
      process.exit(1);
    }
  });

async function showWhatsNew(fromVersion: string, toVersion: string): Promise<void> {
  try {
    // Fetch changelog from npm package
    const response = await fetch(`https://unpkg.com/@swarmify/agents-cli@${toVersion}/CHANGELOG.md`);
    if (!response.ok) return;

    const changelog = await response.text();
    const lines = changelog.split('\n');

    // Parse changelog to find relevant sections
    const relevantChanges: string[] = [];
    let inRelevantSection = false;
    let currentVersion = '';

    for (const line of lines) {
      // Check for version header (## 1.5.0)
      const versionMatch = line.match(/^## (\d+\.\d+\.\d+)/);
      if (versionMatch) {
        currentVersion = versionMatch[1];
        // Include versions newer than fromVersion
        const isNewer = currentVersion !== fromVersion &&
          compareVersions(currentVersion, fromVersion) > 0;
        inRelevantSection = isNewer;
        if (inRelevantSection) {
          relevantChanges.push('');
          relevantChanges.push(chalk.bold(`v${currentVersion}`));
        }
        continue;
      }

      if (inRelevantSection && line.trim()) {
        // Format the line
        if (line.startsWith('**') && line.endsWith('**')) {
          // Section header like **Pull command redesign**
          relevantChanges.push(chalk.cyan(line.replace(/\*\*/g, '')));
        } else if (line.startsWith('- ')) {
          // Bullet point
          relevantChanges.push(chalk.gray(`  ${line}`));
        }
      }
    }

    if (relevantChanges.length > 0) {
      console.log(chalk.bold("\nWhat's new:\n"));
      for (const line of relevantChanges) {
        console.log(line);
      }
      console.log();
    }
  } catch {
    // Silently ignore changelog fetch errors
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

program.parse();
