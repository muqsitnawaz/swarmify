---
description: Plan a feature implementation with proper research and structure
---

You are planning the implementation of: $ARGUMENTS

## Understand the Problem First

**Start with root cause, not solutions.**

- What's broken or missing?
- Why does this need to change?
- What's the current behavior vs desired behavior?

Use a table if comparing states:

```
| Current | Desired     |
| ------- | ----------- |
| Does X  | Should do Y |
```

Then understand the system. Read AGENTS.md, CLAUDE.md, or README.md if they exist. Search for keywords related to the task. Identify key components, libraries, or modules.

Read the code. Understand existing patterns and conventions. Trace the data flow. Identify all touch points and dependencies.

Do NOT guess. Explore, then read.

## Find Existing Abstractions

Before proposing ANY new code:

- Is there an existing function that does something similar?
- Is there an abstraction I can extend instead of creating a new one?
- Can I make a one-line change to existing code instead of adding new logic?

PREFER extending existing code over writing new code. PREFER one change in one place over many changes in many places.

## Design Decisions (when multiple approaches exist)

If there are multiple ways to solve this, document your reasoning:

```
**Option A: [Approach]**
Pros: ...
Cons: ...

**Option B: [Approach]**
Pros: ...
Cons: ...

**DECISION: Use Option [A/B]**
Rationale: [Why this choice is best given the constraints]
```

This shows you've thought through trade-offs.

## Consider Edge Cases

Think about what could go wrong:

- What inputs or states could break this?
- What assumptions are being made?
- Are there race conditions, error states, or boundary cases?
- What happens if dependencies fail?

Address these in your plan, not as afterthoughts.

## Structure Based on Complexity

**Simple changes** (1-2 files, clear fix):

- Goal + Approach + Implementation + Testing

**Complex changes** (multiple files, order matters, design choices):

- Goal + Approach + Design Decisions + Phase-based Implementation + Edge Cases + Testing

**Use phases when order matters**:

```
## Phase 1: [Name] (Foundation)
## Phase 2: [Name] (Core changes)
## Phase 3: [Name] (Integration)
```

## Output Format

### Goal

One sentence. What are we building or fixing?

### Approach

2-4 sentences explaining the high-level strategy. How will we solve this?

### Design Decisions (if complex)

Document options considered and why you chose this approach.

### Architecture (if relevant)

Use ASCII diagrams for data flow or component relationships:

```
User action
    ↓
Component A → Component B
    ↓
Result
```

### Implementation

**For simple changes**: One paragraph per file explaining what changes.

**For complex changes**: Organize by phases, then by file within each phase.

For each file:

```
### File: path/to/file.ts (Lines 100-150)

**Change**: [What you're doing]

Explain in clear sentences what happens. Show before/after code only when
the syntax matters or the transformation is non-obvious.

**Before**:
<code>

**After**:
<code>
```

Include **line numbers** for precise changes. Group related changes together.

### Edge Cases

List as checkmarks:

- [Scenario] → [How handled]
- [Scenario] → [How handled]

### Testing

What scenarios need testing:

- [ ] Happy path test case
- [ ] Edge case that could break
- [ ] Regression test for existing behavior

## Test Execution

Run all relevant tests after implementation. If existing tests don't cover the changed code paths, write new tests and run them. Use real services - avoid mocking. Implementation is not complete until tests pass.

### Files Modified (optional, for complex plans)

Quick reference list:

- path/to/file1.ts - [brief description]
- path/to/file2.go - [brief description]

## Writing Style

Keep every line under 100 characters. Write clear, complete sentences.

Use **tables** for state comparisons or options. Use **code blocks** only when syntax matters. Use **ASCII diagrams** for architecture or flow. Use **phases** when order matters.

BAD (cryptic bullet points):

```
- agents.vscode.ts
  - Current: returns all
  - Change: return priority one
```

GOOD (clear prose):

```
### agents.vscode.ts

The detectAvailableAgents() function currently returns all installed agents.
We'll change it to return only the highest-priority one: Claude first, then
Codex, then Gemini. This becomes the default agent for Swarm installation.
```

## Constraints

Do not add time estimates. Do not suggest "nice to have" additions. Do not plan backwards compatibility unless asked. Focus only on what was asked.

Adapt plan complexity to task complexity. Simple fix = simple plan. Complex refactor = phases + diagrams + decisions + edge cases.

## Save Your Plan

Generate a memorable three-word plan name in the format: {adjective}-{verb-ing}-{noun}.md

Follow Claude's pattern with creative combinations:

- Adjectives: abstract, atomic, bright, cosmic, cheerful, clever, buzzing, adaptive, etc.
- Verbs (in -ing form): painting, discovering, spinning, exploring, crafting, rolling, etc.
- Nouns: animals, objects, concepts, or computer scientist names

Examples: cosmic-discovering-pine, abstract-painting-wombat, bright-exploring-liskov

Then save your complete plan (all sections above) to: ~/.opencode/plans/{generated-name}.md

Use your creativity. Make it memorable and whimsical.

## Read Back Your Plan

After saving, read the plan file back to the terminal so the user can see it without
opening the file. Display the full plan contents using the Read tool.
