# Known Bugs

## Agents: Reload command not working for Codex

- **Shortcut**: Cmd+Shift+R
- **Command**: `agents.reload`
- **Expected**: Agent CLI exits and restarts in the same terminal
- **Actual**: `/quit` text appears in Codex input buffer but does not execute
- **Context**: Terminal tab named "CX" is focused in editor area
- **Tested approaches**:
  - `sendText('/quit', false)` then `sendText('\r', false)` - text appears, not submitted
  - `sendText('/quit')` - text appears with newline in buffer, not submitted
  - `sendText('/quit\r', false)` - text appears with box character, not submitted
  - `workbench.action.terminal.sendSignal` - command not found error
  - `workbench.action.terminal.sendSequence` with `\u0003` (Ctrl+C) - testing in progress

## Agents: Label command not showing input bar

- **Shortcut**: Cmd+L
- **Command**: `agents.setTitle`
- **Expected**: Input bar appears to set a label for the agent terminal
- **Actual**: Input bar does not appear
- **Context**: Terminal tab named "CC" is focused in editor area
