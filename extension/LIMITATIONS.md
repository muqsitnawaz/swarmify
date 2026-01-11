# Limitations

## Auto-Labeling Agent Terminals

### Problem

When running multiple Claude Code sessions in the same working directory, there is no reliable way to automatically label terminals with their session context (e.g., "fixing auth bug", "implementing dark mode").

### Technical Details

**What we have access to:**
- Terminal PID (from VS Code `terminal.processId`)
- Claude process PID (child of terminal shell)
- Session files at `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- Session summaries inside those files (`type: "summary"` entries)

**What we cannot do:**
- Read terminal stdout (VS Code Terminal API limitation)
- Map Claude process to session file (Claude doesn't keep file handles open)
- Get session ID from Claude process (not in command args or accessible env vars)
- Correlate by timestamp reliably (race conditions with 10+ concurrent sessions)

### Investigated Approaches

| Approach | Why It Fails |
|----------|--------------|
| `lsof` on Claude PID | Session files aren't kept open |
| Parse command line args | Session ID not passed as argument |
| Read `/proc/<pid>/environ` | Not available on macOS |
| Timestamp correlation | Unreliable with many concurrent sessions in same cwd |
| Debug log parsing | Only tracks one "latest" session, not per-process |

### Possible Future Solutions

1. **Wrapper script**: Run Claude through a wrapper that generates a correlation ID and writes it to a known location. Adds complexity and changes user workflow.

2. **Claude Code feature request**: Ask Anthropic to add `--session-id-file <path>` flag that writes the session ID to a specified file on startup.

3. **PTY interception**: Create a custom PTY that intercepts Claude output. High complexity, potential compatibility issues.

### Current Workaround

Users can manually label terminals using `Cmd+L` (Set Title command). Labels are persisted across VS Code restarts and shown in the status bar.
