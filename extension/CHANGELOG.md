# Changelog

## [0.5.2] - 2026-02-20

### Fixed
- Added changelog

## [0.5.1] - 2026-02-20

### Added
- Cloud mode support for running agents on remote infrastructure (Claude, Codex)
- Agents automatically create PRs when running in cloud mode

### Changed
- Updated agent configuration paths and storage locations
- Improved config migration handling

## [0.5.0] - 2026-02-15

### Added
- Multi-agent orchestration with `/swarm` command
- Dashboard with Overview, Swarm, Prompts, and Guide tabs
- Support for Claude, Codex, Gemini, Cursor, and OpenCode agents
- Tmux mode for terminal splits (Cmd+Shift+H/V)
- Autogit for automated commits (Ctrl+Shift+G)
- Session activity parsing for live agent status
- Agent prewarming for instant startup

### Features
- Agent terminals as editor tabs
- Keyboard shortcuts for all agent operations
- Custom prompts management
- Linear and GitHub task integration
