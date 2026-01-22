---
description: Test with swarm - parallel agents test different critical paths
---

You are testing: $ARGUMENTS

Your goal is to identify critical paths, use parallel agents to test different
areas, synthesize for cross-cutting concerns, and execute the test plan.

## Identify Areas

Break down the scope into testable areas:
- Auth/permissions flows
- Data persistence and integrity
- API endpoints and contracts
- UI/UX critical paths
- Error handling and edge cases

Estimate complexity:
- Simple (1-2 flows): 1 agent
- Medium (3-5 flows): 2 agents
- Complex (6+ flows or full app): 3 agents

## Spawn Parallel Agents

Use Swarm MCP to spawn agents for each area. Use different agent types for diversity.

For each agent, provide:
- Area to test (e.g., "Auth flows", "Data persistence", "UI critical paths")
- Context about the system
- Focus: Critical paths, failure scenarios, state verification, boundary conditions

Ask each to:
1. Identify critical paths in their area
2. Plan tests (unit, integration, e2e)
3. Note what would spoil UX if broken
4. Use ux-tester for visual validation if applicable

## Synthesize Findings

After agents report back, look for cross-cutting concerns:
- Integration points between areas (auth + data persistence)
- Shared state that multiple flows depend on
- Error handling patterns that should be consistent
- Formatting/display contracts across the app
- End-to-end flows that span multiple areas

## Output

### Summary
What areas were tested, how many agents used, overall coverage.

### Test Plan by Area

For each area, show what that agent planned:

#### [Area Name] (Agent: [type])

**Critical Paths**
What flows matter most in this area.

**Tests**
- Existing tests to run
- New tests to add
- Failure scenarios
- Boundary conditions
- E2E with ux-tester (if applicable)

### Cross-Cutting Tests
Tests that span multiple areas:
- Flow: the end-to-end scenario
- Areas touched: which agents' areas this involves
- Verifies: what contract or integration this validates

### Execution Plan
Consolidated plan for running all tests. Order matters if tests have dependencies.
