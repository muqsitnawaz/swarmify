# Brief: COMPONENTS — the presentational Floor pieces

**Read `_CONTEXT.md` first.** You build the self-contained React components the SHELL
agent will mount into the 3-pane layout. Each is pure presentation: it takes typed props
(from `floorModel.ts`) and renders markup that matches the prototype 1:1.

## Owns (create these NEW files, in `extension/ui/settings/components/mission-control/`)
- `FloorSidebar.tsx` — the left scope sidebar. Prototype `buildSidebar()`:563-579.
- `FloorControls.tsx` — top bar (Finder view-switcher icons + Group-by dropdown + stats +
  Plain-language toggle + sidebar/right toggles) and the filter bar (Sort, status/type
  chips, search, Dispatch). Prototype markup factory-floor.html:260-306.
- `FeedItem.tsx` — one agent row in the feed (`feedItem`:608-620) + the `ticketStrip`
  Next-Up teaser row (:621-623). Export both.
- `NeedsYouClusters.tsx` — the batch-triage cluster card (`clusterCard`:598-607).
- `StructuredReply.tsx` — the option-button reply block (`structuredReply`:591-597); used
  inline in feed items and in the right-pane decision block.
- `BacklogCenter.tsx` — the full ticket list with group/sort/filter toolbar +
  `ticketRow` (`backlogCenter`:651-665, `ticketRow`:641-650).
- `TicketDetail.tsx` — right-pane ticket detail + Dispatch panel (`ticketDetail`:666-680).

## Must NOT touch
- `UnifiedAgentsPane.tsx` (SHELL owns it), `floorModel.ts` (LOGIC owns it — you IMPORT its
  types only), `floor.css` (STYLES owns it), anything in `src/`.

## Contract
- Import ALL types from `./floorModel` (`FloorAgent`, `FloorTicket`, `StructuredQuestion`,
  `FloorGroupBy`, `FloorSort`, `CenterMode`, `TicketGroupBy`, `TicketSort`, etc.).
- Each component takes data + callbacks as props; it holds NO data-fetching and NO global
  state. Selection, filter, center-mode etc. are passed in + raised via callbacks, e.g.:
  - `FloorSidebar({ agents, tickets, projFilter, onScope })` where `onScope(v)` routes
    All / `__needs` / `__queue` / a project (prototype `wireSidebar`:580-588).
  - `FeedItem({ agent, selected, plain, onSelect, onReply })`.
  - `NeedsYouClusters({ clusters, onBatchReply, onReplyOne })`.
  - `StructuredReply({ question, phase, onOption, onFreeText, onAttach })`.
  - `BacklogCenter({ tickets, group, sort, srcFilter, projFilter, selectedTicketId, onGroup,
    onSort, onToggleSrc, onSelectTicket, onBackToAgents })`.
  - `TicketDetail({ ticket, onDispatch })` where dispatch carries `{agent, host, mode}`.
  Choose exact prop names that read well; SHELL will wire to them. Keep them obvious.
- **Class names must match the prototype exactly** (`.fitem`, `.head`, `.dot`, `.av`,
  `.who`, `.path`, `.when`, `.resp`, `.nowline`, `.opts`, `.reply2`, `.cluster`, `.ch`,
  `.qq`, `.avs`, `.batchline`, `.sidebar`, `.sb-sec`, `.sb-item`, `.trow`, `.trow2`,
  `.pri`, `.src`, `.tid`, `.tt`, `.tstat`, `.dispatch-panel`, `.dp-row`, `.decide`,
  `.ql`, `.qt`, …). STYLES styles these same names from the same prototype — do NOT invent
  new class names or the styling won't attach. Copy the prototype's class usage verbatim.
- **No literal emoji** (repo rule). The prototype's glyphs: status dot = `<span class="dot
  {phase}">`; the `▸` activity marker, `⚠`, `⚡`, `◷`, paperclip — render via CSS or a
  `lucide-react` icon (e.g. `AlertTriangle`, `Zap`, `Paperclip`, `ChevronRight`). Match the
  look, not the character. `lucide-react` is already a dependency.
- Plain-language: honor a `plain` prop that swaps `tok/s`→qualitative ("fast"/"working"),
  tool counts→"N steps", etc. Prototype `plainTok()`:400 and PLAIN branches in feedItem.

## Done =
`bun run compile` passes (your components typecheck against floorModel + are importable).
Since SHELL mounts them, you can't see them rendered yet — export clean, typed components
and note any prop you expect SHELL to supply. Commit. List each file + its props.
