# Multi-Agent Orchestration System

MCP server that lets Claude Code spawn and coordinate multiple AI coding agents (Codex, Gemini, Cursor) in parallel.

## Status

- [x] Phase 1: Core MCP Server
- [x] Phase 1.5: Context Management (summarization)
- [ ] Phase 2: Test with Claude Code (restart session)
- [ ] Phase 3: Publish to PyPI

## Architecture

```
Claude Code (Orchestrator)
    │ MCP Tools
    ▼
agent-spawner (MCP Server)
    │ spawn_agent / read_agent_output / list_agents / stop_agent
    ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Codex  │ │ Gemini │ │ Cursor │ │ Claude │
└────────┘ └────────┘ └────────┘ └────────┘
```

## CLI Commands

| CLI | Command | JSON Flag |
|-----|---------|-----------|
| Codex | `codex exec "prompt" --full-auto --json` | `--json` |
| Gemini | `gemini -p "prompt" --output-format stream-json` | `--output-format stream-json` |
| Cursor | `cursor-agent -p --output-format stream-json "prompt"` | `--output-format stream-json` |

## MCP Tools

| Tool | Description |
|------|-------------|
| `spawn_agent(type, prompt, cwd)` | Start agent, returns `agent_id` |
| `read_agent_output(id, format, detail_level)` | Get summary/delta/events |
| `list_agents()` | Show all running/completed |
| `stop_agent(id)` | Kill running agent |

## Test Results

**Task:** "Read README.md and summarize in 10 words"

| Agent | Tool Used | Duration | Answer |
|-------|-----------|----------|--------|
| Gemini | `read_file` | 6s | "VS Code extension: manage AI agent terminals, custom agents, and settings." |
| Codex | `cat README.md` | 12s | "VS Code extension configuring built-in and custom AI agent terminals." |

**Parallel test:** Gemini + Codex ran simultaneously ✓

## Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agent-spawner": {
      "command": "uv",
      "args": ["run", "--directory", "/Users/muqsit/src/github.com/muqsitnawaz/CursorAgents/cli", "agent-spawner"]
    }
  }
}
```

## Project Structure

```
CursorAgents/
├── ext/                      # VS Code extension
├── cli/                      # MCP agent spawner
│   ├── src/agent_spawner/
│   │   ├── server.py         # MCP server + tools
│   │   ├── agents.py         # Process manager
│   │   ├── parsers.py        # JSON normalizers
│   │   └── summarizer.py     # Rule-based summarization
│   └── pyproject.toml
└── AGENTS.md
```

## TODO

- [ ] Restart Claude Code session and test MCP tools live
- [ ] Test with complex multi-file task
- [ ] Publish to PyPI as `uvx agent-spawner`
