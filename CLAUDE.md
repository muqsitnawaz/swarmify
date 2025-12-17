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
