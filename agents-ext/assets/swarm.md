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
3. **Spawn agents** - Use `mcp__Swarm__Spawn` with appropriate mode
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

## Common Workflow Questions

### Task Breakdown
- **User concern**: "How do I split work between agents without stepping on each other?"
- **How /swarm handles it**: You propose explicit file or module ownership per agent in the context structure so scope is non-overlapping and clear.
- **Manual intervention**: Needed when the task has unclear boundaries or shared hot paths; you decide a clean ownership split or refactor targets.

### Sequencing
- **User concern**: "What should run in parallel vs sequential?"
- **How /swarm handles it**: Independent tasks run in parallel; blockers run first in a short wave, then dependent work starts after outputs land.
- **Manual intervention**: Needed when dependency order is not obvious; you choose the wave order and explicitly gate on outputs.

### Dependencies
- **User concern**: "What if Agent B needs Agent A's output?"
- **How /swarm handles it**: Give Agent B either the required pattern inline or wait for Agent A to finish and then spawn Agent B with the new details.
- **Manual intervention**: Needed when the dependency is on design or API shape; you resolve the interface or confirm it before spawning.

### Merge Conflicts
- **User concern**: "What happens if two agents edit the same file?"
- **How /swarm handles it**: Avoids overlap by assigning file ownership; if overlap is required, run sequential waves with one agent writing and the next applying a small delta.
- **Manual intervention**: Needed when overlapping edits are unavoidable; you reconcile the conflict by choosing a final, unified change.

### Debugging
- **User concern**: "How do I figure out which agent broke something?"
- **How /swarm handles it**: Each agent has a scoped assignment so you can map failures to a file set; verify by checking those files and running the relevant tests.
- **Manual intervention**: Needed when failures are cross-cutting; you triage by isolating the failing behavior and tracing changes across agents.

### Recovery
- **User concern**: "What if an agent goes off the rails?"
- **How /swarm handles it**: Stop the agent, revert or discard its changes in that scope, then reassign the task with tighter constraints.
- **Manual intervention**: Needed when the failure is systemic; you rewrite the assignment and enforce a stricter success criteria.

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
- Use `mcp__Swarm__Status` to monitor progress
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
