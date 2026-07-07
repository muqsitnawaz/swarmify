# Changelog

## [0.9.284] - 2026-07-07

### Fixed
- **Backlog "Group by Project" showed a blank `· N` header.** The webview's `UnifiedTask.metadata` had dropped the Linear `project` field that the host already populates, so `toFloorTicket` fell back to the repo and grouped project-less tickets under an empty key. It now uses the real Linear project (repo fallback), and every group axis (project/host/status/…) coalesces an empty key to a human label (`Unlabeled`, `Unknown host`) so a header is never blank (#148).
- **"Needs You" cards were identical and contextless.** `RawActiveSession` declared none of the nested `worktree`/`pr`/`preview`/`ticket` objects the CLI emits, so `normalizeActiveSession` silently dropped the worktree slug, the live preview (activity line), the structured ticket id, and the real branch — remote/worktree cards showed only "Edit <file>" + a status word. The card now reads `project · host · worktree · ticket` with a real task line, so two sessions in one repo are distinguishable (#148).
- **Clicking an agent card did nothing.** `selectFloorAgent` set the selection but never opened the detail rail the way its twin `onSelectHost` did. Fixed, and the rail gained an actions row: Focus terminal (local + remote via `ssh`/`tmux attach`), Reveal worktree, Open PR (#148).

### Added
- **Group-by control on the Floor top bar.** The unused `groupAgents` is now wired into a delineated `Group` dropdown (None/Project/Host/Status/Agent) matching the Backlog's control; `NEEDS YOU` stays pinned above any grouping (#148).
- **Empty host shows RECENT sessions** instead of a blank pane — a host filter with 0 live agents lazily fetches that host's recent sessions and renders them through the same card path (paired with the agents-cli `sessions --json --host` clean-array change; degrades to an empty section until that ships) (#148).

### Changed
- **Single `src/shared/` module** (`tasks.ts`, `project.ts`) is now the one source of truth for the task + project types and `resolveProject`/`normalizeHost`, imported by BOTH the extension host and the webview (via a new `@shared` alias) instead of hand-mirrored across the postMessage boundary — the drift that caused the blank-project bug is now structurally impossible. The vite build fails on a `MISSING_EXPORT` originating in `src/shared` (#148).

## [0.9.252] - 2026-06-28

### Performance
- **Symlink-on-open no longer storms ripgrep + lstat.** The `.agents` context-file symlinker now debounces watcher events, runs fully async, caches the recursive `findFiles` glob behind a short TTL + in-flight guard, and skips the whole pass when the mapping set is unchanged. Concurrent passes (activation loop + watchers) are coalesced onto one run, closing an `EEXIST` race where two passes fought over the same symlink (#98, #99, #100).
- **Steady-state hot paths cached/gated.** Per-session tool-stats subprocess is cached by session-file mtime+size with in-flight coalescing; cloud-runs fetch gets a 5s TTL + async token read (no sync FS read on the main thread); per-iteration terminal debug logs are gated behind `SWARMIFY_DEBUG_TERMINALS`; kill/restart correlation caches each terminal's process start time at registration instead of spawning `pgrep` + `ps` per dormant terminal on every session-file event (#94, #95, #96, #97).

### Added
- **Activation verification + registry liveness** in the release/install scripts: detect editor windows still running stale extension code, and poll the marketplace/Open VSX until the just-published version is actually being served (#93).

## [0.9.250] - 2026-06-24

### Fixed
- **User-opened shell tabs no longer have their environment scrubbed.** The credential/infra env-var scrub (added in 0.8.x to protect against a prompt-injected agent shelling out) was also stripping keys from plain `Shell` tabs that the user drives directly with no agent attached. `buildAgentTerminalEnv` now takes a `scrubSensitive` option: agent terminals still scrub (default `true`), but `sh`-prefixed / `shell` tabs inherit the user's normal environment, credentials included. Applied at spawn (`openSingleAgent`) and on restore (`restoreAgentTerminals`).
- **Release script could not read marketplace tokens.** `scripts/release.sh` now calls `agents secrets export vs-marketplace --plaintext`; without `--plaintext` the export emitted no values and publishing failed.

## [0.9.249] - 2026-06-18

### Added
- **Per-strategy launch trio** for every version/account-managed agent (Claude, Codex, Gemini, Cursor, Antigravity). Each now exposes three explicit command-palette entries instead of one rotating default plus a version picker:
  - **New X (Latest)** — resolves the newest installed version and launches it pinned (`agents run X@<newest> --interactive`), no prompt. Picks the highest version numerically, so `2.1.181` wins over `2.1.170` even when an older build is the pinned default.
  - **New X (Balanced)** — forces `--strategy balanced` so the agents-cli rotates across healthy signed-in accounts regardless of the ambient `agents.yaml` setting.
  - **New X (Pinned)** — interactive version picker (the former "Pick Version"), launches the chosen version pinned.
- **Antigravity** joins the version/account-managed agents: its launch now routes through `agents run antigravity` (the managed `agy` CLI) instead of the bare binary, so it gets the same version pinning and strategy control as the other agents.

### Changed
- "New X (Pick Version)" command titles renamed to "New X (Pinned)" for Claude, Codex, Gemini, Cursor, Antigravity, and the unified "New Agent" picker. Command IDs are unchanged, so existing keybindings keep working. The primary "New X (CC/CX/...)" entry is untouched.

## [0.9.248] - 2026-06-13

### Added
- Dispatch modal gains a **Comments** field — free-text context, constraints, or handoff notes appended to the agent's prompt as `Additional instructions:`. Threaded end-to-end through local, Rush Cloud, and Codex Cloud dispatch, and preserved across the repo/owner fallback pickers.
- Bench page now opens the full dispatch modal **inline** (model, run target, repositories, branch, notify, comments) instead of bouncing to the Floor tab. Floor and Bench share one `TaskDetailModal`.

## [0.9.247] - 2026-06-11

### Fixed
- Foreman recited raw tool output aloud ("1) Claude: ... 2) Another Claude, no label ..."): the briefing handed the model up to 30 agent rows of mostly-null JSON, and the model read them back item by item. The briefing now sends at most 6 detailed agents (the ones with a real task, label, or tool activity), folds the rest into a pre-aggregated count, omits empty fields entirely, and truncates session UUIDs to 8 chars. The system prompt adds voice-delivery rules: name at most 3 items aloud, aggregate the rest, never verbalize missing data.

## [0.9.246] - 2026-06-10

### Added
- Delete button on Foreman transcript messages: hover a line and click the x to remove that utterance from the conversation context server-side (`conversation.item.delete`), so a mis-transcription stops steering follow-up answers. The line disappears from the transcript too.
- E2E test against the live Realtime API: create a conversation item, delete it with the exact payload the button sends, require `conversation.item.deleted` back.

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
