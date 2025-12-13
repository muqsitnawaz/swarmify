# Multi-Agent Orchestration System

## Goal

Build an orchestrator that allows Claude Code to spawn and coordinate multiple AI coding agents (Codex, Gemini, Cursor) in parallel, read their streaming outputs, and aggregate results.

## Why This Architecture

### Why Claude as the Orchestrator?

1. **Already an excellent reasoning engine** - Claude can analyze tasks, break them down, and decide which agent is best suited for each subtask
2. **Native tool use** - Claude already knows how to use MCP tools effectively
3. **No reinvention** - We don't need to build task routing logic; Claude does this naturally
4. **Conversational** - Users interact with Claude, who delegates to specialist agents

### Why MCP Over Custom Agent SDK?

| Approach | Pros | Cons |
|----------|------|------|
| **MCP Server** | Lightweight, native Claude Code support, easy distribution via uvx | Simpler tool interface |
| **Custom Agent SDK** | Full control over orchestration | Complex setup, separate runtime, reinvents what Claude already does |

**Decision: MCP** - It's the simplest path. Claude becomes the brain, MCP tools become its hands.

### Why Async with Polling?

The agents output streaming JSON events. We need to:
1. Run multiple agents in parallel (not block on one)
2. Let Claude check progress and read partial outputs
3. Handle long-running tasks without timeouts

**Blocking approach won't work** - If Codex takes 2 minutes and Gemini takes 30 seconds, we can't wait for Codex before seeing Gemini's result.

### Why Context Management Matters

Without summarization, 3 agents streaming ~100 events each can produce ~150K tokens. This risks Claude's context overflow.

**Solution:** Rule-based summarization by default (~99% token reduction), optional LLM summarization for complex tasks.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code (Orchestrator)              │
│                                                             │
│  "Implement auth feature" → Analyzes task → Decides:        │
│    - Codex: implement login endpoint                        │
│    - Gemini: write tests                                    │
│    - Cursor: update types                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │ MCP Tool Calls
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                 agent-spawner (MCP Server)                  │
│                                                             │
│  Tools:                                                     │
│    spawn_agent(type, prompt, cwd) → agent_id                │
│    read_agent_output(agent_id, format, detail_level)        │
│    list_agents() → all running agents                       │
│    stop_agent(agent_id) → kill process                      │
│                                                             │
│  Internal:                                                  │
│    AgentProcess manager (async subprocess handling)         │
│    Event buffer per agent (parsed JSON stream)              │
│    Summarizer (rule-based, optional LLM)                    │
└─────────────────┬───────────────────────────────────────────┘
                  │ Subprocess (stdin/stdout)
                  ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Codex   │  │  Gemini  │  │  Cursor  │  │  Claude  │
│   CLI    │  │   CLI    │  │  Agent   │  │   Code   │
│          │  │          │  │   CLI    │  │   CLI    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

## CLI Commands Reference

| CLI | Command | JSON Output |
|-----|---------|-------------|
| Codex | `codex exec "prompt" --full-auto --json` | JSONL: thread.started, item.completed, turn.completed |
| Cursor | `cursor-agent -p --output-format stream-json "prompt"` | NDJSON: init, thinking, assistant, result |
| Gemini | `gemini -p "prompt" --output-format stream-json` | JSONL: init, message, result |

## MCP Tools Design

### `spawn_agent`

```python
async def spawn_agent(
    agent_type: Literal["codex", "gemini", "cursor", "claude"],
    prompt: str,
    cwd: str | None = None,  # Working directory, defaults to current
) -> dict:
    """
    Spawn an agent process asynchronously.

    Returns:
        {
            "agent_id": "uuid",
            "agent_type": "codex",
            "status": "running",
            "started_at": "ISO timestamp"
        }
    """
```

### `read_agent_output`

```python
async def read_agent_output(
    agent_id: str,
    format: Literal["summary", "delta", "events"] = "summary",
    detail_level: Literal["brief", "standard", "detailed"] = "standard",
    since_event: int = 0,
) -> dict:
    """
    Read output from a running or completed agent.

    Formats:
        - summary: Compressed overview (default, ~99% token reduction)
        - delta: Only changes since last read
        - events: Raw events (for debugging)

    Detail levels:
        - brief: Status + files only (~50 tokens)
        - standard: Status + files + tools + message (~200 tokens)
        - detailed: Standard + errors + warnings (~500 tokens)
    """
```

**Response for `format="summary"` (default):**
```json
{
    "agent_id": "uuid",
    "agent_type": "codex",
    "status": "running | completed | failed",
    "duration_ms": 12340,
    "files_modified": ["src/auth.ts", "src/types.ts"],
    "files_created": ["src/middleware/jwt.ts"],
    "files_deleted": [],
    "tools_used": ["file_write", "bash", "file_read"],
    "tool_call_count": 12,
    "errors": [],
    "warnings": [],
    "final_message": "Implemented JWT auth middleware",
    "progress": "85%",
    "token_estimate": 847
}
```

**Response for `format="delta"`:**
```json
{
    "agent_id": "uuid",
    "status": "running",
    "since_event": 42,
    "new_events_count": 8,
    "new_files_modified": ["src/auth.ts"],
    "new_tool_calls": ["bash: npm test"],
    "latest_message": "Running tests...",
    "progress": "85%"
}
```

**Response for `format="events"`:**
```json
{
    "agent_id": "uuid",
    "status": "running",
    "events": [...],  // Raw events since since_event
    "event_count": 50
}
```

### `list_agents`

```python
async def list_agents() -> dict:
    """
    List all agents (running and completed).

    Returns:
        {
            "agents": [
                {
                    "agent_id": "...",
                    "type": "codex",
                    "status": "running",
                    "started_at": "...",
                    "progress": "45%"
                },
                {
                    "agent_id": "...",
                    "type": "gemini",
                    "status": "completed",
                    "started_at": "...",
                    "duration_ms": 8420
                }
            ],
            "running_count": 1,
            "completed_count": 1
        }
    """
```

### `stop_agent`

```python
async def stop_agent(agent_id: str) -> dict:
    """
    Stop a running agent.

    Returns:
        {"agent_id": "uuid", "status": "stopped"}
    """
```

## Context Management Strategy

### Event Priority Classification

```python
PRIORITY = {
    "critical": [
        "error",
        "result",
        "file_write",
        "file_delete",
        "file_create"
    ],
    "important": [
        "tool_use",
        "thinking.complete",
        "bash.execute",
        "warning"
    ],
    "verbose": [
        "thinking.delta",
        "message.delta",
        "thread.started",
        "turn.started"
    ]
}
```

### Rule-Based Summarization (Default)

Extract structured data from events without LLM:

```python
def summarize_events(events: list[dict]) -> dict:
    summary = {
        "files_modified": set(),
        "files_created": set(),
        "tools_used": set(),
        "errors": [],
        "final_message": None
    }

    for event in events:
        if event["type"] == "file_write":
            summary["files_modified"].add(event["path"])
        elif event["type"] == "tool_use":
            summary["tools_used"].add(event["tool"])
        elif event["type"] == "error":
            summary["errors"].append(event["message"])
        elif event["type"] in ("result", "message.complete"):
            summary["final_message"] = event.get("content", "")

    return summary
```

**Token savings:** ~99% reduction (50K raw events → 200 token summary)

### Optional LLM Summarization

For complex/long tasks, use fast LLM (Haiku/GPT-4o-mini):

```python
async def llm_summarize(events: list[dict], context: str) -> str:
    """Use for tasks >5 minutes or when user requests detailed explanation."""
    prompt = f"""
    Summarize this coding agent's work in 2-3 sentences:
    - What task was completed?
    - What approach did it take?
    - Any issues encountered?

    Context: {context}
    Events (last 50): {events[-50:]}
    """
    return await fast_llm.complete(prompt)
```

## Project Structure

```
CursorAgents/
├── ext/                      # VS Code extension (existing)
│   ├── src/extension.ts
│   ├── package.json
│   └── ...
├── cli/                      # MCP agent spawner (new)
│   ├── src/
│   │   └── agent_spawner/
│   │       ├── __init__.py
│   │       ├── server.py     # MCP server + tools
│   │       ├── agents.py     # AgentProcess manager
│   │       ├── parsers.py    # JSON output parsers per CLI
│   │       └── summarizer.py # Rule-based + optional LLM summarization
│   └── pyproject.toml
├── AGENTS.md                 # This file
└── README.md
```

## Implementation Phases

### Phase 1: Core MCP Server (MVP)

- [ ] Set up Python project with uv
- [ ] Implement `AgentProcess` class (async subprocess management)
- [ ] Implement `spawn_agent` tool
- [ ] Implement basic `read_agent_output` tool (events only)
- [ ] Implement `list_agents` tool
- [ ] Implement `stop_agent` tool
- [ ] Basic JSON parsing for each CLI format
- [ ] Test with Claude Code locally

### Phase 1.5: Context Management (Critical)

- [ ] Event priority classification
- [ ] Rule-based summarization (extract files, tools, errors)
- [ ] Enhanced `read_agent_output` with `format` parameter
- [ ] `detail_level` support (brief/standard/detailed)
- [ ] Delta tracking (only new changes since last read)
- [ ] Progress estimation

### Phase 2: Enhanced Output Parsing

- [ ] Parse tool calls from each agent's output
- [ ] Extract files modified/created/deleted
- [ ] Extract final message/result
- [ ] Structured summary generation
- [ ] Optional LLM summarization for complex tasks

### Phase 3: Distribution

- [ ] Publish to PyPI for `uvx agent-spawner`
- [ ] Add to Claude Code MCP config documentation
- [ ] Integration tests

### Phase 4: Advanced Features (Future)

- [ ] Agent-to-agent communication (one agent's output as another's input)
- [ ] Result aggregation and conflict detection
- [ ] Cost/token tracking across agents
- [ ] VS Code extension integration (show agent status in UI)

## Usage Example

Once implemented, Claude Code can do:

```
User: "Add user authentication to the API"

Claude: I'll spawn multiple agents to work on this in parallel.

[Calls spawn_agent("codex", "Implement JWT auth middleware in src/middleware/auth.ts")]
→ Returns: {"agent_id": "agent-1", "status": "running"}

[Calls spawn_agent("gemini", "Write tests for auth middleware")]
→ Returns: {"agent_id": "agent-2", "status": "running"}

[Calls spawn_agent("cursor", "Update User type to include auth fields")]
→ Returns: {"agent_id": "agent-3", "status": "running"}

Let me check their progress...

[Calls list_agents()]
→ Returns: {"agents": [...], "running_count": 2, "completed_count": 1}

[Calls read_agent_output("agent-1", format="summary")]
→ Returns: {
    "status": "completed",
    "files_modified": ["src/middleware/auth.ts"],
    "tools_used": ["file_write", "bash"],
    "final_message": "Implemented JWT middleware with refresh token support"
  }

[Calls read_agent_output("agent-2", format="delta")]
→ Returns: {
    "status": "running",
    "progress": "60%",
    "new_files_modified": ["tests/auth.test.ts"],
    "latest_message": "Writing integration tests..."
  }

Codex has finished implementing the middleware. Gemini is 60% done with tests.
The JWT implementation includes refresh token support. Let me wait for tests...
```

## Configuration

MCP server config for Claude Code (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "agent-spawner": {
      "command": "uvx",
      "args": ["agent-spawner"]
    }
  }
}
```

## Token Budget Estimates

| Scenario | Without Summarization | With Summarization |
|----------|----------------------|-------------------|
| 1 agent, simple task | ~5K tokens | ~200 tokens |
| 1 agent, complex task | ~50K tokens | ~500 tokens |
| 3 agents parallel | ~150K tokens | ~600-1500 tokens |
| 5 agents parallel | ~250K tokens | ~1000-2500 tokens |

With summarization, Claude can comfortably orchestrate 5+ agents without context pressure.

## Open Questions

1. **Should we support Claude Code as a sub-agent?** - Yes, but need to handle recursive spawning carefully
2. **How to handle agent failures?** - Return error status + stderr in read_agent_output
3. **Memory management for completed agents?** - Keep last N completed agents, or add explicit cleanup tool
4. **Should agents share context?** - Future: allow passing one agent's output as another's input
5. **LLM for summarization?** - Start without, add as opt-in feature for long tasks
