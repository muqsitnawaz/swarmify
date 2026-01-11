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
