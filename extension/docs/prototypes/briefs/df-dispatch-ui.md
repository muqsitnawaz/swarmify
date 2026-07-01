# Brief: DISPATCH-UI (ui/) — fill the DispatchPanel + sub-components

Read `df-CONTEXT.md` first. You build the consolidated Dispatch panel React component,
matching `extension/docs/prototypes/dispatch.html` **1:1**. Presentational + local
state only; data + actions arrive as props/callbacks.

## Owns (edit/create only these, in `ui/settings/components/mission-control/`)
- `DispatchPanel.tsx` — fill the stub (keep the exported `DispatchPanelProps`). This is
  the whole panel: express-collapse default + one summary line + Configure/Hide;
  autofocus the context box; `⌘↵` (and Ctrl+Enter) dispatches; Esc closes.
- New sub-component files as you see fit: `dispatchInput.tsx` (chips + context textarea
  + paste/drop attachment tray + @-mention + auto-pick + ranked suggestions),
  `AgentSelect.tsx`, `HostSelect.tsx` (the live-load dropdown + SUGGESTED least-busy +
  busy nudge + cloud cost + offline-disabled), `ProjectSelect.tsx`, `ModeSeg.tsx`
  (Plan/Auto/Edit, default **Auto**), `WatchdogSeg.tsx`, `NotifyBell.tsx` (header bell:
  events incl. Stalled/Plan-ready/Failed, channels, DND/quiet-hours), `BatchToggle.tsx`.

## Must NOT touch
`UnifiedAgentsPane.tsx` (integrator), `FeedItem.tsx`, `floorModel.ts`, `PlanReview.tsx`,
`FailureCard.tsx`, `dispatch.types.ts` (import only), any `.css`, any `src/`.

## Contract
- Import all types from `./dispatch.types`. Props come from `DispatchPanelProps`
  (tasks/agents/hosts/targets/prefill). On dispatch, call `onDispatch(request:
  DispatchRequest)` — build the request from panel state. Do NOT postMessage yourself;
  the integrator wires that.
- **Match the prototype's class names exactly** (`.whatbox`, `.tchip`, `.achip`, `.ctxa`,
  `.wactions`, `.gbtn`, `.suggest`, `.apill`, `.dd`/`.dd-menu`/`.opt`, `.loadbar`,
  `.loadtxt`, `.badge`, `.seg`, `.summary`, `.nudge`, `.bellpop`, `.chk`, `.chan`, etc.).
  STYLES ports the same names into `dispatch.css` — do NOT invent class names.
- No literal emoji: the prototype's ⚡ ▾ 🔔 📎 🖼 → `lucide-react` icons (Zap, ChevronDown,
  Bell, Paperclip, Image) or CSS.
- Paste/drop: the context box is a paste + drag-drop target that adds attachment chips
  (image thumb / file chip). @-mention opens an inline picker. Auto-pick attaches the
  top urgent-bug ticket; suggestions filter live as you type.
- HostSelect: show live load (agents count + idle/free/busy + load bar), SUGGESTED =
  least-busy, cloud rows show costHint, offline hosts disabled. Busy selected host -> a
  one-click nudge to the free host.

## Done
`bun run compile` passes (typechecks against dispatch.types + stubs). You can't see it
mounted (integrator does that) — export clean typed components. Commit. List each file +
its props, and note anything you need the integrator to pass.
