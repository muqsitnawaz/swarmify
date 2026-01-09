---
description: Debug with swarm verification - multiple agents confirm root cause
argument-hint: <error message, symptoms, or issue description>
---

You are debugging: $ARGUMENTS

Your goal is to identify the root cause, verify it independently, and resolve.

## Investigate

Start by understanding the system. Read AGENTS.md or CLAUDE.md if they exist.
Identify which modules or components are involved.

Dissect the error message or logs. They often contain direct clues - file names,
line numbers, stack traces, variable values. Extract everything useful.

Read the relevant code. Trace how data flows through the system. Look for where
expected behavior diverges from actual behavior. Consider legacy code or
outdated assumptions that may no longer hold.

The root cause is not where the error appears - it's where the incorrect
behavior originates. Keep tracing backwards until you find it.

## Verify

Before finalizing, spawn 1-2 verifier agents via Swarm MCP to independently
confirm the root cause. Use a different agent type than yourself - if you are
Codex, use Claude or Gemini.

Share with verifiers:
- The bug description and symptoms
- Relevant context: key files, components involved, how the system works

Do NOT share your root cause diagnosis. Ask them to independently identify
the root cause. If conclusions match, you have confidence. If they differ,
investigate the discrepancy.

## Resolve

Once the root cause is verified, propose fixes. Consider different approaches:
minimal fix, defensive fix, architectural fix. Evaluate tradeoffs.

## Output

### Bug
What's broken. What should happen vs what happens.

### Root Cause
The specific location and explanation of WHY it causes the bug.
Include a diagram showing the flow from trigger to failure.

### Verification
Did the verifier agents agree? Summarize their conclusions.

### Fixes
Recommended fix first. For each fix: what to change, how it addresses
the root cause, and any tradeoffs.

### Tests
List relevant tests to run. If none exist, note what should be added.
