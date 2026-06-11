# Changelog

## [0.9.245] - 2026-06-10

### Fixed
- Foreman orb flashed a red "ffplay: [2K" error on every spoken reply: ffplay prints its playback status clock to stderr even at `-loglevel error`, and the unfiltered stderr reporter promoted it to an error status. Playback now runs with `-nostats`, so stderr stays silent unless something is genuinely wrong.

### Added
- E2E test that pipes PCM through the exact production ffplay command and requires a silent stderr and clean exit.

## [0.9.244] - 2026-06-09

### Fixed
- Foreman answered itself in a loop on long replies: the anti-echo mic gate was keyed to audio delta arrival (OpenAI streams a 10s answer in ~2s), so the mic reopened mid-playback and the assistant's own voice came back as user input. The gate now runs on a playback clock that accounts for each queued chunk's real play duration.
- Foreman narrated the same ground twice when one question triggered two tool calls: every tool result fired its own `response.create`. Responses are now serialized — one in flight, deferred creates coalesce into a single follow-up response.

## [0.9.243] - 2026-06-09

### Fixed
- Foreman voice orb mic capture was dead: the ffmpeg avfoundation command used `-sample_rate`/`-channels` input options that ffmpeg 8 rejects, so the process exited before capturing a byte — and the stderr keyword filter swallowed the error. The orb now captures from the macOS default input (`:default`), which follows AirPods and other device switches automatically, and resamples to 24kHz on the output side.
- Foreman audio failures are no longer silent: all ffmpeg/ffplay stderr, spawn, and exit events surface in the orb's event overlay and status line.
- Start/stop race: a quick stop while the realtime session was still connecting could orphan the mic and WebSocket; sessions are now generation-guarded.

### Added
- Press-and-hold push-to-talk on the Foreman orb: hold to talk for the duration of the press, release to end. Tap still toggles start/stop.
- Silent mode toggle below the Foreman orb: replies arrive as text-only transcript with playback dropped; togglable mid-session.
- Speaker-path diagnostics in the event overlay (`speaker.spawn`, `speaker.write`, `speaker.written`, `speaker.stderr`, `speaker.exit`).
- E2E test that spawns the exact production ffmpeg capture command and requires real PCM on stdout, plus a live OpenAI Realtime GA handshake test.
- Factory floor UX: Cmd+K composer with task attachment, draggable issue cards, bare repo chips, QuickDispatch restore.
- Peer agent messaging via a new `send_to_agent` MCP tool on the watchdog server. Address by `sessionId`; recipient sees the text typed directly into its terminal prompt via `vscode.Terminal.sendText`. Self-send is rejected. 2000-char cap. Logged to `~/.agents/peer-messages.log`.
- On activation the extension registers the watchdog MCP server in each supported agent's user-scope config (Claude + Gemini) so peer terminals can call `send_to_agent`. Idempotent — skips agents whose CLI is missing or that already have a `watchdog` entry.

## [0.9.231] - 2026-05-31

### Changed
- Marketplace listing: cleaned up redundant link clutter at the top of the description.
- Marketplace metadata: categories are now `AI` / `Machine Learning` / `Programming Languages` (was `Other`), with explicit keywords for discoverability.
- Display name is now `Swarmify — Multi-Agent IDE` so the brand and the keyword both rank.

## [0.9.230] - 2026-05-31

### Added
- Bench task cards now surface staleness at a glance: a left-edge ribbon tints amber / orange / red as a task ages past one cycle (7d / 14d / 30d).
- Overdue tasks show a red "Overdue Nd" chip beside the labels; upcoming tasks show "Due in Nd" or "Due Mon D".
- Task age timestamp inherits the same tier color so the card reads consistently top-to-bottom.
- Calendar timeline visualises the full work window — created day glows neon green, the cells from created → due fade up in green intensity toward the due date, the due cell gets a bright ring, and when overdue the burn-down from due → today fills with a deepening red ramping to a glowing red square on today.
- Calendar legend gains a Due / Overdue swatch alongside Created / Cycle / Today.
- GitHub Copilot CLI is now a first-class agent: the foreman registry recognises the `CP` terminal-ID prefix and the names `copilot` / `cp`, recap reads `prompts/copilot/commands/recap.md`, sessions resolve from `~/.copilot/session-state/<id>/events.jsonl`, and the settings filter accepts `copilot` configurations.

### Changed
- `UnifiedTask.metadata` now forwards `dueDate` from Linear into the webview (data was already fetched, just not piped through).

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
