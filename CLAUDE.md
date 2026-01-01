## Agents MCP Server

### Building

After making changes to `agents-mcp/`, rebuild and restart Claude Code:
```bash
./agents-mcp/scripts/build.sh
```

### API

- `mcp__Swarm__spawn` - Spawn agents (codex, cursor, gemini, claude)
- `mcp__Swarm__status` - Check agent status
- `mcp__Swarm__stop` - Stop agents

### Mode Parameter (IMPORTANT)

When spawning agents that need to write files, pass `mode: 'edit'`:
- `mode: 'edit'` - Agent CAN modify files
- `mode: 'plan'` - Agent is READ-ONLY (default)

Do NOT use `'yolo'` or `'safe'` - those are invalid.

Do NOT use built-in Claude Code agents (Task tool with Explore/Plan subagent_type) when Swarm agents are requested.

## Critical Architecture

### Terminals in Editor Area (NOT Panel Terminals)

This extension creates **terminals in the editor area**, not panel terminals. This is VS Code's official terminology.

```typescript
// TerminalLocation enum (from VS Code API)
TerminalLocation.Panel = 1   // Bottom terminal panel
TerminalLocation.Editor = 2  // Editor area (as tabs)

// This extension ALWAYS uses TerminalEditorLocationOptions:
vscode.window.createTerminal({
  location: { viewColumn: vscode.ViewColumn.Active },  // Editor area
  name: 'CC',
});
```

**What gets created:**

- `vscode.Terminal` - the terminal instance
- `vscode.Tab` with `input: TabInputTerminal` - the visual tab

**Keybinding contexts:**

- `terminalFocus` - Any terminal (panel OR editor area)
- `terminalEditorFocus` - Only terminals in editor area

This extension uses `terminalEditorFocus` exclusively. Using `terminalFocus` will NOT work.

**API behavior:**

- `vscode.window.activeTerminal` - Works for both locations
- `vscode.window.terminals` - Lists all terminals regardless of location

---

## Limitations

### VS Code Tab API

The Tab API (`vscode.window.tabGroups`) is mostly readonly for positioning:

**Supported:**

- Get tab position: `group.tabs.indexOf(tab)` or `findIndex()`
- Read pinned state: `tab.isPinned`
- Close tabs: `vscode.window.tabGroups.close(tab)`
- Pin/unpin via commands: `workbench.action.pinEditor`, `workbench.action.unpinEditor`

**Not Supported:**

- Insert tab at specific index
- Insert at end/beginning programmatically
- Insert relative to active tab
- Reorder existing tabs
- Set position when opening via `showTextDocument()` (only `ViewColumn` for editor group, not position within group)

User setting `workbench.editor.openPositioning` controls default behavior but cannot be overridden per-open.

### Agent Spawner (MCP)

Agents run as detached processes (`start_new_session=True`) with file-based output. They survive MCP server restarts. See AGENTS.md for architecture.

## Design Principles

### Short Tab Names, Rich Context Elsewhere

Editor tabs show minimal prefixes (CC, CX, GX, CR) to maximize tab bar space. Users can set descriptive labels that appear in the status bar with expanded names (e.g., "Claude: auth feature"). The tab title never changes when labels are set.

### User Labels for Agent Tabs

Users can label any agent terminal to track what task it's working on. Labels are stored in memory and shown in the status bar, not the tab title. This keeps tabs scannable while providing context when needed.

**Status bar format:**
- No label: `Agents: Claude`
- With label: `Agents: Claude - {label}`

Note the ` - ` separator between agent name and label.

### Terminal Quick Pick (`Cmd+Shift+S`)

`agents.goToTerminal` shows a quick pick menu for navigating between agent terminals:

- **Tab order**: Uses `vscode.window.tabGroups.all` to get terminals in visual tab bar order
- **Matching tabs to terminals**: Correlates `tab.label` with `terminal.name`
- **Format**: `1. Claude`, `2. Codex` (numbered + expanded name), label in description
- **Filtering**: `matchOnDescription: true` enables fuzzy search on both agent name and label
- **Context**: `terminalEditorFocus` (no conflict with `agents.swarmDocument` which uses `activeCustomEditorId == 'agents.markdownEditor'`)

### Strict Agent Identification

Agent terminals are identified by exact prefix match (CC, CX, etc.) or the pattern "PREFIX - label". Loose matching (checking if name contains "claude") is avoided to prevent false positives. This ensures commands like Reload only affect actual agent terminals.

### Shared Utilities (`agents-ext/src/utils.ts`)

All pure logic lives in `utils.ts` for consistent behavior across commands:

- **Testability** - Pure functions tested with `bun test` without VS Code dependencies
- **Consistency** - Single source of truth for parsing, validation, and mapping
- **Maintainability** - Changes propagate to all commands automatically

VS Code API interactions stay in `extension.ts`. Run `bun test` in `agents-ext/` to verify behavior.