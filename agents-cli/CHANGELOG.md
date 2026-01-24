# Changelog

## 1.5.1

- Update check: Shows prompt when new version available
- What's new: Displays changelog after upgrade
- `skills view`: Interactive skill selector (renamed from `info`)
- Fixed `--version` showing hardcoded 1.0.0 (now reads from package.json)
- Silent npm/bun output during upgrade

## 1.5.0

**Pull command redesign**

- Agent-specific sync: `agents pull claude` syncs only Claude resources
- Agent aliases: `cc`, `cx`, `gx`, `cr`, `oc` for quick filtering
- Overview display: Shows NEW vs EXISTING resources before installation
- Per-resource prompts: Choose overwrite/skip/cancel for each conflict
- `-y` flag: Auto-confirm and skip conflicts
- `-f` flag: Auto-confirm and overwrite conflicts
- Graceful cancellation: Ctrl+C shows "Cancelled" cleanly

## 1.4.0

- Conflict detection for pull command
- Bulk conflict handling (overwrite all / skip all / cancel)

## 1.3.13

- Enabled skills support for Cursor and OpenCode
- Fixed Cursor MCP config path (now uses mcp.json)

## 1.3.12

- Fixed MCP detection for Codex (TOML config format)
- Fixed MCP detection for OpenCode (JSONC config format)
- Added smol-toml dependency for TOML parsing

## 1.3.11

- Status command shows resource names instead of counts
- Better formatting for installed commands, skills, and MCPs

## 1.3.0

- Added Agent Skills support (SKILL.md + rules/)
- Skills validation with metadata requirements
- Central skills directory at ~/.agents/skills/

## 1.2.0

- Added hooks support for Claude and Gemini
- Hook discovery from shared/ and agent-specific directories
- Project-scope hooks support

## 1.1.0

- Added MCP server registration
- Support for stdio and http transports
- Per-agent MCP configuration

## 1.0.0

- Initial release
- Pull/push commands for syncing agent configurations
- Slash command management
- Multi-agent support (Claude, Codex, Gemini, Cursor, OpenCode)
