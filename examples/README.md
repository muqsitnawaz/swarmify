# Examples

Quick demos to get started with Swarmify. `/swarm` is the single entry point: you describe the task and desired mix, the lead agent proposes a plan, you approve, and the swarm executes.

## MCP Server Setup

### Claude Code

```bash
claude mcp add Swarm -- npx -y @swarmify/agents-mcp
```

Then use `/swarm` to orchestrate multiple agents with your mix:

```
/swarm Implement user authentication with JWT tokens — 60% Claude planning, 40% Codex coding
```

### Gemini CLI

```bash
gemini mcp add Swarm -- npx -y @swarmify/agents-mcp
```

Approval flow: `/swarm "task with mix"` → lead agent proposes plan + Mix of Agents → you approve → swarm executes.

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

### Mix-Driven Run

```
/swarm Ship billing polish — 70% Claude planning, 30% Cursor debugging
```

Lead agent creates the plan and distribution, you approve, and the swarm runs hierarchically.

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
