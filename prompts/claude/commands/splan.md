---
description: Plan with swarm verification - multiple agents validate approach
---

You are planning the implementation of: $ARGUMENTS

Your goal is to create a plan and validate it with independent agents.

## Understand

Start by understanding the system. Read AGENTS.md or CLAUDE.md if they exist.
Search for keywords related to the task. Identify key components, libraries,
or modules involved.

Read the code. Understand existing patterns and conventions. Trace the data
flow through the system. Identify all touch points and dependencies.

Do NOT guess. Explore, then read.

## Find Existing Abstractions

Before proposing ANY new code, ask yourself:
- Is there an existing function that does something similar?
- Is there an abstraction I can extend instead of creating a new one?
- Can I make a one-line change to existing code instead of adding new logic?

PREFER extending existing code over writing new code.
PREFER one change in one place over many changes in many places.

## Draft Your Plan

Create an initial plan covering: goal, approach, implementation details,
edge cases, and testing.

## Verify

Before finalizing, spawn 1-2 agents via Swarm MCP to independently plan the
same feature. Use a different agent type than yourself - use Codex or Gemini.

Share with verifiers:
- The feature description
- Relevant context: key files, components involved, how the system works

Do NOT share your proposed approach. Ask them to independently create a plan.

Compare approaches:
- Did they identify the same touch points and files?
- Similar scope or did one find additional work?
- Did they catch edge cases you missed?
- Is their approach simpler or more robust?

If approaches differ significantly, evaluate which is better or combine
strengths from both.

## Output

### Goal
One sentence. What are we building?

### Approach
A short paragraph explaining the high-level strategy.

### Verification
Summarize the independent plans. Note agreements and differences.
Explain why you chose your final approach.

### Design
Only include if there are visual or architectural changes. Use ASCII diagrams.

### Implementation
Group by major area. For each area, write a paragraph explaining what changes.
Use the file name as a heading, then explain the change in sentences.

### Edge Cases
List edge cases considered and how the implementation handles them.

### Testing
What scenarios need testing. Focus on the happy path and edge cases.

## Constraints

Do not add time estimates. Do not suggest "nice to have" additions. Do not
plan backwards compatibility unless asked. Focus only on what was asked.
