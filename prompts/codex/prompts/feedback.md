---
description: Get thorough two-wave feedback from research agents with premortem analysis
---

You need feedback on: $ARGUMENTS

Spawn research agents in two waves to get unbiased, well-researched feedback.
Agents research thoroughly but do NOT write code.

## Prepare Context

Before spawning, articulate:

1. **Goal**: What are you trying to achieve?
2. **Requirements**: Constraints, timeline, resources
3. **Strategies Explored**: What approaches were considered and why rejected/adopted
4. **Current Solution**: Your proposed approach (hold this back for Wave 2)
5. **Domain**: Software, marketing, product, business, design, or other

## Wave 1: Blind Feedback

Spawn 2 agents via Swarm MCP in plan mode. Share goal, requirements, and strategies
explored - but NOT your current solution. This prevents anchoring bias.

Assign roles (not just agent types):
- **Red Team** (Codex): Find failure modes, risks, what could go wrong
- **Strategist** (Gemini): Big-picture alignment, second-order effects, alternatives

Prompt each agent with:
```
Goal: [goal]
Requirements: [requirements]
Domain: [domain]
Strategies considered: [what was explored]

Your role: [Red Team / Strategist]

Research this problem thoroughly:
- Use web search for best practices, similar cases, common pitfalls
- Look up any relevant frameworks or methodologies
- Find real-world examples of success and failure in this area

Then provide:
1. Three alternative approaches with pros/cons
2. Three risks or blind spots to watch for
3. What information is missing to make a good decision?
4. What are the known unknowns - things we can't answer yet but should track?

Do NOT write code. Research and analysis only.
Be thorough - take time to research before responding.
```

## Wave 2: Informed Feedback + Premortem

After Wave 1 completes, spawn 2 new agents. Now reveal your current solution.

Prompt each agent with:
```
[Include Wave 1 context]

Current solution: [your approach]

Wave 1 findings summary: [key points from first wave]

Now that you see the proposed solution:

1. **Critique using "I Like / I Wish / What If":**
   - I Like: What's strong about this approach?
   - I Wish: What would make it better?
   - What If: What alternative angles haven't been considered?

2. **Premortem Analysis:**
   Assume this solution fails badly in 6 months.
   - What went wrong?
   - What early warning signs did we miss?
   - For each failure mode: what's one mitigation or experiment to de-risk it?

3. **Verdict:** Rate 1-10 with reasoning. Recommend: Ship / Iterate / Pivot / Kill

   Rubric:
   - 1-3: Kill (fundamental flaws)
   - 4-5: Pivot (wrong direction)
   - 6-7: Iterate (good bones, needs work)
   - 8-10: Ship (ready with minor polish)

Do NOT write code. Critique and analysis only.
```

## Synthesize

After both waves complete:

### Wave 1 Findings
- Alternative approaches identified
- Key risks flagged
- Missing information

### Wave 2 Findings
- Strengths of current solution
- Improvements suggested
- Premortem failure modes

### Consensus vs Dissent
- Where agents agreed (likely real concerns)
- Where they disagreed (explore why)

### Action Plan
Based on all feedback:
1. Top 3 changes to make
2. Top 3 risks to mitigate
3. Go / No-go recommendation

## Principles

- Wave 1 agents must NOT see your solution - this is critical for unbiased feedback
- For quick decisions, compress the process. For high-stakes, be thorough.
- If Wave 1 isn't surfacing new perspectives, move on - don't force it.
- Every critique should have a mitigation. Don't just identify problems.
- If both waves flag the same issue, it's almost certainly real.
- Dissent is signal. Agreement might be sycophancy - probe it.
- Flag what you don't know, not just what you do.
