# Editor Terminal State

All terminals in the editor area exist in a single Map. This is the state.

## Type

```typescript
interface EditorTerminal {
  id: string;                        // "prefix-timestamp-counter"
  terminal: vscode.Terminal;
  agentConfig: AgentConfig | null;   // null for non-agent terminals
  label?: string;
  createdAt: number;
}
```

## State

```typescript
const editorTerminals = new Map<string, EditorTerminal>();
const terminalToId = new WeakMap<vscode.Terminal, string>();
let terminalIdCounter = 0;
```

## Functions

```typescript
function getByTerminal(t: vscode.Terminal): EditorTerminal | undefined {
  const id = terminalToId.get(t);
  return id ? editorTerminals.get(id) : undefined;
}

function getById(id: string): EditorTerminal | undefined {
  return editorTerminals.get(id);
}

function setLabel(t: vscode.Terminal, label: string | undefined): void {
  const entry = getByTerminal(t);
  if (entry) entry.label = label;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++terminalIdCounter}`;
}

function inferAgentConfig(name: string): AgentConfig | null {
  const parsed = parseTerminalName(name);
  if (!parsed) return null;
  return builtInAgents.find(a => a.prefix === parsed.prefix) ?? null;
}
```

## Lifecycle

**Create:**
```typescript
const terminal = vscode.window.createTerminal({ ... });
const id = generateId(agentConfig?.prefix ?? 'term');
editorTerminals.set(id, { id, terminal, agentConfig, createdAt: Date.now() });
terminalToId.set(terminal, id);
```

**Close:**
```typescript
vscode.window.onDidCloseTerminal((terminal) => {
  const id = terminalToId.get(terminal);
  if (id) editorTerminals.delete(id);
});
```

**Scan (on activation):**
```typescript
function scanExistingEditorTerminals() {
  const byName = new Map<string, vscode.Terminal>();
  for (const t of vscode.window.terminals) byName.set(t.name, t);

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputTerminal)) continue;
      const terminal = byName.get(tab.label);
      if (!terminal || terminalToId.has(terminal)) continue;

      const agentConfig = inferAgentConfig(tab.label);
      const id = generateId(agentConfig?.prefix ?? 'term');
      editorTerminals.set(id, { id, terminal, agentConfig, createdAt: Date.now() });
      terminalToId.set(terminal, id);
    }
  }
}
```

## Usage

```typescript
// Status bar
const entry = getByTerminal(vscode.window.activeTerminal);
if (entry?.agentConfig) {
  statusBar.text = entry.label
    ? `${entry.agentConfig.title} - ${entry.label}`
    : entry.agentConfig.title;
}

// Reload agent
const entry = getByTerminal(terminal);
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
