# /swarm

Primary entry point for orchestrated work. Read the requested mix, draft a distribution plan, wait for approval, then execute across parallel Swarm agents.

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
2. **Explore if needed** - Use Claude SubAgents (Task tool with Explore/Plan), NOT Swarm
3. **Show distribution plan** - Present agent assignments with boundary contracts (REQUIRED). Pause here and follow the approval workflow in `prompts/README.md`.
4. **Spawn agents** - Use `mcp__Swarm__spawn` with appropriate mode
5. **Report completion** - Summarize what each agent accomplished
6. **Run tests** - Validate changes work (implement mode only)

## CRITICAL: Exploration Uses Claude SubAgents

For any exploration, investigation, or planning work - use Claude SubAgents via the Task tool:
- `subagent_type: 'Explore'` - For codebase exploration
- `subagent_type: 'Plan'` - For implementation planning

**DO NOT** spawn Swarm agents (cursor/codex/gemini/claude) for exploration. Swarm agents are for parallel execution of known, well-defined work only.

## CRITICAL: Pre-Spawn Integration Discovery

Before creating a distribution plan, Claude MUST identify integration points and existing patterns. Agents execute - Claude architects. Bad architecture = bad execution.

### Surgical Exploration (Don't Read Everything)

1. **Grep for integration points** - Find where similar features store config, define types, etc.
   ```
   grep -r "user.yaml" → found harness/config/user.go
   grep -r "\.rush/" → found existing path patterns
   ```

2. **Read only key files** - The ones that define patterns/contracts agents must follow
   ```
   read harness/config/user.go → saw UserConfig struct, understood the pattern
   ```

3. **Include specific paths in agent prompts** - Not vague instructions
   ```
   BAD:  "Store local model config somewhere"
   GOOD: "Add LocalModelEnabled field to UserConfig struct in harness/config/user.go:15"
   ```

### What to Identify

- **Config patterns**: Where does similar config live? Extend existing, don't invent new paths.
- **Type definitions**: What structs/interfaces must agents extend vs create?
- **Integration points**: How do components communicate? (IPC, files, APIs)
- **Existing conventions**: File naming, directory structure, code style.

### Example: Local Model Feature

```
# Quick grep
grep "user.yaml" → harness/config/user.go, rush/cli/internal/cli/auth_reader.go
grep "\.rush/agents" → found per-agent config pattern

# Read key file
read harness/config/user.go → UserConfig struct with TrustedDirectories, etc.

# Result: Agent prompt includes
"Extend UserConfig in harness/config/user.go to add UseLocalModel bool field"
NOT
"Create a config file for local model settings"
```

Agents don't explore - they execute. Give them precise targets based on YOUR exploration.

## CRITICAL: Distribution Plan Required

Before spawning ANY Swarm agent, you MUST show a distribution plan and get user approval.

**Distribution Plan Format:**

```
## Swarm Distribution Plan

### Overall Task
[Brief description of what we're building/changing]

### Agent 1: [Name/Purpose]
- **Type**: gemini/cursor/codex
- **Task**: [Specific deliverable in 1-2 sentences]
- **Owns**: [Exact files this agent will modify]
- **Must NOT touch**: [Files owned by other agents]

### Agent 2: [Name/Purpose]
...

### Boundary Contracts
[Explain how work is divided to prevent overlap]
[Note any shared dependencies and how they're handled]
[If Agent 1 creates something Agent 2 needs, explain the sequencing]

### Execution Order
[If sequential waves needed, explain which agents go first]
[Or: "All agents can run in parallel - no dependencies"]

Ready to spawn? (yes/no)
```

**Wait for explicit user approval before spawning.**

## Agent Distribution

Default mix if the user does not specify otherwise:
- 50% Gemini
- 45% Codex
- 5% Cursor

If the user states a mix (percentages or roles), interpret it and weight the distribution accordingly.

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

## Boundary Contract
- Files you OWN (may modify): [explicit list]
- Files you must NOT touch: [explicit list - owned by other agents]
- Shared dependencies: [how to handle imports, types, etc.]

## Pattern to Apply
[Exact code pattern, style, or approach]
[Include concrete examples]

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

### Verify Agent Changes
1. Use `grep` to verify agents made the expected code changes
2. Search for key patterns, function names, or imports the agents should have added/modified
3. Report what was found

### Test Validation (Required)
1. Run existing test suite relevant to changes
2. Report pass/fail status
3. If failures, investigate and fix or report to user

### Integration Tests (Optional)
- Only if coverage gaps exist in critical paths
- Spawned agents likely wrote unit tests already
- Focus on cross-component integration

## Execution Notes

- After spawning all agents, wait 2+ minutes before checking status
- Use `mcp__Swarm__status` to monitor progress
- If an agent fails, report the failure and ask user how to proceed
- Don't re-run entire swarm for one agent's failure

## Verifying Agent Work

1. **Run tests** - required for all code changes
2. **Quick grep** for what agent claims it changed - cheap, do this

**Don't assume failure from empty metadata.** `files_modified: []` could mean agent used a different approach. Grep for the actual code before concluding failure.

## Examples

**User provides detailed plan:**
```
User: /swarm [detailed plan with file lists]
Action: Show distribution plan with boundary contracts, get approval, then spawn
```

**User provides requirements only:**
```
User: /swarm Add Sentry instrumentation to all catch blocks in rush/app
Action: Use Claude SubAgent (Explore) to find files, show distribution plan, get approval, spawn
```

**User asks for validation:**
```
User: /swarm double-check this plan then implement: [plan]
Action: Use Claude SubAgent (Plan) to validate, show distribution plan, get approval, spawn
```

**Docs/config only changes:**
```
User: /swarm Update all copyright headers to 2025
Action: Show distribution plan, get approval, spawn (skip test running - no code logic)
```

**Brainstorm/research (plan mode):**
```
User: /swarm What are some Apple-style ideas for first-time UX?
Action: Show distribution plan with different perspectives, get approval, spawn with mode='plan'
```
