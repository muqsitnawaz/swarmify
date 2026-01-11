# Examples

Quick demos to get started with Swarmify.

## MCP Server Setup

### Claude Code

```bash
claude mcp add swarmify -- npx -y @swarmify/server
```

Then use `/swarm` to orchestrate multiple agents:

```
/swarm Implement user authentication with JWT tokens
```

### Gemini CLI

```bash
gemini mcp add swarmify -- npx -y @swarmify/server
```

## Extension Setup

Install "Agents" from VS Code Marketplace, or:

```bash
code --install-extension swarmify.agents
```

Open Command Palette (`Cmd+Shift+P`) and run:
- `Agents: Open Claude` - Launch Claude Code in editor tab
- `Agents: Open Codex` - Launch Codex in editor tab
- `Agents: Swarm Mode` - Orchestrate multiple agents

## Example Workflows

### Multi-Agent Debug Session

```
/sdebug The API returns 500 errors intermittently on /users endpoint
```

This spawns 2-3 independent agents to investigate, then synthesizes findings.

### Parallel Feature Implementation

```
/swarm Add dark mode support:
- Agent 1: Update theme context and CSS variables
- Agent 2: Add toggle component to settings
- Agent 3: Persist preference to localStorage
```

### Code Review with Verification

```
/sconfirm Review the changes in the last 3 commits for security issues
```

## Prompts Library

The `prompts/` directory contains slash commands for each agent:

| Command | Description |
|---------|-------------|
| `/plan` | Design implementation approach |
| `/debug` | Root cause analysis |
| `/test` | Write critical path tests |
| `/clean` | Remove tech debt |
| `/ship` | Pre-launch verification |
| `/swarm` | Multi-agent orchestration |

Each has swarm variants (`/splan`, `/sdebug`, etc.) for parallel verification.
