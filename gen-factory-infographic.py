#!/usr/bin/env python3
"""Generate Software Factory workflow infographic using GPT Image 2."""

import os
import base64
from pathlib import Path
import openai

client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

PROMPT = """
Infographic diagram. Clean, modern data-flow visualization.

Dark charcoal background (#0D1117). Horizontal left-to-right flow with 5 stages connected by bold electric-blue arrows. Each stage is a rounded-rectangle card in dark gray (#1C2128) with a subtle blue glow. White sans-serif text (Inter or similar). Company logos rendered accurately and small, inset into their respective cards.

Stage 1 — "Your Idea"
Person icon submitting a task. Purple Linear logo (the triangular "L" mark). Label: "Submit a task in Linear".

Stage 2 — "Plan"
Anthropic logo (the small "A" symbol in orange). Label: "AI Planner". Subtitle: "Reads the task, explores the codebase, writes an architecture plan, creates sub-tasks". Single card, slightly taller than others.

Stage 3 — "Build in Parallel"
This section spans 3 vertical lanes side by side, each a smaller card, clearly showing concurrency:
  - Lane A: Anthropic "A" logo. Label "Worker 1"
  - Lane B: OpenAI logo (white swirl). Label "Worker 2"
  - Lane C: Anthropic "A" logo. Label "Worker 3"
Bracket label above all three lanes: "Build in Parallel — each agent works on one feature slice"

Stage 4 — "Review"
GitHub Octocat logo. Label "Pull Requests". Three small PR badges: PR #1, PR #2, PR #3. Subtitle: "Each worker opens a PR".

Stage 5 — "Ship"
Checkmark icon. Label "You Review & Ship". Subtitle: "Merge when ready".

Overall composition: Landscape 16:9. All text is large and readable. No emoji. No decorative elements beyond the flow structure. Suitable for a tech product landing page. Professional, polished, award-winning infographic design.
""".strip()

print("Generating with gpt-image-2...")
response = client.images.generate(
    model="gpt-image-2",
    prompt=PROMPT,
    size="1536x1024",
    quality="high",
    n=1,
    output_format="png",
)

image_data = response.data[0].b64_json
if image_data:
    out = Path("/Users/muqsit/src/github.com/muqsitnawaz/swarmify/factory-flow-gpt.png")
    out.write_bytes(base64.b64decode(image_data))
    print(f"Saved: {out}")
else:
    url = response.data[0].url
    print(f"URL (no b64): {url}")
