# Agents

True multi-agent coding in your favorite editor.

## Why

CLI-based AI agents like Claude Code, Codex, and Gemini are powerful - but running them in separate terminal windows means constantly switching contexts. You lose sight of your code while talking to agents.

This extension brings those agents into Cursor as editor tabs. Run multiple agents side-by-side with your code. Browse files while agents work. See what they're developing without leaving your IDE.

All the power of CLI agents. All the context of your editor.

## Features

### Instant Agent Creation

Spawn any agent instantly as an editor tab - not buried in the bottom panel. Each agent has its own icon for quick identification.

### Any Agent Supported

Built-in support for Claude Code, Codex, Gemini, and Cursor. Add custom agents through the settings panel with a 2-letter code and shell command.

### Easy Reload & Restart

One command clears and restarts a stuck agent. No more killing terminals and retyping commands.

### Auto-Start Configuration

Configure which agents launch automatically when Cursor opens. Set instance counts (1-10 per agent type) and toggle auto-start per agent through the visual settings panel.

### Swarm: Multi-Agent Coordination

Enable Swarm to let agents spawn sub-agents within themselves. Get second opinions from different AI models or run parallel tasks from a single agent session.

> The value propositions in this README were researched by spawning Codex and Cursor agents via Swarm to analyze the codebase from different perspectives.

### Task Organization

Label agents by task. The status bar shows the active agent and its label, so you always know which agent you're talking to.

### Context-Aware Task Creation

Select text in any terminal, hit a shortcut, and spawn a new agent with that context pre-loaded. The selected text becomes context for your task prompt - no copy-paste needed.

### AI Git Commits

Generate commit messages from your staged changes. Learns from your commit style examples, then stages, commits, and pushes in one action.

## Quick Start

1. Install the extension
2. Spawn your first agent via command palette or shortcut
3. Open settings (`Agents: Settings`) to configure auto-start and add custom agents

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+N` | New task with context |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+L` | Label agent |
| `Cmd+Shift+G` | Generate commit |

## Requirements

- Cursor (or any VS Code-based editor)
- OpenAI API key (optional, only for commit generation)

## License

MIT