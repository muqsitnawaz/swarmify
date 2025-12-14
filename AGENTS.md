# Multi-Agent Orchestration System

MCP server that lets Claude Code spawn and coordinate multiple AI coding agents (Codex, Gemini, Cursor, Claude) in parallel.

## Status

- [x] Phase 1: Core MCP Server
- [x] Phase 2: Persistent Architecture (agents survive MCP restarts)
- [ ] Phase 3: Publish to PyPI

## Architecture

```
Claude Code (Orchestrator)
    │
    │ MCP Protocol (stdio)
    ▼
agent-spawner (MCP Server)
    │
    │ Detached subprocesses + file-based output
    ▼
┌─────────────────────────────────────────────────────┐
│  ~/.claude/agent-spawner/agents/                    │
│  ├── {agent_id}/                                    │
│  │   ├── meta.json     (PID, status, timestamps)   │
│  │   └── stdout.log    (JSON streaming output)     │
│  └── ...                                            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Codex  │ │ Gemini │ │ Cursor │ │ Claude │
└────────┘ └────────┘ └────────┘ └────────┘
```

## Key Design: Persistent Spawning

Agents run as **detached processes** (`start_new_session=True`) that:
- Survive MCP server disconnects/restarts
- Write output to files (not pipes)
- Store metadata on disk for recovery
- Can be monitored across Claude Code sessions

## MCP Tools

| Tool | Description |
|------|-------------|
| `spawn_agent(type, prompt, cwd)` | Start detached agent, returns `agent_id` |
| `read_agent_output(id, format, detail_level)` | Get summary/delta/events from file |
| `list_agents()` | List all agents (restored from disk on restart) |
| `stop_agent(id)` | Kill agent by PID |

### Output Formats

| Format | Use Case |
|--------|----------|
| `summary` | Token-efficient overview (files modified, errors, final message) |
| `delta` | Incremental updates since last read |
| `events` | Raw JSON events from agent |

### Detail Levels (for summary)

| Level | Tokens | Contents |
|-------|--------|----------|
| `brief` | ~50 | files_modified, has_errors |
| `standard` | ~200 | + tools_used, errors, final_message |
| `detailed` | ~500 | + bash_commands, all files, warnings |

## Configuration

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "agent-spawner": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/cli", "agent-spawner"]
    }
  }
}
```

## Supported Agents

| Agent | Command |
|-------|---------|
| Codex | `codex exec "{prompt}" --full-auto --json` |
| Gemini | `gemini -p "{prompt}" --output-format stream-json` |
| Cursor | `cursor-agent -p --output-format stream-json "{prompt}"` |
| Claude | `claude -p "{prompt}" --output-format stream-json` |

## Project Structure

```
cli/
├── src/agent_spawner/
│   ├── server.py      # MCP server + tool handlers
│   ├── agents.py      # Persistent process manager
│   ├── parsers.py     # Normalize CLI output formats
│   └── summarizer.py  # Rule-based event summarization
├── tests/
└── pyproject.toml
```

## TODO

- [ ] Test with complex multi-file task
- [ ] Publish to PyPI as `uvx agent-spawner`
