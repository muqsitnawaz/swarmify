#!/usr/bin/env node

/**
 * Swarm CLI - Sync skills across AI coding agents
 *
 * Usage:
 *   swarm-cli status              Show status of all skills across agents
 *   swarm-cli sync [--skill X]    Sync skills to all agents
 *   swarm-cli init                Initialize canonical skills directory
 *   swarm-cli agents              Show agent detection status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';

import {
  ALL_AGENTS,
  PromptPackAgent,
  AgentCli,
  isCliAvailable,
  isAgentConfigured,
  getCliVersion,
  isMcpRegistered,
  getAgentSkillsDir,
} from './agents.js';

import {
  SkillName,
  SKILL_DEFINITIONS,
  getSkillsStatus,
  getCanonicalSkillsDir,
  getCanonicalSkillPath,
  hasCanonicalSkill,
  syncSkillToAllAgents,
  syncAllSkills,
  installSkillToAgent,
  readCanonicalSkill,
} from './skills.js';

const program = new Command();

program
  .name('swarm-cli')
  .description('Sync skills across AI coding agents (Claude, Codex, Gemini, Cursor)')
  .version('0.1.0');

// ============================================================================
// STATUS COMMAND
// ============================================================================

program
  .command('status')
  .description('Show status of all skills across agents')
  .option('-v, --verbose', 'Show detailed information')
  .action((options) => {
    console.log(chalk.bold('\nSkills Status\n'));

    const statuses = getSkillsStatus();
    const agents: PromptPackAgent[] = ['claude', 'codex', 'gemini', 'cursor'];

    // Header
    const header = [
      chalk.bold('Skill'.padEnd(12)),
      ...agents.map(a => chalk.bold(a.padEnd(10))),
      chalk.bold('Source'),
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(70));

    // Skills
    for (const status of statuses) {
      const cols = [status.name.padEnd(12)];

      for (const agent of agents) {
        const agentStatus = status.agents[agent];
        let cell: string;

        if (!agentStatus.supported) {
          cell = chalk.gray('-'.padEnd(10));
        } else if (agentStatus.builtin) {
          cell = chalk.blue('builtin'.padEnd(10));
        } else if (agentStatus.installed) {
          cell = chalk.green('installed'.padEnd(10));
        } else {
          cell = chalk.yellow('missing'.padEnd(10));
        }
        cols.push(cell);
      }

      // Canonical source indicator
      cols.push(status.hasCanonicalSource ? chalk.green('yes') : chalk.red('no'));

      console.log(cols.join('  '));
    }

    // Summary
    console.log();

    const totalSkills = statuses.length;
    const withSource = statuses.filter(s => s.hasCanonicalSource).length;

    for (const agent of agents) {
      const supported = statuses.filter(s => s.agents[agent].supported).length;
      const installed = statuses.filter(s => s.agents[agent].installed).length;
      const pct = supported > 0 ? Math.round((installed / supported) * 100) : 0;
      const color = pct === 100 ? chalk.green : pct > 50 ? chalk.yellow : chalk.red;
      console.log(`  ${agent.padEnd(8)} ${color(`${installed}/${supported}`)} skills installed (${pct}%)`);
    }

    console.log();
    console.log(`  Canonical source: ${withSource}/${totalSkills} skills have source files`);
    console.log(`  Location: ${getCanonicalSkillsDir()}`);
    console.log();
  });

// ============================================================================
// AGENTS COMMAND
// ============================================================================

program
  .command('agents')
  .description('Show agent CLI detection status')
  .action(() => {
    console.log(chalk.bold('\nAgent CLI Status\n'));

    const cliAgents: AgentCli[] = ['claude', 'codex', 'gemini'];

    for (const agent of cliAgents) {
      const available = isCliAvailable(agent);
      const version = available ? getCliVersion(agent) : null;
      const configured = isAgentConfigured(agent);
      const mcp = available ? isMcpRegistered(agent) : false;
      const skillsDir = getAgentSkillsDir(agent);
      const skillsDirExists = fs.existsSync(skillsDir);

      console.log(chalk.bold(`  ${agent}`));
      console.log(`    CLI:        ${available ? chalk.green('installed') : chalk.red('not found')}`);
      if (version) {
        console.log(`    Version:    ${chalk.gray(version)}`);
      }
      console.log(`    Config:     ${configured ? chalk.green('~/.'+agent) : chalk.gray('not configured')}`);
      console.log(`    Skills dir: ${skillsDirExists ? chalk.green(skillsDir) : chalk.gray('not created')}`);
      console.log(`    Swarm MCP:  ${mcp ? chalk.green('registered') : chalk.yellow('not registered')}`);
      console.log();
    }

    // Cursor (no CLI, just config detection)
    const cursorConfigured = isAgentConfigured('cursor');
    const cursorSkillsDir = getAgentSkillsDir('cursor');
    const cursorSkillsDirExists = fs.existsSync(cursorSkillsDir);

    console.log(chalk.bold('  cursor'));
    console.log(`    Config:     ${cursorConfigured ? chalk.green('~/.cursor') : chalk.gray('not configured')}`);
    console.log(`    Skills dir: ${cursorSkillsDirExists ? chalk.green(cursorSkillsDir) : chalk.gray('not created')}`);
    console.log();
  });

// ============================================================================
// SYNC COMMAND
// ============================================================================

program
  .command('sync')
  .description('Sync skills from canonical source to agents')
  .option('-s, --skill <name>', 'Sync a specific skill only')
  .option('-a, --agent <name>', 'Sync to a specific agent only (claude, codex, gemini, cursor)')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action((options) => {
    const spinner = options.dryRun ? null : ora('Syncing skills...').start();

    const targetSkills: SkillName[] = options.skill
      ? [options.skill as SkillName]
      : SKILL_DEFINITIONS.map(s => s.name);

    const targetAgents: PromptPackAgent[] = options.agent
      ? [options.agent as PromptPackAgent]
      : ALL_AGENTS;

    if (options.dryRun) {
      console.log(chalk.bold('\nDry run - would sync:\n'));
    }

    let successCount = 0;
    let failCount = 0;
    const results: string[] = [];

    for (const skillName of targetSkills) {
      const content = readCanonicalSkill(skillName);

      if (!content) {
        if (options.dryRun) {
          results.push(chalk.yellow(`  ${skillName}: no canonical source`));
        }
        continue;
      }

      for (const agent of targetAgents) {
        if (options.dryRun) {
          const skillDef = SKILL_DEFINITIONS.find(s => s.name === skillName);
          const support = skillDef?.agents[agent];
          if (support === 'builtin') {
            results.push(chalk.blue(`  ${skillName} -> ${agent}: builtin (skip)`));
          } else if (support) {
            results.push(chalk.green(`  ${skillName} -> ${agent}: would install`));
          } else {
            results.push(chalk.gray(`  ${skillName} -> ${agent}: not supported`));
          }
          continue;
        }

        const result = installSkillToAgent(skillName, agent, content);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          if (result.reason !== 'Not supported for this agent') {
            results.push(chalk.red(`  ${skillName} -> ${agent}: ${result.reason}`));
          }
        }
      }
    }

    if (options.dryRun) {
      for (const r of results) {
        console.log(r);
      }
      console.log();
      return;
    }

    if (spinner) {
      spinner.succeed('Sync complete');
    }
    console.log();
    console.log(`  ${chalk.green(successCount.toString())} skills synced successfully`);
    if (failCount > 0) {
      console.log(`  ${chalk.red(failCount.toString())} failed`);
      for (const r of results) {
        console.log(r);
      }
    }
    console.log();
  });

// ============================================================================
// INIT COMMAND
// ============================================================================

program
  .command('init')
  .description('Initialize canonical skills directory with sample templates')
  .option('--force', 'Overwrite existing skill files')
  .action((options) => {
    const skillsDir = getCanonicalSkillsDir();
    console.log(chalk.bold('\nInitializing skills directory\n'));
    console.log(`  Location: ${skillsDir}\n`);

    // Create directory
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
      console.log(chalk.green('  Created skills directory'));
    } else {
      console.log(chalk.gray('  Skills directory already exists'));
    }

    // Create sample skill templates
    const sampleSkills = [
      {
        name: 'swarm',
        content: `You are a multi-agent orchestrator. Use the Swarm MCP tools to spawn and coordinate AI agents.

## Available MCP Tools

- **Spawn**: Start a new agent on a specific task
- **Status**: Check the progress of running agents
- **Stop**: Halt one or all agents
- **Tasks**: List all tasks and their agents

## Usage Patterns

1. Break complex tasks into parallel subtasks
2. Spawn specialized agents for each subtask
3. Monitor progress with Status
4. Coordinate results when agents complete

## Best Practices

- Use descriptive task names for easy tracking
- Keep prompts focused and specific
- Use 'plan' mode for exploration, 'edit' mode for changes
`,
      },
      {
        name: 'plan',
        content: `Create a concise implementation plan for the requested feature or change.

## Instructions

1. Analyze the current codebase to understand existing patterns
2. Identify files that need to be created or modified
3. List specific steps in order of execution
4. Note any dependencies or potential issues

## Output Format

Provide a numbered list of concrete steps. Each step should be actionable and specific.
Do not include time estimates. Focus on what needs to be done, not when.
`,
      },
      {
        name: 'splan',
        content: `Create a sprint-sized implementation plan with parallel execution steps.

## Instructions

1. Break the task into independent subtasks that can run in parallel
2. Identify dependencies between subtasks
3. Group parallelizable work together
4. Suggest which agent type is best for each subtask

## Output Format

### Parallel Group 1
- [ ] Task A (suggested: claude - research heavy)
- [ ] Task B (suggested: codex - surgical edit)

### Parallel Group 2 (depends on Group 1)
- [ ] Task C
- [ ] Task D

## Notes
- Keep subtasks focused and independent
- Each should complete in a reasonable time
`,
      },
      {
        name: 'debug',
        content: `Diagnose the root cause of an issue before attempting fixes.

## Instructions

1. Reproduce the issue and understand the symptoms
2. Trace the code path that leads to the problem
3. Identify the root cause (not just symptoms)
4. Propose a minimal fix

## Output Format

### Symptoms
[What is observed]

### Root Cause
[The underlying issue]

### Proposed Fix
[Minimal changes needed]
`,
      },
      {
        name: 'test',
        content: `Design a lean test plan for the feature or fix.

## Instructions

1. Identify the critical paths that need testing
2. List edge cases and error conditions
3. Suggest test implementation approach
4. Keep tests focused and minimal

## Output Format

### Unit Tests
- [ ] Test case 1
- [ ] Test case 2

### Integration Tests
- [ ] Test case 1

### Edge Cases
- [ ] Edge case 1
`,
      },
      {
        name: 'sdebug',
        content: `Parallelize debugging investigation using multiple agents.

## Instructions

Use the Swarm MCP tools to spawn multiple agents that investigate different hypotheses simultaneously.

1. Identify 2-3 possible root causes
2. Spawn agents to investigate each hypothesis in parallel
3. Gather evidence from each investigation
4. Synthesize findings to determine the actual root cause

## Spawning Pattern

\`\`\`
Spawn("investigate-hypothesis-1", "claude", "Check if the error is caused by X...")
Spawn("investigate-hypothesis-2", "codex", "Verify if Y is working correctly...")
\`\`\`

Then use Status to monitor progress and gather results.
`,
      },
      {
        name: 'sconfirm',
        content: `Confirm changes with parallel verification checks.

## Instructions

Before finalizing changes, spawn multiple agents to verify:
1. Tests pass
2. Linting is clean
3. Types check
4. No regressions

## Spawning Pattern

\`\`\`
Spawn("run-tests", "codex", "Run the test suite and report results")
Spawn("run-lint", "codex", "Run linting and report issues")
Spawn("check-types", "codex", "Run type checking")
\`\`\`

Wait for all agents to complete and verify all checks pass before proceeding.
`,
      },
      {
        name: 'clean',
        content: `Refactor code safely for clarity without changing behavior.

## Instructions

1. Identify the code that needs cleaning
2. Understand its current behavior thoroughly
3. Plan refactoring steps that preserve behavior
4. Make incremental changes with tests to verify

## Safety Guidelines

- Never change behavior while refactoring
- Run tests after each change
- Keep changes small and reviewable
- Document any non-obvious decisions
`,
      },
      {
        name: 'sclean',
        content: `Parallel refactoring plan for larger cleanups.

## Instructions

Break refactoring into independent chunks that can be done in parallel:
1. Identify files that can be refactored independently
2. Group related changes
3. Spawn agents for each group

## Spawning Pattern

\`\`\`
Spawn("clean-module-a", "claude", "Refactor module A...")
Spawn("clean-module-b", "codex", "Clean up module B...")
\`\`\`

Ensure changes don't conflict by keeping file sets separate.
`,
      },
      {
        name: 'stest',
        content: `Parallelize test creation across modules.

## Instructions

1. Identify test coverage gaps
2. Group tests by module or feature
3. Spawn agents to write tests in parallel

## Spawning Pattern

\`\`\`
Spawn("test-module-a", "codex", "Write unit tests for module A")
Spawn("test-module-b", "codex", "Write integration tests for feature B")
\`\`\`

Each agent should focus on a specific area to avoid conflicts.
`,
      },
      {
        name: 'ship',
        content: `Pre-launch verification checklist.

## Instructions

Before shipping, verify:

1. All tests pass
2. Code has been reviewed
3. Documentation is updated
4. Breaking changes are documented
5. Migration path is clear (if needed)

## Checklist

- [ ] Tests passing
- [ ] Lint clean
- [ ] Types check
- [ ] Docs updated
- [ ] CHANGELOG updated (if applicable)
- [ ] No console.logs or debug code
`,
      },
      {
        name: 'sship',
        content: `Ship with independent parallel assessments.

## Instructions

Spawn multiple agents to independently verify ship-readiness:

\`\`\`
Spawn("verify-tests", "codex", "Run full test suite and report")
Spawn("verify-security", "claude", "Check for security issues")
Spawn("verify-perf", "claude", "Check for performance regressions")
\`\`\`

Require all agents to give green light before shipping.
`,
      },
      {
        name: 'recap',
        content: `Generate a handoff summary with facts and grounded hypotheses.

## Instructions

Create a summary for the next person (or agent) picking up this work:

1. What was the goal?
2. What was accomplished?
3. What is the current state?
4. What remains to be done?
5. Any blockers or concerns?

## Output Format

### Goal
[Original objective]

### Completed
[What was done]

### Current State
[Where things stand now]

### Remaining Work
[What still needs to be done]

### Notes
[Any important context, gotchas, or recommendations]
`,
      },
      {
        name: 'srecap',
        content: `Agents investigate gaps before handoff.

## Instructions

Before creating handoff documentation, spawn agents to investigate any unclear areas:

\`\`\`
Spawn("investigate-gaps", "claude", "What areas of this work need more documentation?")
Spawn("verify-completeness", "codex", "Are there any TODO comments or incomplete implementations?")
\`\`\`

Synthesize findings into a comprehensive handoff document.
`,
      },
      {
        name: 'simagine',
        content: `Generate visual asset prompts for image generation.

## Instructions (Codex only)

This skill is for generating prompts for visual assets like icons, illustrations, or UI mockups.

1. Describe the visual asset needed
2. Specify style requirements
3. Include any brand guidelines
4. Provide context for usage

## Output Format

### Asset: [Name]
- **Style**: [flat, 3d, sketch, etc.]
- **Colors**: [palette]
- **Size**: [dimensions]
- **Format**: [svg, png, etc.]

### Prompt
[Detailed prompt for image generation]
`,
      },
    ];

    let created = 0;
    let skipped = 0;

    for (const skill of sampleSkills) {
      const skillPath = getCanonicalSkillPath(skill.name);
      if (fs.existsSync(skillPath) && !options.force) {
        console.log(chalk.gray(`  ${skill.name}.md - already exists (use --force to overwrite)`));
        skipped++;
        continue;
      }

      fs.writeFileSync(skillPath, skill.content);
      console.log(chalk.green(`  ${skill.name}.md - created`));
      created++;
    }

    console.log();
    console.log(`  ${chalk.green(created.toString())} files created, ${chalk.gray(skipped.toString())} skipped`);
    console.log();
    console.log('  Run `swarm-cli sync` to install these skills to your agents.');
    console.log();
  });

// ============================================================================
// LIST COMMAND
// ============================================================================

program
  .command('list')
  .description('List all available skills')
  .action(() => {
    console.log(chalk.bold('\nAvailable Skills\n'));

    for (const skill of SKILL_DEFINITIONS) {
      const hasSource = hasCanonicalSkill(skill.name);
      const sourceIndicator = hasSource ? chalk.green('[source]') : chalk.gray('[no source]');
      const agents = Object.entries(skill.agents)
        .filter(([_, v]) => v)
        .map(([k, v]) => v === 'builtin' ? chalk.blue(k) : k)
        .join(', ');

      console.log(`  ${chalk.bold(skill.name.padEnd(12))} ${skill.description}`);
      console.log(`  ${''.padEnd(12)} Agents: ${agents}  ${sourceIndicator}`);
      console.log();
    }
  });

// ============================================================================
// PATHS COMMAND
// ============================================================================

program
  .command('paths')
  .description('Show all relevant paths for skills and configs')
  .action(() => {
    console.log(chalk.bold('\nSkill Paths\n'));

    console.log(chalk.bold('  Canonical source:'));
    console.log(`    ${getCanonicalSkillsDir()}\n`);

    console.log(chalk.bold('  Agent destinations:'));
    for (const agent of ALL_AGENTS) {
      console.log(`    ${agent.padEnd(8)} ${getAgentSkillsDir(agent)}`);
    }
    console.log();
  });

program.parse();
