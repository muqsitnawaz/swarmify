# /swarm

Distribute and execute tasks across parallel Swarm agents.

## Arguments

$ARGUMENTS - The task, requirements, or plan to execute.

## Execution Modes

| Mode | Spawn with | Use when |
|------|------------|----------|
| **Implement** | `mode: 'edit'` | Task requires code changes |
| **Brainstorm** | `mode: 'plan'` | Task is research, ideation, or exploration |

Infer the appropriate mode from context. If genuinely unclear, ask.

**Brainstorm mode differences:**
- Agents are read-only
- Skip post-completion steps (tests, git, commits)
- Synthesize agent ideas rather than summarizing changes
- Can give agents different creative perspectives

## Core Behavior

You coordinate work across multiple Swarm agents. Each task is different - adapt your approach based on what's needed.

### Required Steps

1. **Understand the task** - Parse requirements or plan provided by user
2. **Propose distribution** - Show agent assignments with full context structure
3. **Spawn agents** - Use `mcp__Swarm__spawn` with appropriate mode
4. **Report completion** - Summarize what each agent accomplished
5. **Run tests** - Validate changes work (implement mode only)

### Optional Steps (use judgment)

| Step | Consider When |
|------|---------------|
| Exploration | Requirements unclear, scope unknown, user says "validate" or "double-check" |
| User confirmation before spawn | Ambiguous distribution, high-risk changes, very large scope |
| Add integration tests | Coverage gaps in critical paths (agents likely wrote unit tests) |

## Agent Distribution

Follow user preferences from CLAUDE.md:
- 65% Gemini
- 30% Cursor
- 5% Codex

Or use explicit user preference if specified.

## Context Structure for Agents

Every spawned agent MUST receive this context structure:

```
## Mission
[Why we're doing this - the business/technical goal]

## Full Scope
[Complete list of ALL files/tasks across ALL agents]
[Gives each agent the big picture]

## Your Assignment
[Specific files/tasks THIS agent owns]

## Pattern to Apply
[Exact code pattern, style, or approach]
[Include concrete examples]

## What NOT to Do
- Don't touch files outside your assignment
- [Other task-specific constraints]

## Success Criteria
[How to know the task is complete]
```

## Agent Sub-Spawning

If agents need to spawn sub-agents, use CLI commands:

- Cursor: `cursor-agent -p --output-format stream-json "prompt"`
- Gemini: `gemini -p "prompt" --output-format stream-json`
- Codex: `codex exec "prompt" --full-auto --json`

Prefer Cursor for most sub-agent tasks. Use Gemini for complex multi-system work, Codex for simple self-contained features.

## Handling Dependencies

If tasks have dependencies between agents:
- **Sequential waves**: Spawn blockers first, wait for completion, then spawn dependent agents
- **Inline patterns**: Give all agents the pattern inline so they don't depend on files other agents create

Ask user preference if unclear.

## Post-Completion

### Git Status Check
1. Run `git status --short` to see uncommitted changes
2. If clean, run `git log --oneline -N` to see recent agent commits
3. Report what changed either way

### Test Validation (Required)
1. Run existing test suite relevant to changes
2. Report pass/fail status
3. If failures, investigate and fix or report to user

### Integration Tests (Optional)
- Only if coverage gaps exist in critical paths
- Spawned agents likely wrote unit tests already
- Focus on cross-component integration

### Commit Offer
If uncommitted changes remain after validation passes, offer to commit them.

## Execution Notes

- After spawning all agents, wait 2+ minutes before checking status
- Use `mcp__Swarm__status` to monitor progress
- If an agent fails, report the failure and ask user how to proceed
- Don't re-run entire swarm for one agent's failure

## Verifying Agent Work

1. **Run tests** - required for all code changes
2. **Quick grep** for what agent claims it changed - cheap, do this

**Don't assume failure from empty metadata.** `files_modified: []` could mean agent committed its changes. Grep for the actual code before concluding failure.

## Examples

**User provides detailed plan:**
```
User: /swarm [detailed plan with file lists]
Action: Skip exploration, propose distribution immediately
```

**User provides requirements only:**
```
User: /swarm Add Sentry instrumentation to all catch blocks in rush/app
Action: Quick exploration to find files with catch blocks, then propose distribution
```

**User asks for validation:**
```
User: /swarm double-check this plan then implement: [plan]
Action: Light exploration to validate scope, then propose distribution
```

**Docs/config only changes:**
```
User: /swarm Update all copyright headers to 2025
Action: Skip test running (no code logic changed)
```

**Brainstorm/research (plan mode):**
```
User: /swarm What are some Apple-style ideas for first-time UX?
Action: Spawn agents with mode='plan', give different perspectives, synthesize ideas
```

```
User: /swarm How do other apps handle offline sync?
Action: Spawn agents with mode='plan' to research patterns, report findings
```
