# Cursor Agents

VS Code extension for managing multiple Claude Code and Codex terminal instances in the editor.

## Features

- Configure the number of Claude Code and Codex terminals
- Opens terminals in the editor area with custom icons
- Persistent across VS Code restarts
- Pin terminals for easy access

## Usage

### Commands

- **Agent Tabs: Open All Terminals** - Opens configured number of terminals
- **Agent Tabs: Close All Terminals** - Closes all managed terminals
- **Agent Tabs: Configure Counts** - Interactive configuration dialog

### Settings

Configure in VS Code settings:

- `agentTabs.claudeCount` - Number of Claude Code terminals (1-10, default: 2)
- `agentTabs.codexCount` - Number of Codex terminals (1-10, default: 2)

## Requirements

- `claude` CLI tool installed and in PATH
- `codex` CLI tool installed and in PATH

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
