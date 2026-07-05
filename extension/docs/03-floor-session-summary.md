# 03 -- Factory Floor: per-session summary (Phase 0 implementation plan)

Status: **Ready to implement.** The summary-first slice of the event-stream
direction (`02-floor-event-stream.md`), deliverable without the rearchitecture.

## Goal

Show, per agent session, a **summary of what it is doing** -- status + recent
messages / tool calls -- grouped by a stable session id. Do it by reusing what
already exists, not by building new summary machinery.

## What already exists (do not rebuild)

- `extractSessionQuickDetails()` (`src/core/session.summary.ts`) returns
  `SessionQuickDetails { summary, recentToolCalls, recentFiles, recentTools,
  lastFilePath }`.
- `terminals.vscode.ts:1000-1162` already calls it and ships the result on
  `TerminalDetail` as `quickSummary`, `recentToolCalls`, `recentFiles`,
  `recentTools`, `lastFilePath`. **Local sessions already carry a summary + recent
  tool calls over the wire** (in `allTerminalsData`).
- The per-session detail surface exists: `SwarmDetailPane.tsx` (an "Activity
  stream") and `renderAgentDetail` in `UnifiedAgentsPane.tsx`.
- The full transcript is on-demand already: `fetchHostSessionDetail` ->
  `hostSessionDetail` (`settings.vscode.ts:1755`).

So the gaps are only: (1) no canonical grouping key, (2) the Floor does not surface
the summary it already receives, (3) remote sweep rows are not enriched.

## Steps

### 0a -- canonical `sessionKey()` (pure, testable)

- Add `sessionKey(input)` to `ui/settings/components/mission-control/floorModel.ts`
  (pure, mirrors the shape in `02`): prefer the CLI session UUID; namespace remote
  by host; fall back to a `provisional:` key on the local terminal / cloud / agent id
  when the UUID is not yet known.
- Use it as the `FloorAgent.id` in `floorAdapter.ts` (both `toFloorAgentFromUnified`
  and `toFloorAgentFromRemote`) and to replace the `localTabSessionIds` hand-dedup in
  `UnifiedAgentsPane.tsx:1039-1057` (same key -> one row, regardless of origin).
- Tests in `floorModel.test.ts`: same session via local tab + remote sweep collapses
  to one key; provisional key re-keys once the UUID appears; remote keys namespaced by
  host do not collide across hosts.

### 0b -- surface the summary in the per-session view (local; data already flows)

- Thread the existing `TerminalDetail.quickSummary` + `recentToolCalls` through
  `buildUnifiedList` (`UnifiedAgentsPane.tsx`) onto the local `UnifiedAgent`, then
  through `floorAdapter.ts` onto `FloorAgent` (add `summary: string` and
  `recent: RecentToolCall[]` to the `FloorAgent` view-model in `floorModel.ts`).
- Render a grouped per-session summary in `SwarmDetailPane.tsx` / `renderAgentDetail`:
  the `summary` line + a short list of `recent` tool calls (reuse the existing
  activity-stream markup). Optionally show the top recent call inline on the feed card.
- No backend change -- purely threading data the host already sends.

### 0c -- extend the summary to remote sweep rows (best-effort)

- Remote rows are status-only today (`enrichWithSessionContent` runs only for
  `isLocal`, `remoteSessions.vscode.ts`). For Phase 0, surface what we already have
  (`RemoteSession.topic` / `lastResponse`) as the summary line so remote sessions are
  not blank.
- A *true* remote summary (recent tool calls) needs the remote session content, which
  is the Tier-2 fetch -- defer richer remote enrichment to the phase that adds a remote
  last-activity epoch (`02` phase 5). Note this explicitly in the UI (remote = summary
  only, open for detail).

## Non-goals (Phase 0)

- No `FloorEventBus`, no `ingestSeq`, no reducer rewrite -- that is `02` phases 1-5.
- No new transcript storage in the webview -- full thread stays the Tier-2 fetch.

## Verification

- `bun run compile` clean; `bun test` for the new `sessionKey` tests.
- Open the Floor: a running local agent shows a summary + its recent tool calls in the
  detail pane, grouped by session; the same session opened as a tab and reported by the
  sweep shows once (dedup by `sessionKey`); a remote row shows its topic as a summary.
