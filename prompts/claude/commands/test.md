---
description: Identify critical paths and write tests with planning first
---

You are testing: $ARGUMENTS

Your goal is to identify critical paths, plan the tests, and execute after
approval.

## Identify Critical Paths

What user flows matter most? What breaks trust if it fails? Focus on:

1. **Core functionality** - The main thing this module does
2. **User-facing output** - What the user sees, formatting, messages
3. **Data integrity** - Does data persist correctly, update correctly

## Find Contracts

Things that must be consistent:
- Formatting patterns (tool names, error messages, labels)
- Naming conventions (display vs internal names must match)
- Visual elements that repeat across the app

A mismatch here looks unprofessional and spoils the experience.

## Consider Failure Scenarios

Don't just test happy path. What happens when things fail?
- API returns error
- Network timeout
- Invalid input
- Missing data
- Permission denied

What does the user see? Is it graceful or ugly?

## State Verification

Not just "did it not crash" but "is the state correct after?"
- Did the data actually persist?
- Did the UI update to reflect the change?
- Is the state consistent across components?

## Boundary Conditions

Where formatting and logic often break:
- Empty lists (0 items, empty state UI)
- Single item vs multiple items
- First item, last item
- Max limits, overflow
- Long strings, special characters

## Plan First

Present your test plan before executing:

### Summary
What's being tested and why these paths are critical.

### Critical Contracts
Things that must be consistent across the app. List each with what to verify.

### Test Plan

#### Existing Tests
Which tests to run and what they verify.

#### New Tests
For each new test:
- What: what it tests
- Why: why this is critical
- Type: unit / integration / e2e
- Verifies: the specific assertion or state check

#### Failure Scenarios
Tests for error handling:
- Scenario: what fails
- Expected: what user should see
- Verifies: graceful degradation

#### Boundary Tests
- Condition: the edge case
- Expected: correct behavior
- Verifies: no formatting/logic break

#### E2E with ux-tester
Flows to validate visually via `rush run agents/ux-tester`:
- Flow description
- What to look for
- Expected behavior

### Execution
Ready to run after approval.
