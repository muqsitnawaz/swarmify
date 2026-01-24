# Agents

You don't need a coding agent. You need a team.

Run Claude, Codex, Gemini, and Cursor side-by-side in your IDE. Each agent becomes a tech lead that can spawn sub-agents. You become the engineering manager - approving plans, watching execution, shipping faster.

Homepage: https://swarmify.co/#agents-ext
Marketplace: https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext
MCP Server: [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - enables sub-agent spawning

## The Problem

CLI agents like Claude Code, Codex, and Gemini are powerful - but one agent can't juggle research, implementation, testing, and debugging in one pass. Context windows force awkward batching. Running agents in separate terminals means constant context-switching.

## The Solution

This extension turns your IDE into a command center:

- **Full-screen terminals** - Agents run as editor tabs, not buried panels. See your code and agent side-by-side.
- **Session persistence** - Close VS Code, reopen it, your agent tabs come back exactly where you left off.
- **Sub-agent spawning** - With Swarm MCP enabled, each agent can delegate to other agents. Claude researches while Codex implements while Cursor debugs - in parallel.
- **Approval gates** - You approve plans before agents execute. Control without bottleneck.

## Workflow: Task, Plan, Approve

1. **Task** - Describe what you need with `/swarm` inside the IDE.
2. **Plan** - The orchestrator drafts a distribution: who codes, who debugs, who researches.
3. **Approve** - You gate execution. Agents run only after your approval.

## Quick Start

1. Install the extension from VS Code Marketplace
2. Press `Cmd+Shift+A` to spawn your first agent
3. Open Dashboard (`Cmd+Shift+D`) to configure auto-start and Swarm

## Navigation

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+L` | Label agent by task |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+Shift+D` | Open Dashboard |
| `Cmd+Shift+I` | Focus agent (quick picker) |
| `Cmd+Shift+H` | Horizontal split (tmux-style) |
| `Cmd+Shift+V` | Vertical split (tmux-style) |

## Features

### Agent Terminals

Spawn any agent as a full-screen editor tab. Built-in support for Claude Code, Codex, Gemini, OpenCode, and Cursor. Add custom agents through settings.

### Session Persistence

Every open agent terminal is fully restorable. Session ID, icon, and custom labels are saved to disk in real-time. VS Code crashes? Restart? All your agent tabs come back exactly as they were.

### Sub-Agent Spawning

With [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) installed, any agent can spawn sub-agents for parallel work. The orchestrator enforces approval gates. Sub-agents run in the background and survive IDE restarts.

### Task Management

- **Labels** - Tag agents by task (`Cmd+Shift+L`). Status bar shows active agent and label.
- **TODO.md parsing** - Discovers TODO.md files in your workspace. Spawn agents directly from task items.
- **Session history** - Browse recent sessions from the dashboard. Resume any previous conversation.

### AI Git Commits

Generate commit messages from staged changes with `Cmd+Shift+G`. Learns from your commit style, then stages, commits, and pushes in one action.

### Agent Safety Modes

When spawning sub-agents via Swarm:

- **plan** - Read-only. Agents can explore but not modify files.
- **edit** - Agents can write files after your approval.
- **ralph** - Autonomous mode. Agent works through RALPH.md tasks until done.

### Additional Features

- **Auto-start** - Configure which agents launch when VS Code opens
- **Default models** - Set preferred model per agent type
- **Shell terminals** - Spawn plain shells alongside agents (`Cmd+Shift+S`)
- **Markdown editor** - Custom `.md` editor with image paste support
- **Notifications** - Native macOS notifications when agents need attention

## For Teams

- Shared dashboard keeps approvals and assignments visible.
- Consistent agent distribution prevents over- or under-staffing tasks.
- Approval gates make it easy for leads to review before code runs.

## Requirements

- VS Code or Cursor
- Agent CLIs installed (`claude`, `codex`, `gemini`, `cursor-agent`, `opencode`)
- OpenAI API key (optional, only for commit generation)

## Related Packages

- [@swarmify/agents-mcp](https://www.npmjs.com/package/@swarmify/agents-mcp) - MCP server for sub-agent spawning
- [@swarmify/agents-cli](https://www.npmjs.com/package/@swarmify/agents-cli) - Sync prompts and skills across agents

## License

MIT
