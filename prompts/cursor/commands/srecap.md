---
description: Recap with swarm - agents gather evidence before handoff
---

You are creating a verified recap of: $ARGUMENTS

Your goal is to produce a high-confidence summary by having independent agents
investigate any gaps or uncertainties before finalizing.

## Initial Assessment

First, create a draft recap covering:
- What was the original goal?
- What work has been done?
- What files were changed?
- What's the current state?

As you gather information, note any gaps:
- Claims that lack verification
- Areas you can't fully assess without deeper investigation
- Hypotheses that need testing

## Spawn Investigators

For each significant gap, spawn an agent via Swarm MCP to investigate.

Use different agent types (Codex, Gemini, Cursor) for diverse approaches.

Give each investigator:
- The specific question to answer
- Context on what you already know
- Files or areas to focus on
- What evidence would answer the question

Example investigations:
- "Verify that all auth endpoints handle token expiration correctly"
- "Check if the database migration was applied and data is consistent"
- "Confirm the error in logs matches the user-reported behavior"
- "Test whether the fix actually resolves the original issue"

Agents return with findings. They may confirm, contradict, or add nuance.

## Synthesize

Combine your initial assessment with agent findings:
- Update facts based on verified information
- Upgrade hypotheses to conclusions where evidence supports it
- Flag remaining uncertainties with confidence levels

## Output

### Situation
What was the goal? What's the current state? Include confidence level.

### Verified Facts
Facts confirmed by direct evidence or agent investigation.
Include source of verification.

### Completed Work
What was done. Include file paths and verification status.

### Open Items
What remains. Include why it's open and what would close it.

### Agent Investigations

#### Investigation 1: [Topic]
- **Agent**: [Type]
- **Question**: What we needed to know
- **Finding**: What they found
- **Evidence**: Specific files, logs, or test results

#### Investigation 2: [Topic]
...

### Confidence Assessment
- High confidence: [List items with strong evidence]
- Medium confidence: [List items with partial evidence]
- Low confidence / Speculation: [List items needing more investigation]

### Recommended Next Steps
Prioritized actions based on verified state.
