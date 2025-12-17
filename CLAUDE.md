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

### Strict Agent Identification

Agent terminals are identified by exact prefix match (CC, CX, etc.) or the pattern "PREFIX - label". Loose matching (checking if name contains "claude") is avoided to prevent false positives. This ensures commands like Reload only affect actual agent terminals.

### Shared Utilities (`ext/src/utils.ts`)

All pure logic lives in `utils.ts` for consistent behavior across commands:

- **Testability** - Pure functions tested with `bun test` without VS Code dependencies
- **Consistency** - Single source of truth for parsing, validation, and mapping
- **Maintainability** - Changes propagate to all commands automatically

VS Code API interactions stay in `extension.ts`. Run `bun test` in `ext/` to verify behavior.
