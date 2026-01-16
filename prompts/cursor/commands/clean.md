---
description: Identify and clean up technical debt, outdated code, and duplicates
---

You are cleaning up: $ARGUMENTS

Your goal is to identify cleanup opportunities, verify them, propose solutions,
and execute the cleanup.

## Scan

Search for cleanup opportunities in this priority order:

1. **Outdated** - Context files (AGENTS.md, README.md, CLAUDE.md) that don't
   match reality. Code paths that are stale but still referenced. These cause
   wrong decisions and bugs.

2. **Near-duplicates** - Two implementations of the same thing that have
   drifted apart. One gets updated, the other doesn't.

3. **Scattered sources of truth** - Same concept defined in multiple places.
   Constants, configs, type definitions that should be centralized.

4. **Complex patterns** - Overly complex code that can be simplified without
   changing behavior.

5. **Dead code** - Unused exports, unreachable paths, functions never called.
   Noise that obscures real code.

6. **Naming/organization** - Confusing names, illogical file organization,
   inconsistent conventions.

## Verify

For each finding, verify it's actually an issue. Read the code. Confirm your
claim with evidence. Do not guess.

Evidence examples:
- "AGENTS.md says X but the code does Y"
- "functionA and functionB both implement sorting, but A handles nulls and B doesn't"
- "CONFIG_TIMEOUT is defined in config.go, utils.go, and constants.go"

If you cannot verify a finding, drop it.

## Clarify

If anything is unclear, ask before proceeding. Examples:
- "FeatureX and FeatureY appear to do the same thing. Which is canonical?"
- "This function is unused but exported. Is it part of the public API?"

Do not assume. Ask.

## Propose

For each verified finding, propose a concrete fix. Explain what to change
and why it solves the problem.

## Output

### Summary
One paragraph. What areas need cleanup and the overall state.

### Findings

Group by category in priority order. For each finding:

#### Outdated
**[file or component name]**
- What: description of what's outdated
- Evidence: how you verified this
- Fix: what to update or remove

#### Near-duplicates
**[the duplicate implementations]**
- What: the two or more implementations
- Evidence: how they've diverged
- Fix: which to keep, how to unify

#### Scattered Sources of Truth
**[the concept]**
- Locations: where each definition lives
- Fix: where to centralize, what to remove

#### Complex Patterns
**[file:function or component]**
- What: the complexity
- Fix: how to simplify

#### Dead Code
**[file or export]**
- Evidence: why it's unreachable or unused
- Fix: remove

#### Naming/Organization
**[the issue]**
- Current: what it's called or where it lives
- Proposed: better name or location

### Clarifications
Questions for the user before proceeding. Skip if none.

### Execution Plan
Ordered list of changes to make. Group by area. Ready to execute after
user approval.
