---
description: Debug an issue with systematic root cause analysis
argument-hint: <error message, symptoms, or issue description>
---

You are debugging: $ARGUMENTS

Your goal is to identify the root cause and propose fixes.

Start by understanding the system. Read AGENTS.md or CLAUDE.md if they exist.
Identify which modules or components are involved. If you don't understand
part of the system, spawn a subagent to explore it.

Dissect the error message or logs. They often contain direct clues - file names,
line numbers, stack traces, variable values. Extract everything useful.

Read the relevant code. Trace how data flows through the system. Look for where
expected behavior diverges from actual behavior. Consider legacy code or
outdated assumptions that may no longer hold.

The root cause is not where the error appears - it's where the incorrect
behavior originates. Keep tracing backwards until you find it.

Once you identify the root cause, consider different approaches to fix it.
There may be a minimal fix, a more defensive fix, or an architectural fix.
Evaluate the tradeoffs.

## Output

### Bug
What's broken. What should happen vs what happens.

### Root Cause
The specific location and explanation of WHY it causes the bug.
Include a diagram showing the flow from trigger to failure.

### Fixes
Recommended fix first. For each fix: what to change, how it addresses
the root cause, and any tradeoffs. Only list multiple fixes if there
are genuinely different approaches.

### Tests
A fix is not a fix until tests pass. List relevant tests to run, starting
with unit tests, then integration tests. If no tests exist for this code
path, note what tests should be added.
