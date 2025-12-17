# Agents

Manage AI coding agents as editor tabs. Spawn Claude, Codex, Gemini, Cursor, or any custom agent with a single shortcut.

## Keyboard-First Workflow

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+A` | Spawn new agent |
| `Cmd+Shift+C` | Clear and restart agent |
| `Cmd+L` | Label agent by task |
| `Cmd+Shift+G` | Generate commit |

No terminal commands to memorize. No manual setup. Just shortcuts.

## Features

### Instant Agent Creation

`Cmd+Shift+A` and you have a new agent. Each one opens as an editor tab with its own icon - not buried in the bottom panel.

### Any Agent Supported

Built-in support for Claude Code, Codex, Gemini, and Cursor. Add custom agents with a 2-letter code and shell command through the settings panel.

### Easy Reload & Restart

Agent stuck? `Cmd+Shift+C` clears and restarts it instantly. No more killing terminals and retyping commands.

### Auto-Start Configuration

Configure which agents launch automatically when VS Code opens. Set instance counts (1-10 per agent type) and toggle auto-start per agent through the visual settings panel.

### Swarm: Multi-Agent Coordination

Enable Swarm to let agents spawn sub-agents within themselves. Get second opinions from different AI models or run parallel tasks from a single agent session.

> The value propositions in this README were researched by spawning Codex and Cursor agents via Swarm to analyze the codebase from different perspectives.

### Task Organization

Label agents by task with `Cmd+L`. The status bar shows the active agent and its label, so you always know which agent you're talking to.

### AI Git Commits

`Cmd+Shift+G` generates a commit message from your staged changes, learns from your commit style examples, then stages, commits, and pushes.

## Quick Start

1. Install the extension
2. `Cmd+Shift+A` to spawn your first agent
3. Open settings (`Agents: Settings` in command palette) to configure auto-start and add custom agents

## Configuration

| Setting | Description |
|---------|-------------|
| `agents.apiKey` | OpenAI API key (for commit generation) |
| `agents.commitMessageExamples` | Example commits for AI style guidance |
| `agents.ignoreFiles` | Patterns to ignore in diffs |

## Requirements

- VS Code 1.85+
- OpenAI API key (optional, only for commit generation)

## License

MIT
