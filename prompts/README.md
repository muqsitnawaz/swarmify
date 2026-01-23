# Swarmify Workflows

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![GitHub stars](https://img.shields.io/github/stars/muqsitnawaz/swarmify)
![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)

<p align="center">
  <img src=".assets/claude.png" height="60" alt="Claude" style="margin: 0 10px;">
  <img src=".assets/cursor.png" height="60" alt="Cursor" style="margin: 0 10px;">
  <img src=".assets/gemini.png" height="60" alt="Gemini" style="margin: 0 10px;">
</p>

> Slash commands for Claude, Cursor, Codex, and Gemini

## Part of the Swarmify Ecosystem

This repository provides **production-ready workflows** for multi-agent coding. It's the workflow layer that sits on top of:

- **[@swarmify/agents-mcp](https://swarmify.co)** - MCP server that gives AI agents the ability to spawn and orchestrate other agents
- **[Agents Extension](https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext)** - VS Code extension that brings CLI agents into your editor as tabs

Together, these enable sophisticated multi-agent workflows like `/sdebug` (spawn 2-3 agents to independently verify root cause) and `/splan` (parallel planning with consensus).

## Why Model-Specific Calibration?

When working with multiple AI coding agents, each model has different strengths. These commands are calibrated to extract the best performance:

**Codex**: Requires explicit planning phase. Commands make it research relevant code first, output a clear plan, then execute. Without this, changes often fail.

**Claude**: Built-in planning capabilities. Commands leverage native strengths for direct execution.

**Gemini**: Optimized for specific strengths in analysis and verification tasks.

Each `.md`/`.toml` file contains carefully tuned prompts that account for these differences.

## What You Get

- Battle-tested workflows - Commands refined through real-world use
- Multi-agent orchestration - Use Swarm MCP to spawn verifier agents
- Cross-platform - Same commands work in Claude Code, Codex, Gemini
- Version-controlled - Fork, customize, sync across machines
- No mock tests - All workflows tested E2E with real agents

## Start with `/swarm`

Use `/swarm` as the primary entry point for multi-agent work. Describe the task and what balance of strengths you want; the orchestrator proposes a distribution plan, waits for approval, then launches the mix.

### Approval Workflow

Three-step flow: task → plan → approve. Execution starts only after the approval gate.

1. Describe the task with `/swarm`.
2. Orchestrator presents a distribution plan (agents, ownership, boundary contracts).
3. Approve or adjust the plan; nothing runs until you say yes.
4. Agents execute, report results, and run relevant tests.

### Specifying Your Mix

Describe the Mix of Agents you want; the orchestrator interprets your percentages or roles and assembles the team automatically.

- Example 1: “I need 80% Codex (fast fixes), 20% Cursor (debugging) - no research needed.”
- Example 2: “Heavy research task: 70% Gemini, 20% Claude, 10% Codex.”

### Team Orchestration Patterns

- Bug triage: 40% research (Gemini) + 60% Cursor debugging
- Feature spike: 50% planning (Claude) + 30% research (Gemini) + 20% coding (Codex)
- Refactor: 70% coding (Codex) + 30% testing (Cursor)

## Quick Start

**Prerequisites**: Install [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) for multi-agent workflows (optional for single-agent commands).

```bash
# Clone repository
git clone https://github.com/muqsitnawaz/.agents.git ~/.agents
cd ~/.agents

# Install commands to your system
./scripts/sync.sh push --confirm
```

Try a command:
```bash
/swarm     # Orchestrated mix of agents with approval gate
/plan      # Plan a feature
/debug     # Debug an issue
/splan     # Swarm planning (requires agents-mcp)
/sdebug    # Swarm debugging (parallel verifiers)
```

## Commands

### Core Commands

| Purpose | Command | Claude | Cursor | Codex | Gemini |
|---------|---------|--------|--------|-------|--------|
| Plan implementation | `/plan` | (built-in) | [plan.md](cursor/commands/plan.md) | [plan.md](codex/prompts/plan.md) | [plan.toml](gemini/commands/plan.toml) |
| Debug issues | `/debug` | [debug.md](claude/commands/debug.md) | [debug.md](cursor/commands/debug.md) | [debug.md](codex/prompts/debug.md) | [debug.toml](gemini/commands/debug.toml) |
| Clean technical debt | `/clean` | [clean.md](claude/commands/clean.md) | [clean.md](cursor/commands/clean.md) | [clean.md](codex/prompts/clean.md) | [clean.toml](gemini/commands/clean.toml) |
| Write tests | `/test` | [test.md](claude/commands/test.md) | [test.md](cursor/commands/test.md) | [test.md](codex/prompts/test.md) | [test.toml](gemini/commands/test.toml) |
| Pre-launch verification | `/ship` | [ship.md](claude/commands/ship.md) | [ship.md](cursor/commands/ship.md) | [ship.md](codex/prompts/ship.md) | [ship.toml](gemini/commands/ship.toml) |

### Swarm Commands

Multi-agent verification - spawn independent agents to validate findings.

| Purpose | Command | Claude | Cursor | Codex | Gemini |
|---------|---------|--------|--------|-------|--------|
| Parallel planning | `/splan` | [splan.md](claude/commands/splan.md) | [splan.md](cursor/commands/splan.md) | [splan.md](codex/prompts/splan.md) | [splan.toml](gemini/commands/splan.toml) |
| Swarm debugging | `/sdebug` | [sdebug.md](claude/commands/sdebug.md) | [sdebug.md](cursor/commands/sdebug.md) | [sdebug.md](codex/prompts/sdebug.md) | [sdebug.toml](gemini/commands/sdebug.toml) |
| Verify findings | `/sconfirm` | [sconfirm.md](claude/commands/sconfirm.md) | [sconfirm.md](cursor/commands/sconfirm.md) | [sconfirm.md](codex/prompts/sconfirm.md) | [sconfirm.toml](gemini/commands/sconfirm.toml) |
| Parallel cleanup | `/sclean` | [sclean.md](claude/commands/sclean.md) | [sclean.md](cursor/commands/sclean.md) | [sclean.md](codex/prompts/sclean.md) | [sclean.toml](gemini/commands/sclean.toml) |
| Parallel testing | `/stest` | [stest.md](claude/commands/stest.md) | [stest.md](cursor/commands/stest.md) | [stest.md](codex/prompts/stest.md) | [stest.toml](gemini/commands/stest.toml) |
| Swarm verification | `/sship` | [sship.md](claude/commands/sship.md) | [sship.md](cursor/commands/sship.md) | [sship.md](codex/prompts/sship.md) | [sship.toml](gemini/commands/sship.toml) |

Click on command files to see implementation details and customization options.

## Advanced Usage

**Customize commands** - Fork this repository to adapt workflows for your needs:

```bash
# Edit a command
vim ~/.agents/claude/commands/debug.md

# Test the change
/debug "test issue"

# Commit and push to your fork
cd ~/.agents
git add claude/commands/debug.md
git commit -m "customize: debug command for my workflow"
git push
```

**Sync across machines** - Keep your customizations synced:

```bash
# On another machine, pull your changes
cd ~/.agents
git pull origin main

# Update local system with latest commands
./scripts/sync.sh push --confirm
```

See [AGENTS.md](./AGENTS.md) for detailed documentation on command structure and framework detection.

## Privacy & Security

- `settings.json` is excluded (contains tokens, env vars)
- Only `permissions.json` is tracked (permission strings only)
- Hooks are provided as templates (remove sensitive auth if added)
- Review git diffs before pushing to public repos

## Support

Need help?

- See [AGENTS.md](./AGENTS.md) for detailed command documentation
- Check [GitHub Issues](https://github.com/muqsitnawaz/swarmify/issues) for bug reports
- Start a [Discussion](https://github.com/muqsitnawaz/swarmify/discussions) for questions

---

**Synced across**: Claude Code, Codex, Gemini
**License**: MIT
