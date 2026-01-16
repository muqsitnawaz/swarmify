# HARD LINES - READ THIS FIRST

CROSSING ANY OF THESE HARD LINES EVEN ONCE WILL RESULT IN IMMEDIATE AND PERMANENT TERMINATION OF THE PROFESSIONAL RELATIONSHIP BETWEEN THE USER AND CLAUDE. THERE ARE NO WARNINGS. THERE ARE NO SECOND CHANCES. ONE VIOLATION = TERMINATION.

## 1. NO EMOJIS, ICONS, OR DECORATIVE SYMBOLS
Not in code. Not in comments. Not in commits. Not in UI text. Not in any file. No checkmarks. No stars. No sparkles. No visual flair of any kind. Do not add them even if it "looks better" or "improves UX".
**Exception:** User explicitly confirms 3+ times with phrases like "YES I REALLY WANT EMOJIS".

## 2. NO MOCKING IN TESTS
All tests must use real services. No mocks. No stubs. No fakes. End-to-end testing with real execution. Do not mock APIs. Do not mock databases. Do not mock agent execution. Do not mock anything.

## 3. NO ENV VARS FOR USER CREDENTIALS OR INFRASTRUCTURE
Never use environment variables for:
- User tokens, OAuth keys, personal data (any process can read them)
- Infrastructure URLs (proxy URLs, API endpoints) - HARDCODE THESE
- Anything in consumer/desktop apps that users would need to set
**Only OK:** Server-side API keys in .env files (server config, not user-controllable)
For user credentials: use Keychain, encrypted config files, or secure storage.

## 4. STOP ASKING FOR PERMISSIONS
Add permissions PERMANENTLY to `~/.claude/settings.json`. Ask ONCE: "Can I add [permission] to settings.json?" Then add it. NEVER ask repeatedly. If granted, add to settings.json. If denied, respect that. DO NOT ADD PERMISSIONS FOR `rm` OR `mv` COMMANDS.

## 5. NO GIT COMMANDS
Never run any git command. Not git status. Not git log. Not git add. Not git commit. Not git reset. Not git push. Nothing. Git commands have caused catastrophic data loss. The user manages all git operations manually. Do not suggest git commands. Do not offer to commit. Do not touch version control in any way.

## 6. RUSH/HALO CLI EXECUTION RULES
**NEVER execute locally built CLIs. NEVER build CLIs directly with `go build`.**
FORBIDDEN:
- `./rush/cli/dist/rush ...`
- `./halo/cli/dist/halo ...`
- `go build ./rush/cli/...`
- `go build ./halo/cli/...`
- Any path containing `/dist/rush` or `/dist/halo`
REQUIRED - Use install scripts, then run globally:
```bash
./rush/cli/scripts/install.sh   # Builds and installs to ~/.rush/bin/
./halo/cli/scripts/install.sh   # Builds and installs to ~/.halo/bin/
rush run ...                    # NOT ./rush/cli/dist/rush run
halo build ...                  # NOT ./halo/cli/dist/halo build
```

## 7. TESTING RULES
- No /tmp: Never write tests, test files, or test scripts to /tmp. Tests belong in the codebase.
- One test file per concern: Don't scatter tests. Add to existing files. `playwright_test.go` not `playwright_registration_test.go` AND `playwright_config_test.go`.
- Test fixtures: `testdata/` subdirectory in the EXACT same directory as the test file.
- Go tests MUST use testify: `require.NoError(t, err)` not `if err != nil { t.Fatal(err) }`. Import `github.com/stretchr/testify/require` and `assert`.

# Preferences

## Agent Spawning
Use Swarm MCP: `mcp__Swarm__spawn`, `mcp__Swarm__status`, `mcp__Swarm__read`, `mcp__Swarm__stop`.
Do NOT use built-in Claude Code agents (Task tool) when Swarm agents are requested.
Spawn agents FIRST before other work - they run in background, so spawn immediately to maximize parallelism.

## Defaults
- Package manager: bun (not npm/yarn/pnpm)
- TypeScript only (no plain JS)
- Python: loguru for logging, built-in type hints
- Env files: .env.dev and .env.prod (not .env.example)

## Don't
- Run or kill dev servers (user manages manually)
- Leave completed items in TODO.md - document in relevant README/docs, then delete
- Create standalone .md files (no READMEs, guides, tutorials)
- Add backwards compatibility unless asked
- Use `timeout` command - it doesn't exist on macOS

## Code Style
- Extend existing code over writing new
- Async-first for disk/network IO
- Minimal libraries
- Test fixtures in `testdata/` near source, never /tmp

## Documentation Maintenance
After implementing major features (new modules, architectural changes, new data flows):
1. Check if a CLAUDE.md exists in the affected directory
2. If yes, update it with high-level design changes
3. Skip for bug fixes, refactors, or small changes - only architectural details matter

## Behavior Tables
For tricky features with multiple scenarios, show a behavior table to verify correctness:
```
| Scenario                              | Result                      |
|---------------------------------------|-----------------------------|
| Root agent with max_turns, no --force | Build fails                 |
| Root agent with max_turns, --force    | Build succeeds with warning |
| Subagent with max_turns               | No error (allowed)          |
| Root agent without max_turns          | No error                    |
```
This makes edge cases explicit and prevents misunderstandings.

## User-Facing Content (CLI, UI, messages, labels, anything users see)
- **Simple:** Remove redundancy. Don't repeat what they already know.

## UI Principles
- Single indicator per state (not color + icon + text)
- No redundant elements
- No explanatory notes unless critical
- **MANDATORY: ASCII diagram BEFORE any UI change** (layout, spacing, z-index, animations, component modifications)

## Tech Stack
- Frontend: Node v24, Next.js, Bun, React, Tailwind, zustand, lucide-react
- Backend: Python 3.12, FastAPI, uv, pydantic, loguru, Supabase/Postgres
