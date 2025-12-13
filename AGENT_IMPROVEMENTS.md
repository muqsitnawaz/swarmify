# Multi-Agent Orchestration: Analysis & Improvements

## Executive Summary

Your plan is solid, but **context overflow is a real risk** with multiple streaming agents. This document addresses your questions and proposes solutions.

## 1. Context Overflow Analysis

### The Problem

**Yes, Claude's context WILL overflow** if you stream all events directly:

- **3 agents** × **100 events each** × **~500 tokens/event** = **~150K tokens**
- Plus orchestration overhead, codebase context, conversation history
- Claude's context window: **200K tokens** (Claude 3.5 Sonnet) or **1M tokens** (Claude 3.5 Opus)

**Risk Level**: HIGH for long-running tasks with verbose agents

### When It Happens

- Long-running agents (5+ minutes)
- Verbose agents (Gemini, Cursor with detailed thinking)
- Multiple parallel agents (3+)
- Complex tasks generating many tool calls

## 2. Existing Solutions Comparison

### What Already Exists

| Solution | Strengths | Gaps for Your Use Case |
|----------|-----------|------------------------|
| **LangGraph** | State management, agent coordination | No streaming-aware context management |
| **AutoGen** | Agent-to-agent communication | Not optimized for coding agents |
| **CrewAI** | Role-based delegation | No built-in summarization |
| **Claude Code Subagents** | Native orchestration | Limited control over individual agents |

**Key Gap**: None handle **streaming JSON events with context-aware summarization** for coding agents.

## 3. Recommended Solutions

### Solution A: Hierarchical Summarization (RECOMMENDED)

**How it works**:
1. **Per-agent incremental summaries**: Summarize events in batches (every 10-20 events)
2. **Critical event filtering**: Only send important events (file changes, errors, completion)
3. **Structured summaries**: Return structured data instead of raw events

**Implementation**:
```python
async def read_agent_output(
    agent_id: str,
    since_event: int = 0,
    format: Literal["events", "summary", "delta"] = "summary",  # NEW
    detail_level: Literal["brief", "standard", "detailed"] = "standard",  # NEW
) -> dict:
    """
    Returns:
        {
            "agent_id": "uuid",
            "status": "running",
            "format": "summary",  # or "events" for raw
            "summary": {
                "since_event": 0,
                "event_count": 42,
                "critical_events": [...],  # File changes, errors only
                "progress": "Implementing auth middleware...",
                "files_modified": ["src/auth.ts"],
                "tools_used": ["file_write"],
                "has_errors": False
            },
            "events": [...],  # Only if format="events"
        }
    """
```

**Benefits**:
- Reduces token usage by **80-90%**
- Claude gets structured, actionable information
- Can still request full events when needed

### Solution B: Smart Tailing with Event Priority

**Event Classification**:
```python
class EventPriority:
    CRITICAL = 1  # File changes, errors, completion
    IMPORTANT = 2  # Tool calls, progress updates
    VERBOSE = 3   # Thinking steps, intermediate states

# Filter events by priority
def filter_events(events, max_priority=EventPriority.IMPORTANT):
    return [e for e in events if e.priority <= max_priority]
```

**Usage**:
- Default: Return CRITICAL + IMPORTANT events
- On-demand: Request VERBOSE events for debugging
- Automatic: Upgrade VERBOSE to IMPORTANT if errors detected

### Solution C: LLM-Powered Summarization Tool

**New Tool**: `summarize_agent_output`

```python
async def summarize_agent_output(
    agent_id: str,
    since_event: int = 0,
    detail_level: Literal["brief", "standard", "detailed"] = "standard",
    focus: Literal["all", "changes", "errors", "progress"] = "all",
) -> dict:
    """
    Uses lightweight LLM (or Claude itself) to summarize agent output.
    
    Returns:
        {
            "agent_id": "uuid",
            "summary": "Agent completed implementation of auth middleware...",
            "structured": {
                "files_modified": [...],
                "tools_used": [...],
                "errors": [...],
                "progress_percentage": 85
            },
            "token_savings": "87%",  # vs raw events
        }
    """
```

**When to use**:
- Long-running agents (>2 minutes)
- Verbose output (>50 events)
- Multiple agents running simultaneously

**Cost consideration**: 
- Use Claude's built-in summarization (free in context)
- Or lightweight model (GPT-3.5-turbo, ~$0.001 per summary)

## 4. Improved Architecture

### Enhanced MCP Tools

#### 1. Enhanced `read_agent_output`

```python
async def read_agent_output(
    agent_id: str,
    since_event: int = 0,
    format: Literal["events", "summary", "delta"] = "summary",
    detail_level: Literal["brief", "standard", "detailed"] = "standard",
    event_priority: Literal["critical", "important", "all"] = "important",
) -> dict:
    """
    Smart output reading with multiple format options.
    
    - "events": Raw JSON events (for debugging)
    - "summary": Structured summary (default, token-efficient)
    - "delta": Only what changed since last read
    
    detail_level controls summary verbosity:
    - "brief": ~50 tokens (status + key changes)
    - "standard": ~200 tokens (status + changes + progress)
    - "detailed": ~500 tokens (full context)
    """
```

#### 2. New Tool: `get_agent_summary`

```python
async def get_agent_summary(
    agent_id: str,
    use_llm: bool = False,  # Use LLM for summarization
    focus: Literal["all", "changes", "errors", "progress"] = "all",
) -> dict:
    """
    Get intelligent summary of agent's entire output.
    Uses LLM summarization if use_llm=True, otherwise rule-based.
    """
```

#### 3. New Tool: `watch_agents` (Future)

```python
async def watch_agents(
    agent_ids: list[str],
    callback_on: Literal["critical", "completion", "error"] = "critical",
) -> dict:
    """
    Subscribe to agent updates, only notify on important events.
    Reduces polling overhead.
    """
```

### Internal Architecture Changes

```
┌─────────────────────────────────────────────────────────────┐
│                 agent-spawner (MCP Server)                  │
│                                                             │
│  Tools:                                                     │
│    spawn_agent()                                            │
│    read_agent_output(format="summary")  ← Enhanced         │
│    get_agent_summary()  ← New                              │
│    list_agents()                                            │
│    stop_agent()                                             │
│                                                             │
│  Internal Components:                                       │
│    AgentProcess manager                                     │
│    EventBuffer (raw JSON events)                           │
│    EventSummarizer  ← NEW: Incremental summarization       │
│    EventFilter (priority-based)  ← NEW                     │
│    LLMSummarizer (optional)  ← NEW                         │
└─────────────────────────────────────────────────────────────┘
```

## 5. Implementation Strategy

### Phase 1.5: Context Management (Add before Phase 2)

**Priority: HIGH** - Prevents context overflow

- [ ] Implement event priority classification
- [ ] Add `format` parameter to `read_agent_output`
- [ ] Implement rule-based summarization (no LLM needed)
- [ ] Add `detail_level` support
- [ ] Test with 3+ parallel agents

**Rule-based summarization** (simple, no LLM):
```python
def summarize_events(events: list[dict]) -> dict:
    """Extract structured info from events without LLM."""
    return {
        "files_modified": extract_file_changes(events),
        "tools_used": extract_tools(events),
        "errors": extract_errors(events),
        "progress": extract_progress(events),
        "status": determine_status(events),
    }
```

### Phase 2.5: LLM Summarization (Optional Enhancement)

- [ ] Add `get_agent_summary` tool with LLM option
- [ ] Implement incremental summarization (summarize batches)
- [ ] Add cost tracking
- [ ] Make it opt-in (default: rule-based)

## 6. Usage Patterns

### Pattern 1: Efficient Monitoring (Default)

```python
# Claude checks progress efficiently
agents = list_agents()
for agent in agents["agents"]:
    output = read_agent_output(
        agent["agent_id"],
        format="summary",  # Token-efficient
        detail_level="standard"
    )
    # Gets ~200 tokens per agent instead of 5000+
```

### Pattern 2: Deep Dive When Needed

```python
# When agent completes or errors, get full details
output = read_agent_output(
    agent_id,
    format="events",  # Full events
    event_priority="all"
)
```

### Pattern 3: LLM Summarization for Long Tasks

```python
# For very long-running agents
summary = get_agent_summary(
    agent_id,
    use_llm=True,
    focus="changes"  # Focus on what changed
)
```

## 7. Token Usage Estimates

### Without Summarization
- 3 agents × 100 events × 500 tokens = **150K tokens**
- Risk: Context overflow

### With Rule-Based Summarization
- 3 agents × 200 tokens (summary) = **600 tokens**
- Savings: **99.6%**
- Safe: Well within context limits

### With LLM Summarization
- 3 agents × 300 tokens (LLM summary) = **900 tokens**
- Plus LLM API cost: ~$0.001 per summary
- Savings: **99.4%**

## 8. Recommendations

### Immediate (Phase 1.5)

1. **Add `format` parameter** to `read_agent_output` (default: "summary")
2. **Implement rule-based summarization** (no LLM needed)
3. **Add event priority filtering** (critical/important/verbose)
4. **Test with 3+ parallel agents** to validate token savings

### Short-term (Phase 2)

1. **Add `get_agent_summary` tool** with optional LLM
2. **Implement incremental summarization** (summarize in batches)
3. **Add cost tracking** for LLM summarization

### Long-term (Phase 4+)

1. **Smart tailing**: Only send deltas, not full history
2. **Event compression**: Store old events compressed, summarize on-demand
3. **Predictive summarization**: Summarize proactively before context fills

## 9. Answering Your Questions

### Q: Will Claude be able to keep track of updates from all agents?

**A: Yes, IF you implement summarization.** Without it, context will overflow with 3+ agents. With rule-based summarization, Claude can easily track 10+ agents.

### Q: Will context overflow?

**A: Yes, without summarization.** With summarization, you can handle 10+ agents comfortably.

### Q: Should we implement smart tailing?

**A: Yes, but start simple:**
1. **Phase 1**: Event priority filtering (critical/important/verbose)
2. **Phase 2**: Delta summaries (only what changed)
3. **Phase 3**: Full smart tailing with compression

### Q: Should we use an LLM to summarize?

**A: Optional, but recommended for long tasks:**
- **Start with rule-based** (no cost, fast)
- **Add LLM summarization** as opt-in enhancement
- **Use for**: Very long tasks (>5 min), complex outputs, user requests

## 10. Next Steps

1. **Update `read_agent_output`** signature to include `format` and `detail_level`
2. **Implement rule-based summarization** in `parsers.py`
3. **Add event priority classification** to event parsing
4. **Test with multiple parallel agents** to measure token savings
5. **Document usage patterns** for Claude to follow

## Conclusion

Your architecture is sound, but **context management is critical**. Implement summarization early (Phase 1.5) to prevent context overflow. Start with rule-based summarization (simple, free), then add LLM summarization as an optional enhancement.

The key insight: **Don't send raw events to Claude. Send structured summaries.**
