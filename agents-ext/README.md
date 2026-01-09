# Agents

True multi-agent coding in your favorite editor.

Homepage: https://swarmify.co  
Marketplace: https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext

## Why

CLI-based AI agents like Claude Code, Codex, and Gemini are powerful - but running them in separate terminal windows means constantly switching contexts. You lose sight of your code while talking to agents.

This extension brings those agents into Cursor as editor tabs. Run multiple agents side-by-side with your code. Browse files while agents work. See what they're developing without leaving your IDE.

All the power of CLI agents. All the context of your editor.

## Features

### Instant Agent Creation

Spawn any agent instantly as an editor tab - not buried in the bottom panel. Each agent has its own icon for quick identification.

### Any Agent Supported

Built-in support for Claude Code, Codex, Gemini, and Cursor. Add custom agents through the settings panel with a 2-letter code and shell command.

### Agent Safety Modes

When using Swarm to spawn agents, you can choose between `safe` and `yolo` modes:

- **safe**: Agents prompt for confirmation before executing commands
- **yolo**: Agents auto-approve all tool calls (faster, less secure)

**Gemini CLI specifics**: When running in `yolo` mode, Gemini automatically enables sandbox mode which restricts writes to the project directory. Read access is more permissive, but file modifications are confined to the working directory. This provides a balance between speed and safety.

For more granular control, Gemini also supports `--allowed-tools` to whitelist specific tools (e.g., `run_shell_command,read_file,write_file`) instead of using full `yolo` mode.

### Easy Reload & Restart

One command clears and restarts a stuck agent. No more killing terminals and retyping commands.

### Auto-Start Configuration

Configure which agents launch automatically when Cursor opens. Set instance counts (1-10 per agent type) and toggle auto-start per agent through the visual settings panel.

### Swarm: Multi-Agent Coordination

Swarm MCP is always available; configure it per agent (Claude, Codex, Gemini) in the dashboard. Agents can spawn sub-agents for parallel work and second opinions.

> The value propositions in this README were researched by spawning Codex and Cursor agents via Swarm to analyze the codebase from different perspectives.

### Task Organization

Label agents by task. The status bar shows the active agent and its label, so you always know which agent you're talking to.

### TODO.md Parsing

Automatically discovers TODO.md files in your workspace and displays tasks in the dashboard. Spawn a Swarm directly from any open task item.

### Session History

Browse recent Claude, Codex, and Gemini sessions from your filesystem. Resume any previous session or review conversation history.

### Default Models

Set default models per agent in settings. When you spawn a new agent, it uses your preferred model automatically.

### Session Pre-warming

Enable session warming to reduce agent startup time. Each agent type handles sessions differently:

| Agent | Prewarm | Open Command |
|-------|---------|--------------|
| Claude | None needed | `claude --session-id <uuid>` |
| Codex | `codex exec ''` | `codex resume <session-id>` |
| Gemini | `gemini -p " " -o json` | `gemini --resume <session-id>` |

**Claude**: Session IDs are generated on-demand when opening a terminal. No background prewarming required - Claude accepts custom session IDs via `--session-id`.

**Codex/Gemini**: Sessions are prewarmed in the background by spawning the CLI, extracting the session ID from output, and immediately killing the process. When you open an agent, it resumes the prewarmed session instantly.

### Session Persistence

Every open agent terminal is fully restorable. Terminal state is saved to disk in real-time, so if VS Code crashes or restarts, all your agent tabs come back exactly as they were:

- **Session ID**: Resume the exact conversation where you left off
- **Icon**: CC, CX, GX icons restored for quick identification
- **Label**: Custom labels you set are preserved

No more losing agent context to crashes. Close VS Code, reopen it, and pick up right where you left off.

### Context-Aware Task Creation

Select text in any terminal, hit a shortcut, and spawn a new agent with that context pre-loaded. The selected text becomes context for your task prompt - no copy-paste needed.

### AI Git Commits

Generate commit messages from your staged changes. Learns from your commit style examples, then stages, commits, and pushes in one action.

## Quick Start

1. Install the extension
2. Spawn your first agent via command palette or shortcut
3. Open settings (`Agents`) to configure auto-start and add custom agents

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+N` | New task with context |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+Shift+L` | Label agent |
| `Cmd+Shift+G` | Generate commit |
| `Cmd+Shift+X` | Spawn Codex |
| `Cmd+Shift+M` | Spawn Gemini |
| `Cmd+Shift+U` | Spawn Cursor |
| `Cmd+Shift+D` | Open Dashboard |

## Requirements

- Cursor (or any VS Code-based editor)
- OpenAI API key (optional, only for commit generation)

## License

MIT
