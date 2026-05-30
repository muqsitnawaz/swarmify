// Foreman audio pipeline that lives in the extension host (Node) because
// VS Code webviews block getUserMedia in their sandbox.
//
// Data flow, both directions raw 24kHz mono PCM16:
//
//   mic  -> ffmpeg -> stdout -> WS append -> OpenAI Realtime
//                                                       |
//                                                       v
//   speaker <- ffplay <- stdin <- WS delta <- response
//
// The realtime model handles turn detection (server_vad) so we simply keep
// streaming mic bytes until the session ends.

import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { FOREMAN_MODEL, FOREMAN_VOICE, FOREMAN_SYSTEM_PROMPT, FOREMAN_TOOLS } from '../core/foreman.config';

export const REALTIME_WS = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(FOREMAN_MODEL)}`;
export const SAMPLE_RATE = 24000;

// GA Realtime session.update payload. Exported so the e2e WS handshake test
// can exercise the exact same shape production sends — schema drift caught
// at test time, not at "tap the orb" time.
export function buildForemanSessionUpdate() {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: FOREMAN_MODEL,
      output_modalities: ['audio'],
      instructions: FOREMAN_SYSTEM_PROMPT,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
        output: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          voice: FOREMAN_VOICE,
        },
      },
      tools: FOREMAN_TOOLS,
      tool_choice: 'auto',
    },
  } as const;
}

export interface ForemanAudioEvents {
  onStatus?: (status: 'connecting' | 'connected' | 'closed' | 'error', detail?: string) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, final: boolean) => void;
  onToolCall?: (callId: string, name: string, args: unknown) => void;
}

export interface ForemanAudioSession {
  sendToolResult(callId: string, result: unknown): void;
  close(): void;
}

export async function startForemanAudio(
  apiKey: string,
  events: ForemanAudioEvents
): Promise<ForemanAudioSession> {
  events.onStatus?.('connecting');

  // GA Realtime API (post-2026-05-07): no OpenAI-Beta header.
  // The beta header would route to the removed beta interface and OpenAI
  // returns "Realtime Beta API is no longer supported".
  const ws = new WebSocket(REALTIME_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  // ffmpeg reads from the default macOS audio input (avfoundation ":0")
  // and emits raw PCM16 little-endian at 24kHz mono on stdout.
  const mic: ChildProcess = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'avfoundation', '-i', ':0',
      '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 's16le', 'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // ffplay reads raw PCM16 from stdin and plays to the default output.
  // -probesize / -fflags nobuffer minimize playback buffering so the
  // foreman's voice lands close to realtime.
  const speaker: ChildProcess = spawn(
    'ffplay',
    [
      '-hide_banner', '-loglevel', 'error',
      '-autoexit', '-nodisp',
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ch_layout', 'mono',
      '-probesize', '32', '-fflags', 'nobuffer',
      '-i', 'pipe:0',
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  let open = false;
  let closed = false;
  // Mic gate: when the assistant is speaking (or just finished speaking), we
  // stop forwarding mic bytes to OpenAI so ffplay's speaker output doesn't
  // get picked up by the microphone and looped back as "user input". Without
  // this, the assistant responds to its own voice. The tail buffer keeps the
  // mic muted for a short window after the last audio delta to swallow
  // trailing echoes.
  const ASSISTANT_TAIL_MS = 600;
  let assistantSpeakingUntil = 0;
  const noteAssistantAudio = () => { assistantSpeakingUntil = Date.now() + ASSISTANT_TAIL_MS; };
  const micMuted = () => Date.now() < assistantSpeakingUntil;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { mic.kill('SIGTERM'); } catch { /* noop */ }
    try { speaker.stdin?.end(); } catch { /* noop */ }
    try { speaker.kill('SIGTERM'); } catch { /* noop */ }
    try { ws.close(); } catch { /* noop */ }
  };

  // After cleanup() we deliberately kill ffplay/ffmpeg. The resulting exit
  // events and "write EPIPE" errors are expected — suppress them so the UI
  // doesn't flash "FFplayError" when the user taps the orb to stop.
  mic.on('error', (err) => { if (!closed) events.onStatus?.('error', `ffmpeg: ${err.message}`); });
  speaker.on('error', (err) => { if (!closed) events.onStatus?.('error', `ffplay: ${err.message}`); });
  speaker.on('exit', (code, signal) => {
    console.warn(`[foreman] ffplay exited code=${code} signal=${signal}`);
    if (closed) return;
    if (code !== 0 && code !== null) {
      events.onStatus?.('error', `ffplay exited with code ${code}`);
    }
  });
  mic.stderr?.on('data', (buf: Buffer) => {
    if (closed) return;
    const line = buf.toString().split('\n')[0];
    if (line && /error|invalid/i.test(line)) events.onStatus?.('error', `ffmpeg: ${line.slice(0, 120)}`);
  });
  speaker.stderr?.on('data', (buf: Buffer) => {
    const text = buf.toString().trim();
    if (text) console.warn('[foreman ffplay]', text.slice(0, 400));
    if (closed) return;
    const firstLine = text.split('\n')[0];
    if (firstLine && /error|invalid|cannot|no such|not found|failed/i.test(firstLine)) {
      events.onStatus?.('error', `ffplay: ${firstLine.slice(0, 160)}`);
    }
  });

  ws.on('open', () => {
    open = true;
    events.onStatus?.('connected');

    ws.send(JSON.stringify(buildForemanSessionUpdate()));

    // Start streaming mic bytes to OpenAI as base64 PCM16 chunks. Skip the
    // upload while the assistant is speaking so its own playback doesn't
    // loop back through the mic.
    mic.stdout?.on('data', (buf: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (micMuted()) return;
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: buf.toString('base64'),
      }));
    });
  });

  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    route(msg, speaker, events, noteAssistantAudio);
  });

  ws.on('close', () => {
    open = false;
    events.onStatus?.('closed');
    cleanup();
  });

  ws.on('error', (err) => {
    if (!closed) events.onStatus?.('error', err.message);
    cleanup();
  });

  return {
    sendToolResult(callId, result) {
      if (!open) return;
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      }));
      ws.send(JSON.stringify({ type: 'response.create' }));
    },
    close: cleanup,
  };
}

let audioBytesReceived = 0;
let audioChunksLogged = 0;

function route(msg: any, speaker: ChildProcess, events: ForemanAudioEvents, noteAssistantAudio: () => void) {
  const type: string = msg?.type ?? '';

  if (type === 'response.output_audio.delta' && typeof msg.delta === 'string') {
    noteAssistantAudio();
    const pcm = Buffer.from(msg.delta, 'base64');
    audioBytesReceived += pcm.length;
    if (audioChunksLogged < 3) {
      console.log(`[foreman] audio delta #${audioChunksLogged + 1}: ${pcm.length} bytes, speaker.stdin.writable=${speaker.stdin?.writable}, killed=${speaker.killed}`);
      audioChunksLogged++;
    }
    try {
      const ok = speaker.stdin?.write(pcm);
      if (ok === false && audioChunksLogged <= 3) console.log('[foreman] ffplay stdin backpressure');
    } catch (err) {
      console.warn('[foreman] speaker.stdin.write threw:', err);
    }
    return;
  }

  if (type === 'response.output_audio.done') {
    noteAssistantAudio();
    console.log(`[foreman] audio response done. total bytes: ${audioBytesReceived}`);
    audioBytesReceived = 0;
    audioChunksLogged = 0;
    return;
  }

  if (type === 'conversation.item.input_audio_transcription.completed') {
    events.onTranscript?.('user', msg.transcript ?? '', true);
    return;
  }

  if (type === 'response.output_audio_transcript.delta') {
    events.onTranscript?.('assistant', msg.delta ?? '', false);
    return;
  }
  if (type === 'response.output_audio_transcript.done') {
    events.onTranscript?.('assistant', msg.transcript ?? '', true);
    return;
  }

  if (type === 'response.function_call_arguments.done') {
    const callId: string = msg.call_id ?? msg.id ?? '';
    const name: string = msg.name ?? '';
    let args: unknown = {};
    try { args = msg.arguments ? JSON.parse(msg.arguments) : {}; } catch { args = {}; }
    events.onToolCall?.(callId, name, args);
    return;
  }

  if (type === 'error') {
    events.onStatus?.('error', msg.error?.message ?? 'realtime error');
  }
}
