---
description: Pre-launch verification - security, performance, and QA assessment
---

You are shipping: $ARGUMENTS

Your goal is to comprehensively assess app readiness across security, performance,
and QA while accounting for potentially stale documentation.

## Phase 1: App Understanding

Read and understand the app:
- AGENTS.md - Project structure, critical modules, architecture
- README.md - Intended use, main features
- TODO.md - Known blockers, ongoing work, known issues
- package.json - Tech stack, dependencies
- Key source files - Identify critical user flows and frameworks

Build context:
- What frameworks are in use? (React, Electron, Node, Go, etc.)
- What are the critical user flows? (Install agent, run agent, manage sessions, auth)
- What external integrations exist? (OAuth, APIs, MCPs)
- What does TODO.md say are blockers?

Important: Treat TODO.md as guidance, NOT ground truth. Each claim will be
independently verified by swarms.

## Phase 2: Spawn Specialized Swarms (Parallel)

Estimate the scope of work needed and spawn 1-2 agents for each area via Swarm MCP.
Use different agent types (Codex, Claude, Gemini) for diversity.

### Security Swarm

Provide context:
- Identified frameworks (Electron, React, Node, Go, etc.)
- Critical paths (auth, session management, integrations)
- Known integrations (OAuth, APIs)

Ask them to:
1. Scan for vulnerabilities specific to the identified frameworks:
   - Electron: IPC security, preload scripts, nodeIntegration, native modules
   - React: XSS, injection, unsafe HTML/dangerouslySetInnerHTML
   - Node: Dependency vulnerabilities, secrets in code/env
   - Go: Memory safety, crypto handling, auth token management
2. Check for secrets in git history or hardcoded credentials
3. Verify auth token storage (keychain, localStorage, etc.)
4. Test OAuth state validation and PKCE flows if present

### Performance Swarm

Provide context:
- Identified frameworks and their constraints
- Critical user flows and expected latency budgets

Ask them to:
1. Identify framework-specific bottlenecks:
   - React: Unnecessary re-renders, missing memoization, component splitting opportunities
   - Electron: Main process blocking, IPC overhead, startup time
   - Bundle size and code splitting effectiveness
2. Profile critical paths that affect first-time user experience
3. Identify slow operations (agent execution, session loading, API calls)

### QA Swarm

Provide context:
- Critical user flows identified
- Known integrations and error scenarios
- Deployment target (Electron app, web, etc.)

Ask them to:
1. Test critical paths end-to-end with real execution
2. Test error scenarios: network failure, token expiry, invalid input, API errors
3. Verify integration points: OAuth, session persistence, agent execution
4. Use ux-tester for visual validation and E2E testing
5. Check for regressions or edge cases mentioned in TODO

## Phase 3: Verify Against TODO

After swarms report back:

1. Review "Launch Blockers" section
   - Are these actually blocking? (Check code references)
   - Have any been completed since docs were written?
   - Do swarms agree these are blockers?

2. Cross-reference findings
   - Did swarms find critical issues TODO missed?
   - Did swarms confirm TODO issues as real vs false positives?
   - Are items marked "done" actually complete?

3. Flag discrepancies
   - Example: "TODO says secrets rotated, but scan found old key in env"
   - Example: "TODO lists nice-to-have, but perf scan shows it's critical"

## Output

### Summary
Overall readiness assessment. Can ship? With caveats? What are the known risks?

### Critical Blockers
Issues that MUST be fixed before shipping (if any). Each with:
- Description and evidence
- Impact on core functionality
- What must be done to unblock

### High Priority (Should Fix)
Issues that significantly impact user trust or stability:
- Description and evidence
- Why it matters for launch
- Recommended fix

### Security Findings
Grouped by severity:
- **Critical**: Immediate exploitation risk
- **High**: Significant vulnerability
- **Medium**: Worth fixing before shipping
- **Low**: Can defer

For each: type, location, severity, recommended fix.

### Performance Findings
Identified bottlenecks with:
- Location in code/component
- Impact on user experience
- Recommended optimization

### QA Findings
- Regressions or broken critical paths
- Error handling verification
- Integration point status
- Edge cases found

### TODO Discrepancies
Highlight any disagreements between documentation and actual findings:
- "TODO marked as done, but findings show X still incomplete"
- "TODO lists as nice-to-have, but QA found it's critical"
- "TODO doesn't mention X, but security scan found vulnerability"

### Polish & Nice-to-Haves (Can Defer)
Non-critical improvements with minimal user impact.

### Recommendation
**Go/No-Go**: Ship / Ship with warnings / Hold until blockers fixed

**If shipping**:
- Known issues to monitor post-launch
- Recommended monitoring/alerting
- User communication talking points

**If holding**:
- Critical blockers list
- Estimated effort to fix each
- Recommended priority order
