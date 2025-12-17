# Terminal Tracking API Design

## Overview

Track ALL terminals in the editor area. Single source of truth. No redundant data structures.

## Core Type

```typescript
interface TrackedTerminal {
  // Identity
  id: string;                        // Unique ID (format: "prefix-timestamp-counter")
  terminal: vscode.Terminal;         // VS Code terminal instance

  // Agent binding (null for non-agent terminals like plain shells)
  agentConfig: AgentConfig | null;

  // User customization
  label?: string;                    // Shows in status bar

  // Metadata
  createdAt: number;                 // Unix timestamp
}
```

## Registry

```typescript
// Single source of truth - keyed by ID
const registry = new Map<string, TrackedTerminal>();

// Reverse lookup index for O(1) terminal -> ID resolution
// WeakMap allows garbage collection when terminal is disposed
const terminalToId = new WeakMap<vscode.Terminal, string>();
```

## Helper Functions

```typescript
// Register a terminal (called when creating or discovering terminals)
function trackTerminal(
  terminal: vscode.Terminal,
  agentConfig: AgentConfig | null
): TrackedTerminal;

// Remove terminal from registry (called on close)
function untrackTerminal(terminal: vscode.Terminal): void;

// Lookups
function getByTerminal(terminal: vscode.Terminal): TrackedTerminal | undefined;
function getById(id: string): TrackedTerminal | undefined;

// Mutations
function setLabel(terminal: vscode.Terminal, label: string | undefined): void;

// Iteration
function getAllTracked(): TrackedTerminal[];
function getAgentTerminals(): TrackedTerminal[];  // Where agentConfig !== null
```

## Lifecycle

### On Activation

1. Create registry
2. Scan all editor area terminals via `vscode.window.tabGroups`
3. For each `TabInputTerminal`, match to `vscode.window.terminals` by name
4. Call `trackTerminal()` for each, inferring `agentConfig` from name parsing

### On Terminal Create (by extension)

1. Create terminal via `vscode.window.createTerminal()`
2. Immediately call `trackTerminal(terminal, agentConfig)`

### On Terminal Close

1. Listen to `vscode.window.onDidCloseTerminal`
2. Call `untrackTerminal(terminal)`

### On Deactivate

1. Optionally dispose managed terminals
2. Clear registry

## ID Generation

```typescript
function generateTerminalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`;
}
```

For non-agent terminals, use prefix `term`.

## What Gets Deleted

These redundant structures are replaced by the registry:

| Old | Replacement |
|-----|-------------|
| `managedTerminals: Terminal[]` | `registry.values()` |
| `terminalMap: Map<string, Terminal>` | `registry` (keyed by ID) |
| `terminalMetadataByInstance: Map<Terminal, Metadata>` | `terminalToId` + `registry` |
| `terminalMetadataById: Map<string, Metadata>` | `registry` |
| `TerminalState` in globalState | Deleted (was never read) |

## Usage Examples

```typescript
// Creating an agent terminal
const terminal = vscode.window.createTerminal({ ... });
const tracked = trackTerminal(terminal, claudeConfig);
terminal.sendText(claudeConfig.command);

// Setting label
setLabel(terminal, "auth feature");

// Status bar update
const tracked = getByTerminal(vscode.window.activeTerminal);
if (tracked?.agentConfig) {
  statusBar.text = `${tracked.agentConfig.title}${tracked.label ? ` - ${tracked.label}` : ''}`;
}

// Reload command
const tracked = getByTerminal(activeTerminal);
if (tracked?.agentConfig) {
  terminal.sendText('/quit', false);
  terminal.sendText('\r', false);
  // wait...
  terminal.sendText(tracked.agentConfig.command, false);
  terminal.sendText('\r', false);
}

// URI focus handler
const tracked = getById(terminalId);
if (tracked) {
  tracked.terminal.show();
}
```

## File Location

All tracking code lives in `ext/src/extension.ts`. Pure utility functions (name parsing, label sanitization) remain in `ext/src/utils.ts`.
