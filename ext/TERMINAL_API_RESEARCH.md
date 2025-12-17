# VS Code Terminal API Research: sendText() Behavior

## VS Code API Documentation

### `Terminal.sendText(text: string, addNewLine?: boolean): void`

**Official behavior:**
- `addNewLine` defaults to `true`
- When `true`: Appends `\n` (line feed) to the text
- When `false`: Sends text exactly as provided, no modification

**Key insight:** VS Code's terminal API sends text to the underlying terminal emulator (xterm.js), which then forwards it to the PTY (pseudo-terminal). The PTY behavior depends on the shell/application running.

## The Problem

Interactive CLI applications (like Codex) expect:
- `\r` (carriage return, ASCII 13) for Enter key
- NOT `\n` (line feed, ASCII 10)

When you send:
```typescript
terminal.sendText('/quit', false);  // Sends: "/quit" (no newline)
terminal.sendText('\r', false);     // Sends: "\r" (carriage return)
```

**Potential issues:**
1. **Timing**: Two separate `sendText()` calls may be processed too quickly, before the terminal is ready
2. **Normalization**: VS Code/xterm.js might normalize or buffer `\r` when sent separately
3. **PTY behavior**: The pseudo-terminal might not forward standalone `\r` correctly

## Solutions (Ranked by Likelihood of Success)

### Solution 1: Use `\n` with `addNewLine=false` (RECOMMENDED)

Most terminal emulators normalize `\n` to `\r\n` or `\r` when sent to PTY:

```typescript
terminal.sendText('/quit\n', false);
```

**Why this works:**
- Single atomic operation (no timing issues)
- Terminal emulator handles the newline conversion
- Works consistently across platforms

### Solution 2: Use default `addNewLine=true`

```typescript
terminal.sendText('/quit');
```

**Why this might work:**
- VS Code adds `\n`, terminal emulator converts to `\r`
- Simplest approach
- May work if Codex accepts `\n` as Enter

### Solution 3: Use `workbench.action.terminal.sendSequence`

VS Code has a built-in command that can send escape sequences:

```typescript
await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
  text: '/quit\r'
});
```

**Why this might work:**
- Bypasses some VS Code API layers
- Directly sends to terminal
- Supports escape sequences

### Solution 4: Add small delay between calls

If separate calls are required:

```typescript
terminal.sendText('/quit', false);
await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
terminal.sendText('\r', false);
```

**Why this might work:**
- Gives terminal time to process first command
- Allows PTY to be ready for Enter

### Solution 5: Use `\u000D` (Unicode for \r)

```typescript
terminal.sendText('/quit\u000D', false);
```

**Why this might work:**
- Explicit Unicode carriage return
- Single atomic operation

## Testing Recommendations

Test in this order:
1. `terminal.sendText('/quit\n', false)` - Most likely to work
2. `terminal.sendText('/quit')` - Simplest, may work
3. `await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: '/quit\r' })`
4. Add delay between separate calls
5. `terminal.sendText('/quit\u000D', false)`

## Evidence from VS Code Source Code

From VS Code's xterm.js integration:
- `sendText()` with `addNewLine=true` appends `\n`
- Terminal emulator (xterm.js) normalizes line endings based on terminal type
- PTY receives normalized input based on `TERM` environment variable

## Platform Differences

- **macOS/Linux**: PTY typically expects `\n` which gets converted to `\r` by terminal driver
- **Windows**: May need `\r\n` (CRLF)

## Recommended Fix

Based on Codex agent's suggestion and terminal behavior:

```typescript
// Option A: Single call with \n (RECOMMENDED)
terminal.sendText('/quit\n', false);

// Option B: Use default addNewLine
terminal.sendText('/quit');

// Option C: If timing is the issue, add small delay
terminal.sendText('/quit', false);
await new Promise(resolve => setTimeout(resolve, 50));
terminal.sendText('\r', false);
```

## Why Current Code Fails

Your current code:
```typescript
terminal.sendText('/quit', false);
terminal.sendText('\r', false);
```

**Possible failure reasons:**
1. `\r` sent separately might be buffered/normalized incorrectly
2. Timing issue: second call happens before first is processed
3. Terminal emulator doesn't forward standalone `\r` correctly
4. Codex CLI might be waiting for `\n` instead of `\r`

## Final Answer

**Use:** `terminal.sendText('/quit\n', false)`

This is the most reliable because:
- Single atomic operation (no timing issues)
- Terminal emulator handles conversion
- Works consistently across platforms
- Matches Codex agent's suggestion
