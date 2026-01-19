# Agents Extension

VS Code extension for multi-agent coding. Spawns AI terminals (Claude, Codex, Gemini, Cursor, OpenCode) with keyboard shortcuts.

## Architecture

```
/src               Extension backend (TypeScript)
/ui/settings       Dashboard webview (React + Vite)
/assets            Icons
```

## Commands

```bash
bun run compile    # Build everything
bun test           # 166 tests, no mocks
```

## Key Paths

| Item | Location |
|------|----------|
| Settings | VS Code globalState |
| Prompts | `~/.swarmify/agents/prompts.json` |
| Swarm config | `~/.swarmify/agents/config.json` |

## Gotchas

- **Webview reload**: Set `retainContextWhenHidden: true` or panel reloads on focus loss.
- **Terminal tracking**: `countRunning()` scans all VS Code terminals by name. Internal map (`editorTerminals`) may be stale after restart - scan `vscode.window.terminals` directly when needed.
- **Agent ID formats**: UI uses `claude`, AgentConfig uses `Claude`, terminal names use `CC`. Map between them carefully.
- **Prefix constants**: CC=Claude, CX=Codex, GX=Gemini, OC=OpenCode, CR=Cursor, SH=Shell (in `utils.ts`).
- **Tmux socket pinning**: Each tmux session uses a dedicated socket (`/tmp/agents-tmux-{session}.sock`) to ensure `terminal.sendText()` and `execAsync()` talk to the same server. Split operations use `execAsync()` directly to bypass terminal input (avoids Claude capturing keystrokes).

## Terminal Titles

Terminal tab titles are constructed from prefix + sessionChunk + label. User preferences control display:

| Setting | Effect |
|---------|--------|
| `showFullAgentNames` | `CC` vs `Claude` |
| `showSessionIdInTitles` | Include first 8 chars of session UUID |
| `showLabelsInTitles` | Include user-set label |
| `labelReplacesTitle` | Label replaces full title vs appends with dash |

**Label behavior:**

| showLabelsInTitles | labelReplacesTitle | Session | Label | Result |
|--------------------|-------------------|---------|-------|--------|
| false | any | any | any | `Claude` or `Claude 12345678` |
| true | false (default) | no | yes | `Claude - auth feature` |
| true | false (default) | yes | yes | `Claude 12345678 - auth feature` |
| true | true | no | yes | `auth feature` |
| true | true | yes | yes | `Claude 12345678 - auth feature` |

**Key identifiers** (stored in terminal env vars):
- `AGENT_TERMINAL_ID`: Internal tracking ID (`CC-1705123456789-1`)
- `AGENT_SESSION_ID`: CLI session UUID (`4a78949e-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- `sessionChunk`: First 8 chars of sessionId, shown in tab title

**Session restoration**: `scanExisting()` extracts both env vars at startup to restore session tracking for terminals that survived VS Code restart.

## Dashboard Tabs

Overview | Swarm | Prompts | Guide

- Overview: Running agents (clickable), Recent Tasks, Shortcuts
- Swarm: Integration status, agent toggles, Open on Startup, Tasks list
- Prompts: Saved prompts with favorites
- Guide: Quick start steps

## Tmux Mode

Optional tmux integration for per-tab pane splits. Enable via `Agents: Enable Tmux` command.

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+H | Horizontal split (new pane below) |
| Cmd+Shift+V | Vertical split (new pane right) |

**Implementation** (`tmux.ts`):
- Each terminal gets a unique tmux socket: `/tmp/agents-tmux-{timestamp}.sock`
- Initial session created via `terminal.sendText()` with chained commands
- Splits use `execAsync()` to run `tmux -S {socket} split-window` directly (bypasses terminal input)
- Cleanup removes socket file on terminal close

## Swarm Integration

MCP server for multi-agent orchestration. Configure per agent (Claude, Codex, Gemini) in Dashboard > Swarm. Tasks fetched from `swarm.vscode.ts`.

## Session Activity Parsing

Live activity extraction from agent session files. Shows what the agent is currently doing in Dashboard terminal cards (e.g., "Reading auth.ts", "Running npm test").

**Architecture** (`src/core/session.activity.ts`):
- Reads tail of session JSONL files (last 32-64KB)
- Parses from end to find most recent tool activity
- Agent-specific parsers handle different event formats

**Activity types**: `reading`, `editing`, `running`, `thinking`, `waiting`, `completed`

**Agent formats** (critical - each agent logs differently):

| Agent | Tool Call Event | Tool Name Field | Args Field |
|-------|-----------------|-----------------|------------|
| Claude | `type: "assistant"` with `message.content[].type: "tool_use"` | `name` (Read, Edit, Bash, etc.) | `input` object |
| Codex | `type: "response_item"` with `payload.type: "function_call"` | `payload.name` (shell_command, etc.) | `payload.arguments` (JSON string!) |
| Gemini | `type: "tool_call"` | `tool_name` | `parameters` object |

**Codex gotcha**: Arguments are a JSON STRING, not an object. Must `JSON.parse(payload.arguments)` to extract command/path.

**Session file locations**:
- Claude: `~/.claude/projects/{workspace}/*.jsonl`
- Codex: `~/.codex/sessions/{year}/{month}/{day}/*.jsonl`
- Gemini: `~/.gemini/sessions/*.jsonl`

**Testing**: E2E tests in `tests/sessions.activity.test.ts` use real session files. Filter by 5KB minimum size and sort by mtime to find substantial recent sessions.
