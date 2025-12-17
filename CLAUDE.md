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

## Architecture

### Shared Utilities (`ext/src/utils.ts`)

All pure logic functions must live in `utils.ts` to ensure consistent behavior across commands. This separation provides:

1. **Testability** - Pure functions can be tested with `bun test` without VS Code dependencies
2. **Consistency** - Single source of truth for agent identification, label handling, etc.
3. **Maintainability** - Changes propagate to all commands automatically

**What goes in utils.ts:**
- Constants: `CLAUDE_TITLE`, `CODEX_TITLE`, `GEMINI_TITLE`, `CURSOR_TITLE`, `KNOWN_PREFIXES`
- Pure parsers: `parseTerminalName()` - strict prefix matching for agent identification
- Sanitizers: `sanitizeLabel()` - user input cleaning with word limits
- Mappers: `getExpandedAgentName()`, `getIconFilename()`

**What stays in extension.ts:**
- VS Code API interactions (terminals, status bar, commands)
- Functions that need `vscode.*` imports
- Command handlers and activation logic

**Pattern for new features:**
```typescript
// utils.ts - pure logic, testable
export function parseTerminalName(name: string): ParsedTerminalName { ... }

// extension.ts - VS Code integration
function identifyAgentTerminal(terminal: vscode.Terminal, extensionPath: string) {
  const parsed = parseTerminalName(terminal.name);  // use shared util
  // ... VS Code-specific logic
}
```

**Testing:** Run `bun test` in `ext/` directory. Tests live alongside source as `*.test.ts`.
