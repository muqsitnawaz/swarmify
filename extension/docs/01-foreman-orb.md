# Foreman Orb

A voice coordinator that lives as an ambient, always-present overlay inside the Factory webview. Tap the orb, ask the factory floor a question, listen. Go silent for a minute and it hibernates.

## Overview

```
+-----------------------------------------------------------------------------+
|                      Factory Webview (webview panel)                        |
|                                                                             |
|  +-----------------------------------------------------------------------+  |
|  |  TopBar:  [Floor] [Bench] [Panel]                     search  settings|  |
|  +-----------------------------------------------------------------------+  |
|                                                                             |
|  +-----------------------------------------------------------------------+  |
|  |                                                                       |  |
|  |    Active-tab content (Floor / Bench / Panel) scrolls under the orb   |  |
|  |                                                                       |  |
|  |                                              YOU:  "sitrep"           |  |
|  |                                              FRMN: "Claude on auth,   |  |
|  |                                                     Codex on handoff."|  |
|  |                                                                       |  |
|  |                                                      .---.            |  |
|  |                                                     ( ~~~ )  <-- orb  |  |
|  |                                                      `---'            |  |
|  +-----------------------------------------------------------------------+  |
|                                                                             |
|  +-----------------------------------------------------------------------+  |
|  |  StatusBar:  1 active  .  7 agents running                            |  |
|  +-----------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------+
```

The orb is a single React component mounted unconditionally at the root of the
Factory app. It floats `position: fixed; bottom: 44px; right: 16px` so the
right margin and the margin above the StatusBar are both 16px (the StatusBar
is 26px tall plus a 2px top border; 44 = 28 + 16).

A webview cannot draw pixels outside its host container, so the orb is visible
only while the Factory tab is focused. See
[Design rationale](#design-rationale) for why that is the deliberate scope.

## Architecture

Two processes, two concerns. The UI lives in the webview sandbox. The audio
pipeline lives in the extension host (Node.js) because VS Code webviews block
`getUserMedia` and cannot spawn `ffmpeg`.

```
+-----------------------------------------------------------------------------+
|  Webview (React, sandboxed iframe)                                          |
|                                                                             |
|  +-------------------+                                                      |
|  |  ForemanOrb.tsx   |<----- postMessage('foreman.status'       )-----+     |
|  |                   |<----- postMessage('foreman.transcript'   )---+ |     |
|  |  - 5 visual states|                                              | |     |
|  |  - transcript UI  |------> postMessage('foreman.startSession') --+-|-+   |
|  |  - idle timer     |------> postMessage('foreman.stopSession' ) --+-|-|-+ |
|  +-------------------+                                              | | | | |
+-----------------------------------------------------------------------|-|-|-+
                                                                        | | | |
              +---------------------------------------------------------+ | | |
              |                                                           | | |
              v                                                           | | |
+-----------------------------------------------------------------------------+
|  Extension Host (Node)                                                  | | |
|                                                                         | | |
|  +---------------------------+        +-----------------------------+   | | |
|  |  settings.vscode.ts       |<-------|  foreman.vscode.ts          |   | | |
|  |  (webview bridge)         |        |  - system prompt            |   | | |
|  |  case 'foreman.startSession' -> startForemanAudio(apiKey, events) |<--+ | |
|  |  case 'foreman.stopSession'  -> session.close()                   |<--+-+ |
|  +-------------+-------------+        +--+--------------------------+   |   |
|                |                         |                              |   |
|                |                         | runForemanTool(name,args)    |   |
|                |                         v                              |   |
|                |             +-----------+----------+                   |   |
|                |             | foreman.digest.ts    |                   |   |
|                |             | foreman.sources.ts   |                   |   |
|                |             | foreman.registry.ts  |                   |   |
|                |             +----------------------+                   |   |
|                v                                                        |   |
|   +------------+---------------+                                        |   |
|   |  foreman.audio.ts          |                                        |   |
|   |                            |   24kHz PCM16 mono                     |   |
|   |  ffmpeg (mic)  ----------->|---> WS input_audio_buffer.append       |   |
|   |                            |                                        |   |
|   |                            |   24kHz PCM16 mono                     |   |
|   |  ffplay (speaker) <--------|---- WS response.audio.delta            |   |
|   +------------+---------------+                                        |   |
|                |                                                        |   |
|                | wss://api.openai.com/v1/realtime?model=gpt-realtime   |   |
+----------------+--------------------------------------------------------+---+
                 |
                 v
       OpenAI Realtime API (server-side VAD, tool calls, TTS)
```

## Design Rationale

The old Foreman was a tab in the Factory, sitting alongside Floor/Bench/Panel.
Reaching it cost three clicks (Dashboard -> Foreman tab -> Start), the
transcript ate the whole viewport, and once the user switched back to their
code there was no anchor pointing back to it. In practice it stayed unused.

### Two lenses

Through the intuitive-design skill (see
`~/.agents/skills/intuitive-design/SKILL.md`), the old flow failed on:

- **Point-of-need (buried)**: the voice affordance had no visible anchor when
  the user was looking at anything other than the Foreman tab.
- **Point-of-need (wrong anchor)**: the transcript rendered in a tab the user
  had abandoned; their attention was elsewhere.
- **Anticipation (forced re-invocation)**: three clicks per summon, every
  summon, with no state carried forward.

The orb fixes all three by collapsing the Foreman to a single ambient object
that is visible alongside whatever Factory tab the user has open.

### Why not float over the whole IDE

The Siri analogy breaks at the OS boundary. VS Code extensions have exactly
four surfaces that render pixels:

| API | Where pixels go | Used here |
|---|---|---|
| `createWebviewPanel` | inside an editor tab | yes -- the Factory |
| `registerWebviewViewProvider` | docked pane (activity bar / bottom panel) | no |
| `createStatusBarItem` | status bar row only, text + one codicon | yes (for "Agents") |
| `createTextEditorDecorationType` | anchored to text positions in the editor | no |

A webview is a sandboxed iframe. `position: fixed` positions relative to that
iframe, not the VS Code window. There is no API that lets an extension draw a
blob over the editor or terminal. The orb is therefore webview-scoped on
purpose: ship the ambient-presence pattern now, within the only surface where
a real animated blob can live, and accept the tradeoff that the orb is
invisible while the Factory tab is unfocused.

An optional Phase 2 -- a `WebviewView` docked into the activity bar, plus a
status bar entry that summons it -- would make the orb reachable from any IDE
surface. That is not built yet.

## User-Facing Lifecycle

```
            tap orb                    speak                   60s silent
   .---.  -----------.  .---.   .-----------------.   .---.   .-----------.
  ( idle )    ==>   ( conn )==>( listen -> speak )==>( idle )==>(  off  )
   `---'              `---'     `-----------------'   `---'     `-------'
                                                                    ^
                                                                    |
  tap orb  <-----------------------------------------------------   |
                                                                    |
  any transcript event (user or assistant) resets the idle timer ---+
```

A turn:

1. Tap idle orb. Orb scales up, pulses quickly (`connecting`).
2. WS opens, session config sent, ffmpeg starts streaming mic. Orb breathes
   (`listening`).
3. User speaks. User's transcribed words appear beside the orb as they finish.
4. Server-side VAD detects end-of-turn, model responds. Transcript streams in,
   speaker plays PCM deltas, orb pulses fast (`speaking`).
5. After the response, orb returns to breathing (`listening`). Idle timer
   starts counting from the last transcript event.
6. At 50s of silence the orb dims and shows "Sleeping in Ns -- tap to keep".
7. At 60s the orb issues `foreman.stopSession` and returns to `idle`. Mic and
   speaker processes terminate.

## Visual State Machine

Five states, one visual vocabulary (same SVG, different CSS animation).

| State | Trigger | Blob | CSS class | Animation |
|---|---|---|---|---|
| `idle` | no session, or session closed | 40px, subtle glow | `foreman-orb-svg-idle` | slow breathe (3.4s) |
| `connecting` | `foreman.status=connecting` | 56px, pulsing | `foreman-orb-svg-connecting` | fast pulse (0.7s) |
| `listening` | `connected`, last transcript > 1.5s ago or from user | 56px, breathing + ripple | `foreman-orb-svg-listening` | breathe (1.6s) + ripple (2.2s) |
| `speaking` | `connected`, last assistant transcript within 1.5s | 56px, amplitude wave | `foreman-orb-svg-speaking` | speak pulse (0.52s) |
| `hibernating` | `connected`, >=50s since last transcript | 40px, dimmed 55% opacity | `foreman-orb-svg-hibernating` | slow breathe (2.8s) |

The `activity` sub-state (`listening` vs `speaking`) is inferred from the
`role` field of the last `foreman.transcript` event, with a 1.5s decay back to
`idle` after the last event
(`ForemanOrb.tsx:44-50`, `SPEAKING_DECAY_MS`).

The animations are defined in `extension/ui/settings/index.css:375-405` as
six `@keyframes` (`foreman-breathe`, `foreman-pulse`, `foreman-inner-pulse`,
`foreman-speak`, `foreman-speak-inner`, `foreman-ripple`). Each state composes
one or two of them onto the `.foreman-orb-outer`, `.foreman-orb-inner`, and
`.foreman-orb-ring` SVG elements. `@media (prefers-reduced-motion: reduce)`
disables every animation
(`index.css:474-486`).

## Message Protocol

Three inbound messages, two outbound. All sent via
`webview.postMessage` / `vscode.postMessage`.

### Webview -> Host

```
ForemanOrb.tsx:89        vscode.postMessage({ type: 'foreman.startSession' })
ForemanOrb.tsx:55,93     vscode.postMessage({ type: 'foreman.stopSession'  })
```

### Host -> Webview

```
settings.vscode.ts:1388  webview.postMessage({
                           type: 'foreman.status',
                           status: 'connecting'|'connected'|'closed'|'error',
                           detail: string | undefined,
                         })

settings.vscode.ts:1391  webview.postMessage({
                           type: 'foreman.transcript',
                           role: 'user' | 'assistant',
                           text: string,          // delta for streaming, full string when final=true
                           final: boolean,
                         })
```

The dispatcher is `case 'foreman.startSession':` at
`settings.vscode.ts:1377-1409` and `case 'foreman.stopSession':` at
`settings.vscode.ts:1411-1415`. Starting a session while one is already open
closes the old one first.

### State fan-out inside the orb

```
ForemanOrb.tsx:36-57
--------------------
on 'foreman.status' (status='error')      -> setError(detail)
on 'foreman.status' (status='connected')  -> clear error, reset idle timer
on 'foreman.transcript'                   -> append to transcript, mark
                                             activity as 'speaking' (assistant)
                                             or 'listening' (user), reset
                                             idle timer, schedule decay to
                                             'listening' after 1.5s
```

## Audio Pipeline

All audio I/O happens in the extension host; the webview never sees PCM bytes.

```
foreman.audio.ts:47-71
----------------------
mic     = spawn('ffmpeg', [-f avfoundation -i :0 -ac 1 -ar 24000 -f s16le pipe:1])
speaker = spawn('ffplay', [-nodisp -f s16le -ar 24000 -ac 1 -probesize 32
                           -fflags nobuffer -i pipe:0])
```

Mic bytes are sent to OpenAI as base64-encoded PCM16 chunks:

```
foreman.audio.ts:127-133
------------------------
mic.stdout.on('data', (buf) => {
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: buf.toString('base64'),
  }));
});
```

Speaker bytes come back as `response.audio.delta` events:

```
foreman.audio.ts:176-195
------------------------
if (type === 'response.audio.delta') {
  const pcm = Buffer.from(msg.delta, 'base64');
  speaker.stdin?.write(pcm);           // raw PCM16, no reframing
}
```

### Session config

Set once, on WS open
(`foreman.audio.ts:106-124`):

| Field | Value | Why |
|---|---|---|
| `model` | `gpt-realtime` | `FOREMAN_MODEL`, defined once in `foreman.vscode.ts:31` |
| `voice` | `cedar` | `FOREMAN_VOICE`, `foreman.vscode.ts:32` |
| `modalities` | `['audio','text']` | we need both speech output and a transcript to render |
| `input_audio_format` | `pcm16` | matches ffmpeg's `-f s16le` |
| `output_audio_format` | `pcm16` | matches ffplay's `-f s16le` |
| `input_audio_transcription.model` | `whisper-1` | user-side transcription for the UI |
| `turn_detection.type` | `server_vad` | OpenAI handles silence detection; client streams continuously |
| `tools` | `FOREMAN_TOOLS` | `briefing` + `focus`, see below |
| `tool_choice` | `auto` | model decides when to call tools |
| `temperature` | `0.7` | brief, not rigid |

### Why ffmpeg/ffplay (not WebAudio)

Webviews in VS Code are sandboxed iframes and:

1. Block `navigator.mediaDevices.getUserMedia` in most configurations.
2. Cannot spawn subprocesses.
3. Autoplay policies can silence `<audio>` elements on initial load.

Moving both mic capture and playback to the Node host sidesteps all three. The
tradeoff is a hard dependency on ffmpeg (`ffmpeg` and `ffplay` must be on the
host's `PATH`); failures surface through `speaker.on('error')`, `mic.stderr`
filtering, and a `speaker.stderr` reader that escalates messages matching
`/error|invalid|cannot|failed/` to `foreman.status=error`
(`foreman.audio.ts:84-105`).

## Tool Loop

The realtime model has two tools. Both are pure functions over the extension
host's view of the world, so they are cheap to call.

```
foreman.vscode.ts:68-87
-----------------------
FOREMAN_TOOLS = [
  { name: 'briefing', ... },
  { name: 'focus',    ... },
]
```

### `briefing`

One fast digest of the floor: recent local sessions from the last 2 hours,
cloud dispatches, active team DAGs. No arguments.

Data path:

```
foreman.vscode.ts:131-187  computeBriefing()
  -> foreman.registry.ts   readLiveTerminals()         (cross-window merge)
  -> foreman.sources.ts    listLocalSessions()         (agents-cli `list`)
  -> foreman.sources.ts    listCloudTasks()            (agents-cli `cloud ls`)
  -> foreman.sources.ts    listTeams()                 (agents-cli `teams ls`)
  -> foreman.digest.ts     buildForemanDigest()        (shape + elapsed strings)
```

The digest is deliberately short. Every extra field costs latency when the
model reads it back aloud, so `foreman.digest.ts:30-45` exposes only the
fields a voice response would actually say: `kind`, `label`, `project`,
`elapsed`, `status`, `task`, `last_tool`.

### `focus`

Deep detail on one agent. Matches by label substring, kind, or 8-char
session-id prefix. Reads the agents-cli event tail for the truly live bits:
current file, current tool, last bash command, token count, git branch.

```
foreman.vscode.ts:247-299  computeFocus(who)
  -> foreman.sources.ts    listLocalSessions({since:'6h', limit:60})
  -> foreman.sources.ts    readSessionEvents(id, 30)
```

### Tool dispatch

The model emits `response.function_call_arguments.done`. The audio layer
forwards to the bridge, which calls `runForemanTool` in the vscode module and
sends the JSON result back over the WS
(`settings.vscode.ts:1393-1400`, `foreman.audio.ts:179-186`):

```
response.function_call_arguments.done
  -> events.onToolCall(callId, name, args)
    -> runForemanTool(name, args, workspacePath)
      -> computeBriefing() | computeFocus(who)
    -> foremanSession.sendToolResult(callId, result)
      -> ws.send({ type:'conversation.item.create', function_call_output })
      -> ws.send({ type:'response.create' })
```

The extra `response.create` forces the model to continue the turn after
reading the tool result, rather than ending the response prematurely
(`foreman.audio.ts:153-166`).

## Cross-Window Floor Registry

A single VS Code extension host only sees terminals in its own window.
Foreman needs to see every agent across every IDE window (Cursor + VS Code +
Codium can all be open). The registry solves this with a shared JSON file.

```
foreman.registry.ts:1-15
------------------------
~/.agents/terminals/live-terminals.json
{ <windowId>: { at: ISO_timestamp, entries: LiveTerminal[] } }
```

Contract:

- Each window owns its `windowId` slice. Writers replace only their own slice.
- Readers merge every slice, then filter entries whose `pid` is dead
  (`process.kill(pid, 0)` test).
- A whole slice is dropped if `at` is older than 10 minutes AND any entry's
  pid is dead (catches crashed windows).
- Pruning on close/exit happens in the owning window; readers never prune.

This is what makes "what's everyone doing?" actually true across windows.

## Idle Auto-Disconnect

A UI-driven 60-second silence timer, with a 10-second warning, keeps the mic
honest without amputating a mid-turn pause.

```
ForemanOrb.tsx:59-82
--------------------
IDLE_WARN_MS  = 50_000
IDLE_CLOSE_MS = 60_000

// ticker runs only while conn === 'connected', at 500ms
elapsed = now - lastActivityAt
  if elapsed >= 60000  ->  handleStop()                // posts stopSession
  if elapsed >= 50000  ->  setIdleCountdown(ceil((60000-elapsed)/1000))
```

What resets `lastActivityAt`:

| Event | Reset? |
|---|---|
| `foreman.status=connected` received | yes (turn 0) |
| `foreman.transcript` (any role, any text) | yes |
| user taps the orb while countdown is showing | yes (keep-alive) |
| user taps the orb while no countdown | no -- this triggers `stopSession` |

User taps during `idleCountdown !== null` intentionally suppress the normal
toggle-off behavior
(`ForemanOrb.tsx:99-111`) so the gesture means "stay", not "quit".

### Why 60s of silence

Shorter (30s) cut off natural pauses while the user was thinking aloud.
Longer (2 min) left the mic open across real context switches.  60s with a
10s visible fade is the smallest value that survived informal testing without
truncating turns.

### Why disconnect is not "destructive"

The intuitive-design skill warns against auto-anticipating destructive
actions. Disconnecting the mic is returning to a safe state; it does not
delete data, and the next summon is one tap away. A 10s visible warning
("Sleeping in Ns -- tap to keep") converts the auto-disconnect from a hidden
behavior into a visible one.

## File Map

```
extension/ui/settings/
|-- App.tsx                                 mounts <ForemanOrb/> at root (line 739)
|-- index.css                               foreman-orb-* classes + keyframes (296-486)
`-- components/foreman/
    |-- ForemanOrb.tsx                      the component
    `-- index.ts                            barrel: `export { ForemanOrb }`

extension/src/vscode/
|-- settings.vscode.ts                      webview bridge; start/stop cases
|                                             at lines 1377-1415
|-- foreman.vscode.ts                       model/voice/system-prompt; tool
|                                             defs; computeBriefing/computeFocus
|-- foreman.audio.ts                        ffmpeg/ffplay + WS + audio routing
|-- foreman.sources.ts                      agents-cli wrappers (sessions,
|                                             events, cloud, teams)
`-- foreman.registry.ts                     cross-window live-terminals.json

extension/src/core/
|-- foreman.digest.ts                       pure digest shaping
`-- foreman.digest.test.ts                  unit tests for the digest
```

## Invariants

Things that must stay true as the code evolves:

1. **Only one session at a time.** Starting a new one closes the old one
   (`settings.vscode.ts:1378-1381`). Two concurrent ffmpeg captures would fight
   over the mic and duplicate audio to OpenAI.
2. **Audio lives in the host, never in the webview.** Moving mic/speaker into
   the webview would break on sandbox and autoplay policies.
3. **The idle timer runs only while `conn === 'connected'`.** It must be torn
   down on disconnect (`ForemanOrb.tsx:61-82`), otherwise a closed session
   would fire `handleStop()` against no session.
4. **Tool results must be followed by `response.create`.** Omit it and the
   model goes silent after reading the tool output
   (`foreman.audio.ts:153-166`).
5. **Registry pruning happens on owning windows, not readers.** Readers that
   prune race with writers and corrupt the file.

## Known Limits and Future Work

- **Webview-scoped.** The orb disappears when the Factory tab is unfocused.
  The proper fix is a `WebviewView` docked in the activity bar plus a
  `StatusBarItem` that summons it -- the status bar item is the only truly
  always-visible surface a VS Code extension has.
- **Hard dependency on ffmpeg/ffplay.** No graceful fallback. A missing
  binary surfaces as `speaker.on('error')` with the raw ENOENT message.
- **No per-session volume control.** Speaker volume is system default; there
  is no in-orb mute for "don't speak out loud this time."
- **Session does not survive window reload.** A window reload tears down the
  extension host; the orb comes back idle. OpenAI ephemeral client secrets
  expire in ~60s anyway, so re-mint on resume is cheap.
- **No persistent transcript history.** The old Foreman tab showed a scrolling
  history; the orb only shows the last four lines. If history becomes useful,
  the tab can return as a read-only history surface without re-coupling to
  the summon flow.
