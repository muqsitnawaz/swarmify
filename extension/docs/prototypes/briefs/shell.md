# Brief: SHELL — restructure UnifiedAgentsPane into the 3-pane shell + wire everything

**Read `_CONTEXT.md` first.** You run LAST (after LOGIC, COMPONENTS, STYLES) so their
files exist. You own the integration file. You turn today's card-grid Floor into the
prototype's 3-pane shell, build the adapter from real data to `FloorAgent`, and wire the
components + interactions.

## Owns (only this file)
- `extension/ui/settings/components/mission-control/UnifiedAgentsPane.tsx`
- You MAY add a small `floorAdapter.ts` next to it if the adapter is large — but keep the
  view-model TYPES coming from `floorModel.ts`.

## Must NOT touch
- `floorModel.ts` (import only), the component files (import + mount only), `floor.css`,
  anything in `src/`.

## Current state (origin/main — re-derive exact line numbers, they shift)
- Root component `UnifiedAgentsPane(props)` returns `<div className="sw-floor-dashboard">`
  — a flat vertical stack: intake section, Next-Up queue, Active block (`.sw-floor-active`
  = a `380px 1fr` master/detail grid rendering `<AgentCard>` list + `<DetailPane>`), empty
  state, then modals. `useStableList` (identity-stable list) is ~line 418, used ~line 680.
- Data is already derived in memos: `buildUnifiedList` (terminals+tasks → `UnifiedAgent[]`),
  `activeItems`, `recentItems`, `queueTasks`, and `props.unifiedTasks` (the Linear/GitHub
  `UnifiedTask[]`). Reuse these — do not refetch.
- `DetailPane` / `TerminalExpandedDetail` / `AgentDetailView` render the rich progress view
  (activity, files, tools, tok/s). Reuse these inside the right pane's progress section.
- Dispatch already works: webview posts `{type:'dispatchTask', ...}` (see the existing
  `onDispatch` prop + `dispatchTask` handler in settings.vscode.ts). Reuse it for the
  backlog Dispatch panel and structured-reply sends.
- The `QuickDispatch` composer (⌘K) and the modals must keep working — carry them over.

## What to build
1. **Adapter** `UnifiedAgent[] → FloorAgent[]`: map fields (agentType→abbr, displayName→
   name, activity→verb/target via the existing formatting, status+waiting→`derivePhase`,
   `deriveNeeds`, prUrl→pr, linearIssue→ticket, host='this-mac' for local). Derive
   `project` from cwd/repo (fold worktrees to their repo). Parse `resp`→`question` via
   `parseStructuredQuestion`. And `props.unifiedTasks.map(toFloorTicket)` → `FloorTicket[]`.
   Use the LOGIC functions from `floorModel.ts`; do not reimplement them.
2. **Merge cross-host**: on mount, post `{type:'fetchHostSessions'}`; on `hostSessions`
   message, fold BACKEND's remote `RemoteSession`s into the FloorAgent list (host set to the
   remote name). If the message never arrives, the local-only Floor must still fully work.
3. **Restructure the render** to the prototype 3-pane (`factory-floor.html` `renderFeed`
   :681-697): replace the `.sw-floor-dashboard` body with
   `<div class="page"> <FloorSidebar/> <div class="feed-col">{center}</div> {RIGHT &&
   <div class="detail-col">{detail}</div>} </div>`, plus the top bar `<FloorControls/>`.
4. **Center-mode state** `CENTER: 'agents' | 'backlog'` (+ `SELECTED`, `SELECTED_TICKET`,
   `PROJ_FILTER`, `groupBy`, `sort`, `PLAIN`, `SIDEBAR`, `RIGHT`). Persist `pinned` set,
   `PLAIN`, `SIDEBAR`, `RIGHT`, `groupBy` in VS Code globalState via the existing
   webview-state mechanism (grep how other panes persist).
   - `CENTER==='agents'`: render Next-Up teaser (top tickets) → `<NeedsYouClusters/>` (from
     `clusterByQuestion(needsAgents)`) → Live Activity (`<FeedItem/>` per active agent).
     Right pane = decision block (`<StructuredReply/>` when `selected.needs`) + the reused
     rich `DetailPane` progress. Prototype `agentsCenter()`:624-640, `detailRight()`:699-714.
   - `CENTER==='backlog'`: `<BacklogCenter/>` in center; `<TicketDetail/>` (with Dispatch
     panel) in the right pane. Prototype `backlogCenter()`:651-665, `ticketDetail()`:666-680.
5. **Wire interactions**: sidebar scope routing (All / Needs-you / Backlog / project),
   view-switcher (Feed is primary; the other three icons may route to today's existing
   layouts as a stopgap — note it), group-by/sort, filter chips, structured-reply option
   clicks → dispatch/reply postMessage, backlog Dispatch → `dispatchTask`, Plain toggle,
   sidebar/right toggles, screenshot attach (stub the attach to a TODO if the transport
   isn't ready — do not fake success).
6. Keep `useStableList`, memoized rows, and the visibility-gated throughput poll — do not
   regress the perf work from #103.

## Done =
`bun run compile` + `bun test` green, THEN verify the REAL webview: build the vsix
(`bash scripts/install.sh <version>` or `bun run compile` + package) and hot-load into
VSCodium; open the Factory Floor; confirm the 3-pane renders, Needs-You clusters show,
selecting an agent opens the right-pane decision+progress, switching to Backlog lists
tickets and the Dispatch panel dispatches. Screenshot it (CDP or the app). Report exactly
what you saw render, with the screenshot path. If a surface can't be verified, say so.
