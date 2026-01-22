# Agents

Full-screen agent terminals in your editor. Manage multiple tech leads from one IDE.

Homepage: https://swarmify.co
Marketplace: https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext

## Why

CLI agents like Claude Code, Codex, and Gemini are powerful - but running them in separate terminal windows or the bottom panel means constantly switching contexts. You lose sight of your code while talking to agents. Fonts get tiny. Sessions disappear when things crash.

This extension gives you:

- **Full-screen terminals** - Agents run as editor tabs, not buried panels. See your code and agent side-by-side.
- **Session persistence** - Close VS Code, reopen it, your agent tabs come back exactly where you left off.
- **Fast navigation** - Keyboard shortcuts to jump between agents, label them by task, restart stuck ones. Like Vim for agent sessions.

## The manager's cockpit

With Swarm MCP enabled, each agent in a tab becomes a tech lead that can spawn its own sub-agents. You become an engineering manager overseeing multiple tech leads - each running their own team in the background.

The extension is optimized for this workflow: quick navigation between agents, labels to track who's working on what, dashboard to see all activity.

## Features

### Agent Terminals

Spawn any agent as a full-screen editor tab with `Cmd+Shift+A`. Built-in support for Claude Code, Codex, Gemini, OpenCode, and Cursor. Add custom agents through settings.

### Navigation

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+L` | Label agent by task |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+Shift+D` | Open Dashboard |
| `Cmd+Shift+I` | Focus agent (quick picker) |
| `Cmd+Shift+H` | Horizontal split (tmux-style) |
| `Cmd+Shift+V` | Vertical split (tmux-style) |

### Session Persistence

Every open agent terminal is fully restorable. Session ID, icon, and custom labels are saved to disk in real-time. VS Code crashes? Restart? All your agent tabs come back exactly as they were.

### Swarm Integration

Swarm MCP is available per-agent (Claude, Codex, Gemini) via the dashboard. When enabled, your agents can spawn sub-agents for parallel work. The orchestrating agent manages them - you just see results.

### Task Management

- **Labels** - Tag agents by task (`Cmd+Shift+L`). Status bar shows active agent and label.
- **TODO.md parsing** - Discovers TODO.md files in your workspace. Spawn agents directly from task items.
- **Session history** - Browse recent sessions from the dashboard. Resume any previous conversation.

### AI Git Commits

Generate commit messages from staged changes with `Cmd+Shift+G`. Learns from your commit style, then stages, commits, and pushes in one action.

### Agent Safety Modes

When spawning sub-agents via Swarm:

- **safe** - Agents prompt for confirmation before executing commands
- **yolo** - Agents auto-approve all tool calls (faster, less secure)

### Additional Features

- **Auto-start** - Configure which agents launch when VS Code opens
- **Default models** - Set preferred model per agent type
- **Shell terminals** - Spawn plain shells alongside agents (`Cmd+Shift+S`)
- **Markdown editor** - Custom `.md` editor with image paste support
- **Notifications** - Native macOS notifications when agents need attention
- **Context tasks** - Select text, hit shortcut, spawn agent with that context pre-loaded

## Quick Start

1. Install the extension from VS Code Marketplace
2. Press `Cmd+Shift+A` to spawn your first agent
3. Open Dashboard (`Cmd+Shift+D`) to configure auto-start and Swarm

## Requirements

- VS Code or Cursor
- Agent CLIs installed (`claude`, `codex`, `gemini`, `cursor-agent`)
- OpenAI API key (optional, only for commit generation)

## License

MIT
