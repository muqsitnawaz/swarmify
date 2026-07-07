# Code migration: swarmify → agents-cli/apps/factory

**Status: this repository is deprecated as of 2026-07-07.**

The Agents extension (`swarm-ext`, publisher `swarmify`) is no longer developed
here. Its source now lives inside the [`agents-cli`](https://github.com/muqsitnawaz/agents-cli)
monorepo and is built and released from there. The published VS Code / Cursor
extension is unchanged for users — only the source of truth moved.

## Where the code went

| Was (this repo) | Now (`agents-cli`) |
| --- | --- |
| `extension/` | [`apps/factory/`](https://github.com/muqsitnawaz/agents-cli/tree/main/apps/factory) |
| `extension/src/` | `apps/factory/src/` |
| `extension/ui/` | `apps/factory/ui/` |
| `extension/scripts/` | `apps/factory/scripts/` |
| `extension/AGENTS.md` | `apps/factory/AGENTS.md` |
| `extension/CHANGELOG.md` | `apps/factory/CHANGELOG.md` |
| `@swarmify/agents-cli` (already moved earlier) | `@phnx-labs/agents-cli` — `apps/cli/` |

The extension keeps its identity: package `swarm-ext`, publisher `swarmify`. The
npm/marketplace package is **not** deprecated — it continues to ship, just from
`agents-cli/apps/factory`.

## Parity at the time of the move

`apps/factory` was kept in sync with `extension/` through a series of parity-sync
commits and is fully caught up as of the last swarmify commit
[`e324a2f`](https://github.com/muqsitnawaz/swarmify/commit/e324a2f) ("5 visibility
fixes + shared-type architecture hardening", #148). Beyond parity, `apps/factory`
carries additional work that never landed here — notably tmux-by-default terminals
(`agents.terminalMode: auto | tmux | native`) with per-terminal tmux pane (`%N`)
and editor-tab index surfaced as the pane handle and "viewing in <tab>" on Factory
Floor cards.

## Where to go now

- **Issues / PRs:** open against [`agents-cli`](https://github.com/muqsitnawaz/agents-cli).
- **Build / release the extension:** `agents-cli/apps/factory` (`scripts/release.sh`).
- **The `agents` CLI engine the Factory Floor runs on:** `agents-cli/apps/cli`
  (`@phnx-labs/agents-cli`).
