---
description: Pre-launch verification with swarm - independent agents confirm readiness
argument-hint: <app name or path to assess>
---

You are shipping: $ARGUMENTS

Your goal is to use independent agents to verify app readiness without bias
from your own initial assessment.

## Provide Context

Describe the app thoroughly:
- What is the app? (Electron app, web app, service, etc.)
- What are the critical user flows?
- What frameworks and tech stack? (React, Node, Go, etc.)
- What integrations exist? (OAuth, APIs, external services)
- Why is this shipping? What's the user value?

Also note:
- Any known issues from documentation
- Any previous assessments or concerns
- Deployment target and user base

Do NOT share:
- Your assessment or conclusions
- Your go/no-go recommendation
- Issues you've identified
- Your concerns about readiness

## Spawn Independent Agents

Spawn 2-3 agents via Swarm MCP using different types (Codex, Claude, Gemini).

For each, provide:
- The context above
- Ask them to independently assess readiness for shipping
- Ask them to focus on: security, performance, critical path stability
- Tell them to treat documentation as guidance (may be stale)
- Ask them to reach their own go/no-go decision

They do NOT see your assessment or each other's findings until complete.

## Synthesize Findings

After agents report:
1. Review what each agent found independently
2. Note where they agree
3. Note where they diverge and why
4. Form unified recommendation based on consensus

If agents' conclusions differ significantly from your assessment:
- Investigate why (did you miss something? did they?)
- Determine which assessment is more reliable

## Output

### Summary
What the independent agents concluded about readiness.

### Agent Assessments

#### Agent 1 ([Type])
- Key findings
- Security assessment
- Performance assessment
- QA assessment
- Go/No-Go recommendation

#### Agent 2 ([Type])
- Key findings
- Security assessment
- Performance assessment
- QA assessment
- Go/No-Go recommendation

#### Agent 3 ([Type]) (if spawned)
- Key findings
- Security assessment
- Performance assessment
- QA assessment
- Go/No-Go recommendation

### Synthesis
- Where agents agreed
- Where agents diverged and why
- Unified Go/No-Go recommendation based on consensus

### Critical Issues (if any)
Issues that multiple agents flagged as blockers:
- Issue description
- Why it's critical
- What must be fixed

### High Priority Items
Issues worth addressing before shipping but not blockers.

### Agreed Monitoring Points
Issues to watch post-launch that all agents mentioned.

### Final Recommendation
**Go/No-Go**: Based on independent analysis

**Confidence level**: High (agents agree) / Medium (some disagreement) / Low (agents diverge significantly)

If divergence exists, explain why and what it means for shipping decision.
