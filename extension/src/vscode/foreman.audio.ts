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
import { FOREMAN_MODEL, FOREMAN_VOICE, FOREMAN_SYSTEM_PROMPT, FOREMAN_TOOLS } from './foreman.vscode';

const REALTIME_WS = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(FOREMAN_MODEL)}`;
const SAMPLE_RATE = 24000;

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

  const ws = new WebSocket(REALTIME_WS, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
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
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1',
      '-probesize', '32', '-fflags', 'nobuffer',
      '-i', 'pipe:0',
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  let open = false;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { mic.kill('SIGTERM'); } catch { /* noop */ }
    try { speaker.stdin?.end(); } catch { /* noop */ }
    try { speaker.kill('SIGTERM'); } catch { /* noop */ }
    try { ws.close(); } catch { /* noop */ }
  };

  mic.on('error', (err) => events.onStatus?.('error', `ffmpeg: ${err.message}`));
  speaker.on('error', (err) => events.onStatus?.('error', `ffplay: ${err.message}`));
  mic.stderr?.on('data', (buf: Buffer) => {
    // ffmpeg is chatty; only surface the first error chunk for debugging.
    const line = buf.toString().split('\n')[0];
    if (line && /error|invalid/i.test(line)) events.onStatus?.('error', `ffmpeg: ${line.slice(0, 120)}`);
  });

  ws.on('open', () => {
    open = true;
    events.onStatus?.('connected');

    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: FOREMAN_VOICE,
        instructions: FOREMAN_SYSTEM_PROMPT,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
        tools: FOREMAN_TOOLS,
        tool_choice: 'auto',
        temperature: 0.7,
      },
    }));

    // Start streaming mic bytes to OpenAI as base64 PCM16 chunks.
    mic.stdout?.on('data', (buf: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: buf.toString('base64'),
      }));
    });
  });

  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    route(msg, speaker, events);
  });

  ws.on('close', () => {
    open = false;
    events.onStatus?.('closed');
    cleanup();
  });

  ws.on('error', (err) => {
    events.onStatus?.('error', err.message);
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

function route(msg: any, speaker: ChildProcess, events: ForemanAudioEvents) {
  const type: string = msg?.type ?? '';

  if (type === 'response.audio.delta' && typeof msg.delta === 'string') {
    const pcm = Buffer.from(msg.delta, 'base64');
    try { speaker.stdin?.write(pcm); } catch { /* broken pipe */ }
    return;
  }

  if (type === 'conversation.item.input_audio_transcription.completed') {
    events.onTranscript?.('user', msg.transcript ?? '', true);
    return;
  }

  if (type === 'response.audio_transcript.delta') {
    events.onTranscript?.('assistant', msg.delta ?? '', false);
    return;
  }
  if (type === 'response.audio_transcript.done') {
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
