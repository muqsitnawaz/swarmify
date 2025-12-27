# Agents

VS Code extension for managing multiple AI agent terminal instances in the editor with support for custom agents.

## Features

- Built-in support for Claude Code, Codex, Gemini, and OpenCode terminals
- Add custom AI agents (e.g., Gemini CLI, GPT-4 CLI, etc.)
- Configure starting instance counts per agent
- Individual commands to open single agent instances
- Opens terminals in the editor area with custom icons
- Persistent across VS Code restarts
- Pin terminals for easy access

## Usage

### Commands

- **Run Agents** - Opens all configured agents with their specified counts
- **Agents: New Claude Code** - Opens a single Claude Code terminal
- **Agents: New Codex** - Opens a single Codex terminal
- **Agents: New Gemini Agent** - Opens a single Gemini terminal
- **Agents: New OpenCode** - Opens a single OpenCode terminal
- **Agents: Close All Terminals** - Closes all managed terminals
- **Agents: Configure Counts** - Interactive configuration dialog

Custom agents automatically get commands registered as `Agents: New [Title]` when defined in settings.

### Settings

Configure in VS Code settings (JSON or UI):

#### General Settings
- `agentTabs.autoStart` - Automatically open configured agents on workspace startup (default: `false`)
  - When `false`: Agents only start when you manually click "Run Agents" or use individual commands
  - When `true`: Agents automatically open on startup based on configured counts

#### Built-in Agents
- `agentTabs.claudeCount` - Number of Claude Code terminals (0-10, default: 2)
- `agentTabs.codexCount` - Number of Codex terminals (0-10, default: 2)
- `agentTabs.geminiCount` - Number of Gemini terminals (0-10, default: 2)

#### Custom Agents
- `agentTabs.customAgents` - Array of custom agent configurations

Example custom agent configuration in `settings.json`:
```json
{
  "agentTabs.customAgents": [
    {
      "title": "GC",
      "command": "gemini-cli",
      "count": 2,
      "iconPath": "assets/gemini-icon.png"
    },
    {
      "title": "GPT",
      "command": "gpt-cli",
      "count": 1
    }
  ]
}
```

Custom agent properties:
- `title` (required) - Display title for the agent (e.g., "GC" for Gemini CLI)
- `command` (required) - Terminal command to run (e.g., "gemini-cli")
- `count` (required) - Number of terminal instances to open on startup (0-10)
- `iconPath` (optional) - Path to custom icon relative to extension root (defaults to `assets/agents.png`)

## Requirements

- Built-in agents: `claude`, `codex`, and `gemini` CLI tools installed and in PATH
- Custom agents: respective CLI tools installed and accessible

## Development

Install dependencies:
```bash
bun install
```

Compile:
```bash
bun run compile
```

Watch mode:
```bash
bun run watch
```

Test: Press F5 in VS Code to launch Extension Development Host

## Build and Install

Build a specific version:
```bash
scripts/build.sh 1.0.0
```

Build and install in one step:
```bash
scripts/install.sh 1.0.0
```
