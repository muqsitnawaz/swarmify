# AI Agent Command Ecosystem

This repository contains version-controlled configurations for Claude Code, Codex, and Gemini AI agents.

## Command Categories

### Core Commands
Single-agent commands that perform fundamental engineering tasks:

| Command | Purpose | Available In |
|---------|---------|--------------|
| `/debug` | Root cause analysis with systematic investigation | Claude, Codex, Gemini |
| `/plan` | Feature design and architecture planning | Claude, Codex, Gemini |
| `/clean` | Technical debt removal and code consolidation | Claude, Codex, Gemini |
| `/test` | Critical path testing with comprehensive coverage | Claude, Codex, Gemini |
| `/ship` | Pre-launch verification across security/perf/QA | Claude, Codex, Gemini |

### Swarm-Verified Commands
Multi-agent commands that spawn independent agents for verification:

| Command | Purpose | Base Command |
|---------|---------|-------------|
| `/sdebug` | Debug with independent confirmation | /debug |
| `/splan` | Planning with swarm consensus | /plan |
| `/sclean` | Cleanup with parallel investigation | /clean |
| `/stest` | Testing with area-focused agents | /test |
| `/sship` | Shipping with independent swarm assessment | /ship |
| `/sconfirm` | Lightweight verification without re-investigation | — |

## Command Descriptions

### `/debug` - Root Cause Analysis
Systematically identifies the root cause of an issue, not just where it appears.

**Output**:
- Bug description and context
- Root cause with diagram
- Fixes (sorted by scope)
- Test plan

**Usage**: `/debug "app crashes on startup"`

### `/sdebug` - Debug with Swarm
Spawns 2-3 independent agents to verify diagnosis.

**Approach**:
1. Share context and symptoms (no conclusions)
2. Agents independently identify root cause
3. Compare findings, synthesize conclusion
4. Report agreement and divergence

**Usage**: `/sdebug "auth fails on refresh"` → codex and gemini independently investigate

### `/plan` - Feature Planning
Designs implementation approach with step-by-step plan.

**Output**:
- High-level architecture
- Step-by-step implementation
- Critical files to modify
- Testing strategy

**Usage**: `/plan "add dark mode to dashboard"`

### `/splan` - Plan with Swarm Consensus
Compares multiple agents' planning approaches for completeness.

**Usage**: `/splan "refactor authentication system"` → identify gaps and alternatives

### `/clean` - Technical Debt Cleanup
Removes outdated code, consolidates duplicates, unifies scattered concerns.

**Priority Order**:
1. Outdated code (docs mismatch)
2. Near-duplicates (consolidate)
3. Scattered truth (unify config)
4. Complex patterns (simplify)
5. Dead code (remove)
6. Naming (clarify)

**Usage**: `/clean "clean up obsolete auth methods"`

### `/sclean` - Cleanup with Swarm
Parallel agents investigate different areas, then synthesis identifies cross-cutting concerns.

**Usage**: `/sclean` → identifies duplicates spanning areas, scattered configs, inconsistent patterns

### `/test` - Critical Path Testing
Focuses on user-impacting test coverage (what breaks trust, looks unprofessional).

**Areas**:
- Auth and permissions
- Data persistence
- API contracts
- UI/UX flows
- Error handling

**Usage**: `/test "test session persistence after token refresh"`

### `/stest` - Testing with Area Agents
Spawns agents focused on different areas (auth, data, API, UI, errors).

**Usage**: `/stest` → parallel agents test critical paths by area, then integration tests

### `/ship` - Pre-Launch Verification
Comprehensive readiness assessment across security, performance, and QA.

**Process**:
1. App understanding (learn frameworks, critical paths)
2. Spawn specialized swarms:
   - Security swarm (framework-aware vulnerability scanning)
   - Performance swarm (bottleneck identification)
   - QA swarm (critical path testing)
3. Verify against documentation (don't trust docs blindly)

**Output**:
- Critical blockers
- High priority issues
- Security/perf/QA findings
- Documentation discrepancies
- Go/No-Go recommendation

**Usage**: `/ship @rush/app` → pre-launch checklist

### `/sship` - Ship with Independent Assessment
2-3 agents independently assess readiness, compare findings.

**Usage**: `/sship @rush/app` → multiple agents confirm readiness independently

### `/sconfirm` - Lightweight Verification
Share findings and context, ask agents to independently verify without re-investigation.

**Usage**: `/sconfirm` → verify suspected issues before major refactor

## Swarm Behavior

Swarm commands follow a consistent pattern:

1. **Main agent** investigates thoroughly
2. **Context extraction** → share learning (not conclusions)
3. **Spawn agents** (1-3 based on scope) with different types (Claude, Codex, Gemini)
4. **Independent investigation** → agents see context but not main agent's findings
5. **Synthesis** → compare findings, note agreement and divergence
6. **Unified recommendation** → based on consensus

## Agent Context Requirements

When spawning sub-agents (via Swarm MCP or otherwise), follow these rules to prevent wasted tokens:

**Core principle: Agents execute, you architect. Never delegate exploration to agents.**

Your exploration feeds their execution. If you don't explore first, agents waste turns re-discovering what you should have told them.

**Required in every agent prompt:**
- Specific file paths WITH line numbers (e.g., `src/auth/token.ts:145-160`)
- Code patterns pasted inline, not referenced
- Concrete examples of expected output/structure
- Clear boundaries (what files they own vs must not touch)

**Examples:**

BAD prompt:
```
"Follow patterns in src/tools/ to implement a new tool"
```

GOOD prompt:
```
"Implement Tool interface in src/tools/search.ts:
- Name() returns 'web_search'
- Schema() returns JSON schema (see src/tools/calculator.ts:25-40 for format)
- Execute() takes SearchInput, returns SearchResult

Pattern from src/tools/calculator.ts:30-85:
[paste actual code snippet]

Expected output structure:
[paste example]"
```

**Why this matters:**
- Bad context = agents spend 5+ turns exploring
- Good context = agents execute in 1-2 turns
- You explore once, agents execute many times

## Proactive Agent Behavior

Agents should act first, then show results for review.

**The pattern: ACT → SHOW → CONTINUE**

When receiving feedback:
```
User: "X is an account, not an agent"
Agent: "Updated to use account language:
[shows updated section]
Implementing now."
```

When finishing exploration:
```
Agent: "Found the issue in TokenRefreshService.
Fix: [brief description]
Making the change."
```

When requirements are clear:
```
Agent: "Approach:
1. Add field to notification type
2. Update component to render it
Starting with step 1."
```

**Avoid:**
- "Do you want me to update the plan?"
- "Should I proceed with implementation?"
- "Let me know if you'd like me to..."

Waiting costs more than course-correcting. Make a decision, state reasoning, act.

## Behavior Tables

For tricky features with multiple scenarios, use a behavior table to verify correctness before implementing:

```
| Scenario                              | Result                      |
|---------------------------------------|-----------------------------|
| Root agent with max_turns, no --force | Build fails                 |
| Root agent with max_turns, --force    | Build succeeds with warning |
| Subagent with max_turns               | No error (allowed)          |
| Root agent without max_turns          | No error                    |
```

This makes edge cases explicit and prevents misunderstandings between you and agents.

## Framework-Aware Scanning

Security and performance scanning adapts to detected frameworks:

**Security focuses**:
- **Electron**: IPC security, preload scripts, nodeIntegration
- **React**: XSS, injection, dangerouslySetInnerHTML
- **Node**: Dependency vulnerabilities, secrets, token storage
- **Go**: Memory safety, crypto handling, auth tokens

**Performance focuses**:
- **React**: Re-renders, memoization, code splitting
- **Electron**: Main process blocking, IPC overhead
- **General**: Bundle size, critical path profiling

## Cross-Cutting Concerns

Swarm commands synthesis identifies patterns spanning multiple areas:

- Duplicates across modules
- Scattered configuration
- Inconsistent patterns
- Shared utilities opportunity

## Setup and Syncing

### Initial Setup
```bash
cd /Users/muqsit/src/github.com/muqsitnawaz/.agents
./scripts/sync.sh push
```

### Making Changes
**Option A**: Edit in repo, apply to system
```bash
cd ~/.agents
# Edit files
./scripts/sync.sh push
# Test changes
git commit -m "Update commands"
```

**Option B**: Edit on system, update repo
```bash
# Edit in ~/.claude/ directly
cd ~/.agents
./scripts/sync.sh pull
git commit -m "Sync system changes"
```

### Checking Status
```bash
cd ~/.agents
./scripts/sync.sh status
```

## Handling Conflicts

Default behavior: Skip files that differ, report conflict
```bash
./scripts/sync.sh push
# Output: ✗ Skipped (conflict): debug.md - use --replace to overwrite
```

Force overwrite with `--replace`:
```bash
./scripts/sync.sh --replace push
```

## MCP Integration

All commands have access to Swarm MCP for multi-agent coordination:
- `mcp__Swarm__spawn` - Launch agents
- `mcp__Swarm__status` - Check progress
- `mcp__Swarm__stop` - Cancel agents

Automatically installed during first sync.

## Documentation Standards

### Command Files (.md for Claude/Codex, .toml for Gemini)

Structure:
```markdown
---
description: Brief description
---

## Goal
What the command achieves

## Process
Step-by-step approach

## Output
Format and content of results
```

### File Format Differences

**Claude** (.claude/commands/*.md):
```markdown
---
description: Description here
---

You are debugging: $ARGUMENTS
```

**Codex** (.codex/prompts/*.md):
```markdown
---
description: Description here
argument-hint: <example input>
---

You are debugging: $ARGUMENTS
```

**Gemini** (.gemini/commands/*.toml):
```toml
name = "debug"
description = "Description here"
prompt = """
You are debugging: {{args}}
"""
```

## For New Machine Setup

```bash
# 1. Clone repo
git clone <github-url> /Users/muqsit/src/github.com/muqsitnawaz/.agents

# 2. Install to system
cd ~/.agents
./scripts/sync.sh push

# 3. Verify installation
./scripts/sync.sh status
```

All commands will be installed and Swarm MCP will be configured automatically.

## Tips

- Use `/debug` for troubleshooting, `/sdebug` for critical issues
- Use `/plan` for simple features, `/splan` for architectural changes
- Use `/clean` for quick debt removal, `/sclean` for large codebases
- Use `/test` for focused testing, `/stest` for complex scenarios
- Use `/ship` for standard launches, `/sship` for high-stakes releases
- Use `./scripts/sync.sh status` before committing to check what changed
