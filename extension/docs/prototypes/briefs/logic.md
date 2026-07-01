# Brief: LOGIC — fill the pure floorModel functions + tests

**Read `_CONTEXT.md` first.** You own the pure, deterministic core the whole webview
keys off. Get this right and everything downstream is easy.

## Owns (only these files)
- `extension/ui/settings/components/mission-control/floorModel.ts` — fill the function
  bodies (types are FINAL, do not change them).
- `extension/ui/settings/components/mission-control/floorModel.test.ts` — NEW, write it.

## Must NOT touch
- Any `.tsx`, any `.css`, anything in `src/`, any other file.

## What to implement (signatures already in floorModel.ts)
Port the logic verbatim from the prototype `factory-floor.html`:
- `derivePhase(input)` → apply precedence `waiting > failed > running > done(unreviewed)
  > done(settled) > idle`. Map real status `running|completed|failed|stopped|idle` +
  `waitingForInput` + `prOpenUnreviewed`. (Prototype phase field :330,342,363-364.)
- `deriveNeeds(phase, prOpenUnreviewed)` = `waiting || failed || (done && unreviewed)`.
  (Prototype `needs`:342.)
- `groupAgents(agents, by)` — dimension accessors mirror prototype `groupKey`:412
  (host / project / status / agent). Return a `Map` preserving a stable key order.
- `sortAgents(agents, by)` — `needs` uses `PHASE_RANK`; `recent`/`tok`/`name` obvious.
  (Prototype sort in `agentsCenter()`:627 and rail row sort :444.)
- `clusterByQuestion(waiting)` — group by `question.clusterKey`; a key with >1 agent is a
  batch cluster, singletons return as `[agent]`. Preserve order. (Prototype `byQ`:629.)
- `toFloorTicket(task: UnifiedTask)` — map: `metadata.identifier ?? id` → id; source
  `linear`→`LN`, `github`→`GH`; priority `medium`→`med` (others pass through, default
  `med`); status `todo`→`todo`, `in_progress`→`in-progress`, `done`→`done` (no `blocked`
  from UnifiedTask, that's ok); `metadata.project ?? metadata.repo ?? ''` → project;
  `description ?? ''`; `metadata.labels ?? []`. (Prototype TICKETS shape :382-395.)
- `groupTickets` / `sortTickets` — mirror prototype `backlogCenter()` `gk`/sort :653-655.
- `parseStructuredQuestion(resp, phase)` — the one heuristic. Return `null` when the text
  is not a question. Otherwise detect:
  - `phase==='failed'` → `{kind:'retry', options:[], text:resp, clusterKey:'retry'}`.
  - destructive: text matches /\b(DROP|DELETE|destructive|prod(uction)?|overwrite|force)\b/
    AND ends in a question → `{kind:'destructive', options:['Confirm','Cancel'], ...}`.
  - explicit "X or Y?" / "X vs Y" / "A) … B) …" / numbered options → `{kind:'choice',
    options:[extracted…]}`. Extract the two/N alternatives as option labels.
  - yes/no confirm ("… merge it?", "… proceed?", "OK to …?") → `{kind:'confirm',
    options:['Confirm','Hold']}`.
  - `clusterKey` = a normalized slug of the question intent so identical questions across
    agents collide (lowercase, strip punctuation/numbers, first ~6 significant words).
  Model shapes on prototype QCLUSTERS:369-379 and the RESP examples :356-362.

## Tests (floorModel.test.ts — real, no mocks)
Cover the logic that would silently break the UI: phase precedence (waiting beats failed
beats running), `clusterByQuestion` collapsing identical keys, `parseStructuredQuestion`
returning the right kind for each of the 4 shapes + `null` for running chatter,
`toFloorTicket` field mapping (esp. medium→med, source + status remap), `sortAgents('needs')`
ordering by PHASE_RANK. Use `bun test`. Skip trivial getters.

## Done =
`bun test` green for floorModel.test.ts AND `bun run compile` passes (no unused throws
left). Commit. Report which behaviors your tests lock down with file:line.
