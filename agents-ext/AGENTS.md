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

## Dashboard Tabs

Overview | Swarm | Prompts | Guide

- Overview: Running agents (clickable), Recent Tasks, Shortcuts
- Swarm: Integration status, agent toggles, Open on Startup, Tasks list
- Prompts: Saved prompts with favorites
- Guide: Quick start steps

## Swarm Integration

MCP server for multi-agent orchestration. Configure per agent (Claude, Codex, Gemini) in Dashboard > Swarm. Tasks fetched from `swarm.vscode.ts`.
