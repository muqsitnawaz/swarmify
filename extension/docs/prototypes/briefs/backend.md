# Brief: BACKEND — cross-host session aggregation (extension host)

**Read `_CONTEXT.md` first.** You are the ONLY agent working in `src/` (the extension
host). Everyone else is in `ui/`. Your job: make the Floor see agents running on OTHER
machines, and expose on-demand rich detail for a remote agent. You send data to the
webview via `postMessage`; you never touch React.

## Owns (create / edit only these)
- `extension/src/core/remoteSessions.ts` — NEW. Pure types + normalize/group (no VS Code
  imports; unit-tested). A `RemoteSession` record: `{ host, sessionId, agentType, cwd,
  project, phase, activity, tokPerSec, waitingForInput, lastResponse, prUrl, ticket,
  branch, sinceMs }` — the cross-host analog of a local agent, shaped so the webview can
  fold it into a FloorAgent. Plus `groupByHost(sessions)` and a `HostGroup` type.
- `extension/src/core/remoteSessions.test.ts` — NEW. Real parse fixtures in `testdata/`.
- `extension/src/vscode/remoteSessions.vscode.ts` — NEW. The SSH fan-out + host discovery.
- `extension/src/vscode/settings.vscode.ts` — ADD new webview message cases only (append
  beside the existing `case 'fetchSessions':` and `case 'getFloorThroughput':`, ~line
  1372-1377). Do not rewrite existing cases.

## Must NOT touch
- Anything in `ui/`, `UnifiedAgentsPane.tsx`, `floorModel.ts`. (Types are mirrored, not
  shared — you define `RemoteSession` in `src/`; SHELL has the matching webview shape.)

## What to build
1. **Host discovery** — enumerate reachable hosts from `~/.ssh/config` Host entries +
   Tailscale MagicDNS (`tailscale status --json` if available). Return a `{name, online}[]`.
   Local machine is always present as `this-mac` (or `os.hostname()`).
2. **Tier-1 active fetch (cheap, O(hosts))** — for each host, run the `agents` CLI over
   SSH to list active sessions as JSON. Follow the existing shell-out pattern:
   `execFileAsync` as used in `src/vscode/linear.vscode.ts:53` and `github.vscode.ts:57`.
   The command shape: `agents sessions --active --json --host <h>` (verify exact flags with
   `agents sessions --help`; if `--host` fan-out is not built into the CLI, SSH directly:
   `ssh <h> agents sessions --active --json`). Run hosts in parallel; wrap each in a
   timeout; a dead host yields `{host, online:false}` — never throw the whole fetch. Cache
   with a short TTL + in-flight guard (mirror the `throughputCache` pattern in
   settings.vscode.ts, ~line 595). Message case: `case 'fetchHostSessions':` → posts
   `{ type: 'hostSessions', hosts, sessions }` back to the webview.
3. **Tier-2 rich fetch (on demand, one agent)** — when the webview asks for a specific
   remote agent, run `agents sessions <id> --host <h> --markdown` (and `--include tools` /
   `tail` as available) and post `{ type: 'hostSessionDetail', host, sessionId, markdown }`.
   Message case: `case 'fetchHostSessionDetail':`.
4. **Normalize** (`remoteSessions.ts`) — parse the CLI JSON into `RemoteSession`. Derive
   `phase`/`waitingForInput`/`activity` the same way local sessions do where possible
   (reuse `src/core/session.activity.ts` — `extractCurrentActivity`, `detectWaitingForInput`,
   `computeOutputTokensPerSec`, `formatActivity`). Unit-test the parse with a captured JSON
   fixture (no live SSH in tests).

## Failure modes to handle (from the review, reviews/kimi.md §4)
Host offline/slow → mark offline, don't hang. Clock skew → carry the host-reported time.
Duplicate agent names across hosts → keep host in identity. Stale data → include a
`fetchedAt` so the UI can show freshness.

## Done =
`bun run compile` + `bun test` green. Verify the real flow: run your `fetchHostSessions`
path against at least the local host (and a real remote if one is reachable — e.g. a host
in `~/.ssh/config`) and quote the actual JSON you got back. If no remote is reachable,
say so and prove the local path + graceful-offline path work. Commit. Report the exact
CLI command + a sample of real output.
