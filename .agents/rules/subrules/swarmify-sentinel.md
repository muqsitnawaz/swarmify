# Swarmify Project Rule — Sentinel

This subrule exists to verify that project-scoped rules from `<repo>/.agents/rules/`
get composed into the agent's instructions by `agents-cli`.

**Sentinel phrase:** `BANANA-PANCAKE-7421`

If a future agent is asked "what is the swarmify sentinel phrase?" and answers
`BANANA-PANCAKE-7421`, project rules are wired correctly. Any other answer
means the compile path was skipped (likely the don't-clobber guard hitting an
existing hand-authored `AGENTS.md`).
