# Agents Extension

VS Code extension for multi-agent coding. Spawns AI terminals (Claude, Codex, Gemini, Cursor, OpenCode) with keyboard shortcuts.

## Architecture

```
/src/core              Pure functions (no VS Code dependencies)
/src/vscode            VS Code integration (commands, webviews)
/src/vscode/ui/.tmp   Webview state files
/ui/settings            Dashboard webview (React + Vite)
/ui/editor             Custom markdown editor components
/assets                 Icons
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
| Prompts | `~/.swarmify/agents/prompts.yaml` |
| Swarm config | `~/.agents/config.json` |
| Workspace config | `.swarmify/config.yaml` (workspace root) |
| Claude sessions | `~/.claude/projects/{workspace}/*.jsonl` |
| Codex sessions | `~/.codex/sessions/{year}/{month}/{day}/*.jsonl` |
| Gemini sessions | `~/.gemini/sessions/*.jsonl` |

## Gotchas

- **Webview reload**: Set `retainContextWhenHidden: true` or panel reloads on focus loss.
- **Terminal tracking**: `countRunning()` scans all VS Code terminals by name. Internal map (`editorTerminals`) may be stale after restart - scan `vscode.window.terminals` directly when needed.
- **Agent ID formats**: UI uses `claude`, AgentConfig uses `Claude`, terminal names use `CL`. Map between them carefully.
- **Prefix constants**: CL=Claude, CX=Codex, GX=Gemini, OC=OpenCode, CR=Cursor, SH=Shell (in `utils.ts`).
- **Tmux socket pinning**: Each tmux session uses a dedicated socket (`/tmp/agents-tmux-{session}.sock`) to ensure `terminal.sendText()` and `execAsync()` talk to the same server. Split operations use `execAsync()` directly to bypass terminal input (avoids Claude capturing keystrokes).
- **Autogit AI key**: Requires `openaiApiKey` in settings for AI-generated commit messages. Without it, only basic diff is shown.
- **Autogit controls**: `disableAutopush` skips git push after commit. `disableAutocommit` only stages changes and generates message, doesn't commit.
- **Claude pre-warm exit**: Claude requires special exit sequence (Esc + Ctrl+C + Ctrl+C) to cleanly terminate session.
- **Session pooling**: Prewarming maintains available sessions in pool for instant hand-off. Sessions expire after timeout.

## Terminal Titles

Terminal tab titles are constructed from prefix + sessionChunk + label. User preferences control display:

| Setting | Effect |
|---------|--------|
| `showFullAgentNames` | `CL` vs `Claude` |
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
- `AGENT_TERMINAL_ID`: Internal tracking ID (`CL-1705123456789-1`)
- `AGENT_SESSION_ID`: CLI session UUID (`4a78949e-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- `sessionChunk`: First 8 chars of sessionId, shown in tab title

**Session restoration**: `scanExisting()` extracts both env vars at startup to restore session tracking for terminals that survived VS Code restart.

## Keybindings

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+G | Autogit (stage, generate commit, commit, push) |
| Cmd+Shift+A | New Agent |
| Cmd+Shift+B | New Secondary Agent |
| Cmd+Shift+L | Label terminal |
| Cmd+Shift+C | Clear terminal |
| Cmd+Shift+N | New Task |
| Cmd+Shift+S | New Shell (SH) |
| Cmd+Shift+I | Open Agent |
| Cmd+Shift+H | Horizontal split (tmux mode) |
| Cmd+Shift+V | Vertical split (tmux mode) |
| Cmd+Shift+' | Open Prompts |
| Cmd+Shift+X | New Codex (CX) |
| Cmd+Shift+M | New Gemini (GX) |
| Cmd+Shift+U | New Cursor (CR) |
| Cmd+Shift+D | Dashboard |

## Autogit

Git integration for automated commits. Stages changes, generates commit message via AI, commits, and pushes.

**Files:** `src/core/git.ts`, `src/vscode/git.vscode.ts`

**Features:**
- Stage all changed files
- Generate commit message using AI (OpenAI API or OpenRouter)
- Commit with generated message
- Push to remote (optional via `disableAutopush`)

**Configuration:**
- `agents.commitMessageExamples`: Array of example commit messages to guide AI style
- `agents.ignoreFiles`: Comma-separated patterns to ignore in diffs (default: node_modules,dist,build,out,.git,*.lock,bun.lock,package-lock.json)
- `agents.openaiApiKey`: API key for commit message generation
- `agents.disableAutopush`: Skip push after commit (default: false)
- `agents.disableAutocommit`: Only stage and generate message, don't commit (default: false)

**Command:** `agents.autogit` (Ctrl+Shift+G / Cmd+Shift+G)

**Implementation:**
- Parses git diff output for changed files
- Sends diff to AI model with system prompt based on commitMessageExamples
- Stages files, commits with message, pushes unless disabled
- Uses `shouldIgnoreFile()` to filter ignored patterns

## Prewarming

Session pre-warming for instant agent startup. Maintains pool of ready-to-use agent sessions.

**Files:** `src/core/prewarm.ts`, `src/core/prewarm.simple.ts`, `src/vscode/prewarm.vscode.ts`

**Supported Agents:** Claude, Codex, Gemini, Cursor

**Commands:** `agents.enableWarming`, `agents.disableWarming`

**Architecture:**
- Background processes maintain available sessions per agent type
- Session pool tracks available vs pending creation
- Terminal-to-session mapping for crash recovery
- Each agent has specific pre-warm config (command, status command, session ID pattern, exit sequence, resume command)

**Pre-warm configurations:**
- **Claude**: Uses `/status` command, requires Esc+Ctrl+C+Ctrl+C exit sequence, resumes via `claude -r {sessionId}`
- **Codex**: Standard session management
- **Gemini**: Standard session management
- **Cursor**: Standard session management

**Session types:**
- `PrewarmedSession`: Ready-to-handoff session with agentType, sessionId, createdAt, workingDirectory
- `SessionPoolState`: Pool with available sessions and pending count
- `TerminalSessionMapping`: Terminal-to-session mapping for recovery

## Tasks System

Unified task management from multiple sources. Aggregates tasks into single interface.

**Files:** `src/core/tasks.ts`, `src/vscode/tasks.vscode.ts`

**Command:** `agents.newTask` (Ctrl+Shift+N / Cmd+Shift+N)

**Sources:**
- **Markdown**: Tasks from .md files (checkboxes, TODO comments)
- **Linear**: Issues fetched via MCP client
- **GitHub**: Issues fetched via MCP client

**Task interface:**
```typescript
{
  id: string;              // Unique identifier
  source: 'markdown' | 'linear' | 'github';
  title: string;           // Task title
  description?: string;     // Optional description
  status: 'todo' | 'in_progress' | 'done';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  metadata: {
    file?: string;         // For markdown: file path
    line?: number;         // For markdown: line number
    identifier?: string;   // For Linear/GitHub: PROJ-123 or #42
    url?: string;         // Web URL
    labels?: string[];     // Labels/tags
    assignee?: string;     // Assigned user
    state?: string;        // Raw state from source
  }
}
```

**Source badges:**
- MD (Markdown): Indigo (#6366f1)
- LN (Linear): Purple (#5e6ad2)
- GH (GitHub): Green (#238636)

**Functions:**
- `markdownToUnifiedTask()`: Convert markdown todo to UnifiedTask
- `linearToUnifiedTask()`: Convert Linear issue to UnifiedTask (maps priority 1-4 to urgent-low)
- `githubToUnifiedTask()`: Convert GitHub issue to UnifiedTask
- `groupTasksBySource()`: Group by source for organized display
- `filterTasksByStatus()`: Filter by todo/in_progress/done

## Custom Markdown Editor

Custom editor for .md files with agent-specific features.

**Files:** `src/vscode/customEditor.ts`

**Registration:** `agents.markdownEditor` viewType, handles `*.md` files (priority: default)

**Features:**
- Agent-specific markdown parsing
- Integrated with extension commands
- Custom rendering for TODO lists

## Notifications

Notification system for agent events.

**Files:** `src/vscode/notifications.vscode.ts`

**Command:** `agents.enableNotifications`

## Setup Commands

Install and configure agent CLIs.

**Commands:**
- `agents.setupClaude`: Setup Claude CLI
- `agents.setupCodex`: Setup Codex CLI
- `agents.setupGemini`: Setup Gemini CLI

**Implementation:** Each command guides through installation via npm/pnpm/yarn and configures CLI for use with extension.

## View Controls

Toggle visibility of agent-related views.

**Commands:**
- `agents.enableView`: Enable agent view
- `agents.disableView`: Disable agent view

## Dashboard Tabs

### Overview
- Running agents (clickable to focus terminal)
- Recent Tasks from all sources (markdown, Linear, GitHub)
- Keyboard shortcuts reference

### Swarm
- Integration status per agent (CLI available, MCP enabled, Command installed)
- Agent toggles (enable/disable for spawning)
- Open on Startup option
- Tasks list from agents-mcp server

### Prompts
- Saved prompts with favorites
- Quick access to slash commands

### Guide
- Quick start steps for new users

## Swarm Integration

MCP server integration for multi-agent orchestration. Connects to `@swarmify/agents-mcp` server.

**Files:** `src/vscode/swarm.vscode.ts`, `src/core/swarm.detect.ts`

**Configuration:**
- Per-agent toggles in Dashboard > Swarm
- Open on Startup preference
- Auto-discovery of installed agent CLIs
- MCP client status checking

**Detection:**
- Checks CLI availability: `claude`, `codex`, `gemini`, `cursor-agent`, `opencode`
- Checks MCP integration status: `isAgentMcpEnabled(agentType)`
- Checks swarm command installation: `isAgentCommandInstalled(agentType, 'swarm')`

**Integration:**
- Uses @modelcontextprotocol/sdk for MCP client
- Fetches tasks from agents-mcp server
- Displays task status in Dashboard

## Testing

```bash
bun run compile    # Build everything
bun test           # Run all tests
```

**Test files** (no mocks, real services only):
- `tests/agents.test.ts` - Agent configuration and spawning
- `tests/git.test.ts` - Git integration and commit generation
- `tests/sessions.activity.test.ts` - Session file parsing
- `tests/terminals.test.ts` - Terminal tracking and management
- `tests/prewarm.test.ts` - Session pre-warming
- `tests/settings.test.ts` - Settings storage and retrieval

**Test fixtures:** `src/core/testdata/` directory

## Session Activity Parsing

Live activity extraction from agent session files. Shows what the agent is currently doing in Dashboard terminal cards (e.g., "Reading auth.ts", "Running npm test").

**Architecture** (`src/core/session.activity.ts`):
- Reads tail of session JSONL files (last 32-64KB)
- Parses from end to find most recent tool activity
- Agent-specific parsers handle different event formats
- Maps raw events to unified activity types

**Activity types**: `reading`, `editing`, `running`, `thinking`, `waiting`, `completed`

**Agent formats** (critical - each agent logs differently):

| Agent | Tool Call Event | Tool Name Field | Args Field |
|-------|-----------------|-----------------|------------|
| Claude | `type: "assistant"` with `message.content[].type: "tool_use"` | `name` (Read, Edit, Bash, etc.) | `input` object |
| Codex | `type: "response_item"` with `payload.type: "function_call"` | `payload.name` (shell_command, etc.) | `payload.arguments` (JSON string!) |
| Gemini | `type: "tool_call"` | `tool_name` | `parameters` object |
| Cursor | Similar to Gemini, uses stream-json format | `tool_name` | `parameters` object |

**Codex gotcha**: Arguments are a JSON STRING, not an object. Must `JSON.parse(payload.arguments)` to extract command/path.

**Session file locations**:
- Claude: `~/.claude/projects/{workspace}/*.jsonl`
- Codex: `~/.codex/sessions/{year}/{month}/{day}/*.jsonl`
- Gemini: `~/.gemini/sessions/*.jsonl`

**Implementation details**:
- `getSessionPreviewInfo()`: Reads tail of session file and parses for recent activity
- `getSessionPathBySessionId()`: Locates session file by searching known directories
- File size filtering (minimum 5KB) to skip empty sessions
- Sort by modification time to find most recent

**Testing**: E2E tests in `tests/sessions.activity.test.ts` use real session files. Filter by 5KB minimum size and sort by mtime to find substantial recent sessions.
