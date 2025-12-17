# Editor Terminal State API

## Overview

All terminals in the editor area exist in a single Map. This is the state - not "tracking", just the truth of what exists.

## Core Type

```typescript
interface EditorTerminal {
  id: string;                        // Unique ID (format: "prefix-timestamp-counter")
  terminal: vscode.Terminal;         // VS Code terminal instance
  agentConfig: AgentConfig | null;   // null for non-agent terminals (plain shells)
  label?: string;                    // User-set label, shows in status bar
  createdAt: number;                 // Unix timestamp
}
```

## State

```typescript
// THE state of editor terminals. Single source of truth.
const editorTerminals = new Map<string, EditorTerminal>();

// Reverse lookup for O(1) terminal -> id
const terminalToId = new WeakMap<vscode.Terminal, string>();

// ID counter
let terminalIdCounter = 0;
```

## Functions

```typescript
// Lookups
function getByTerminal(terminal: vscode.Terminal): EditorTerminal | undefined;
function getById(id: string): EditorTerminal | undefined;

// Mutations
function setLabel(terminal: vscode.Terminal, label: string | undefined): void;

// Helpers
function generateId(prefix: string): string;
function inferAgentConfig(name: string, extensionPath: string): AgentConfig | null;
```

## Sync

### On Activation

`scanExistingEditorTerminals()` already exists. Change it to:
- Register ALL editor terminals (remove agent-only filter)
- Infer `agentConfig` from terminal name (null if not recognized)

```typescript
function scanExistingEditorTerminals(extensionPath: string) {
  const terminalsByName = new Map<string, vscode.Terminal>();
  for (const terminal of vscode.window.terminals) {
    terminalsByName.set(terminal.name, terminal);
  }

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputTerminal)) continue;

      const terminal = terminalsByName.get(tab.label);
      if (!terminal || terminalToId.has(terminal)) continue;

      const id = generateId(tab.label);
      const agentConfig = inferAgentConfig(tab.label, extensionPath);

      editorTerminals.set(id, {
        id,
        terminal,
        agentConfig,
        createdAt: Date.now()
      });
      terminalToId.set(terminal, id);
    }
  }
}
```

### On Terminal Create

When we create a terminal, add to state immediately:

```typescript
const terminal = vscode.window.createTerminal({ ... });
const id = generateId(agentConfig.prefix);

editorTerminals.set(id, {
  id,
  terminal,
  agentConfig,
  createdAt: Date.now()
});
terminalToId.set(terminal, id);

terminal.sendText(agentConfig.command);
```

### On Terminal Close

```typescript
vscode.window.onDidCloseTerminal((terminal) => {
  const id = terminalToId.get(terminal);
  if (id) {
    editorTerminals.delete(id);
  }
});
```

## What Gets Deleted

| Old Structure | Replacement |
|---------------|-------------|
| `managedTerminals: Terminal[]` | `editorTerminals.values()` |
| `terminalMap: Map<string, Terminal>` | `editorTerminals` |
| `terminalMetadataByInstance` | `terminalToId` + `editorTerminals` |
| `terminalMetadataById` | `editorTerminals` |
| `TerminalMetadata` interface | `EditorTerminal` |
| `TerminalState` interface | Delete (never read) |

## Usage

```typescript
// Status bar
const entry = getByTerminal(vscode.window.activeTerminal);
if (entry?.agentConfig) {
  statusBar.text = `${entry.agentConfig.title}${entry.label ? ` - ${entry.label}` : ''}`;
}

// Reload
const entry = getByTerminal(activeTerminal);
if (entry?.agentConfig) {
  terminal.sendText('/quit\n', false);
  await sleep(2500);
  terminal.sendText(entry.agentConfig.command + '\n', false);
}

// URI focus
const entry = getById(terminalId);
if (entry) entry.terminal.show();

// Set label
setLabel(terminal, "auth feature");
```
