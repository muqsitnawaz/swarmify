# /simagine — Swarm Visual Asset Prompting

Generate high-quality Nano Banana Pro prompts using parallel creative exploration. Swarm agents brainstorm aesthetic ingredients; you synthesize them into final prompts.

## Workflow

### 1. Research (REQUIRED FIRST)

**Do NOT spawn agents until you've completed this research.**

Read all provided files (@-mentions, paths):
- README, docs, configuration files
- Marketing copy, landing page text, product descriptions
- Any existing brand guidelines or style guides

Check for existing visual assets:
- List common asset directories (assets/, images/, public/, static/)
- Note existing images (logos, covers, screenshots)
- Identify visual gaps

Extract key context:
- **Product purpose**: What problem does it solve?
- **Target users**: Who uses this? What's their context?
- **Brand palette**: Colors mentioned or visible in assets
- **Positioning & tone**: How is it marketed?
- **Success feeling**: What should user feel after using this?

**Minimum: Read at least 3-5 files and understand positioning before proceeding.**

### 2. Map Creative Directions

Identify **3-5 distinct feelings or styles** to explore in parallel. Examples:
- **Emotions**: confidence, calm, urgency, curiosity, satisfaction
- **Styles**: minimal, cinematic, organic, premium, playful
- **Metaphors**: absence/void, motion/ascent, light/shadow, threshold, structure

Each direction must be **meaningfully different**.

### 3. Spawn Swarm Agents

Use `mcp__Swarm__spawn` with `effort=fast` to launch **5 agents in parallel**.

**CRITICAL**: Agents brainstorm ingredients, NOT final prompts.

Agent task template:
```
Explore [FEELING] (e.g., confident ascent, calm clarity, urgent action).

Brainstorm visual ingredients that evoke this feeling:
- Objects: What's in the frame? (stairs, coins, empty tray, light beam, etc.)
- Materials: Surfaces and textures (brass, slate, linen, marble, glass, etc.)
- Lighting: Atmosphere and quality (soft daylight, golden hour, rim light, etc.)
- Colors: Palette and tones (navy/gold, cool gray, warm peach, etc.)
- Composition: Layout and framing (centered, asymmetric, 70% negative space, etc.)
- Motion: Dynamics and energy (rising, flowing, static, hovering, etc.)

List 5-10 specific ingredients per category.
DO NOT write Nano Banana Pro prompts. Only brainstorm ingredients.

Example output format:
Objects: rising coins, stacked geometric blocks, upward staircase, single lit elevator button
Materials: brushed brass edges, dark wood surface, charcoal wall, marble desk
Lighting: directional morning beam from upper right, soft shadows, golden hour glow
Colors: navy undertone, gold accents, warm neutrals
Composition: centered with 70% negative space right, single subject, clean framing
Motion: implied upward movement, static anticipation, subtle directional pull
```

Spawn all 5 agents in a single parallel call with unique directions each.

### 4. Collect & Synthesize

Wait 60-90 seconds after spawning, then:
1. Check status: `mcp__Swarm__status({ task_name: "simagine-[product-name]" })`
2. Read outputs: `mcp__Swarm__read({ task_name: "simagine-[product-name]" })`

**YOU synthesize the final prompts** by:
- Picking strongest ingredients across all agent outputs
- Combining complementary elements from different directions
- Building coherent Nano Banana Pro prompts using:
  ```
  [Subject from agents] on [Material from agents], [Lighting from agents], [Camera feel], [Palette from agents], [Composition from agents], 16:9, photography-first, no UI, no 3D render, no watermark
  ```

### 5. Final Output

Present **3-5 strongest prompts** with:
- The prompt itself (ready to paste)
- Source ingredients (which agents contributed what)
- Why it works (metaphor, emotional clarity, composition)
- Suggested use case (cover, gallery, logo, background, etc.)

## Key Principles

- **Research before spawning** - understand product/users first
- **Agents = divergent exploration** (brainstorm ingredients only)
- **You = convergent synthesis** (build final prompts from ingredients)
- **Fast effort mode** for speed in exploration
- **Mix ingredients** across agents for novel combinations

---

**Usage**: `/simagine need visuals for @path/to/product`

Research → spawn divergent exploration → synthesize ingredients → deliver final prompts.
