/**
 * E2E test: foreman session.update must be accepted by the live OpenAI
 * Realtime GA endpoint. No mocks — real WebSocket, real API key.
 *
 * Why this test exists: the prior beta-shape payload (string formats,
 * top-level voice) was silently invalid; we only noticed when the user
 * actually tapped the orb in production. This test catches schema drift
 * before ship by reusing the exact same payload builder production sends.
 *
 * Skips when OPENAI_API_KEY is missing OR when agents.openaiApiKey is unset
 * in VS Code settings — CI without a key can still run the rest of the suite.
 */

import { describe, test, expect } from 'bun:test';
import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import {
  REALTIME_WS,
  MIC_FFMPEG_ARGS,
  SPEAKER_FFPLAY_ARGS,
  SAMPLE_RATE,
  advancePlaybackClock,
  buildForemanSessionUpdate,
} from '../src/vscode/foreman.audio';

function loadOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const candidates = [
    path.join(homedir(), 'Library/Application Support/Code/User/settings.json'),
    path.join(homedir(), 'Library/Application Support/VSCodium/User/settings.json'),
    path.join(homedir(), 'Library/Application Support/Cursor/User/settings.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const match = raw.match(/"agents\.openaiApiKey"\s*:\s*"(sk-[^"]+)"/);
      if (match) return match[1];
    } catch { /* ignore */ }
  }
  return null;
}

const apiKey = loadOpenAIKey();
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('foreman realtime GA handshake', () => {
  test('session.update is accepted by OpenAI Realtime GA', async () => {
    const result = await new Promise<{ ok: boolean; detail?: string }>((resolve) => {
      const ws = new WebSocket(REALTIME_WS, {
        headers: {
          // GA: no OpenAI-Beta header. If present, OpenAI returns
          // "Realtime Beta API is no longer supported".
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const timeout = setTimeout(() => {
        try { ws.close(); } catch { /* noop */ }
        resolve({ ok: false, detail: 'timeout waiting for session.updated' });
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify(buildForemanSessionUpdate()));
      });

      const seen: string[] = [];
      let lastError: any = null;
      let done = false;
      const finish = (r: { ok: boolean; detail?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* noop */ }
        resolve(r);
      };
      ws.on('message', (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        const t: string = msg?.type ?? '';
        seen.push(t);
        if (t === 'session.updated') {
          finish({ ok: true });
        } else if (t === 'error') {
          lastError = msg.error;
          finish({
            ok: false,
            detail: `${lastError.code ?? 'error'}: ${lastError.message ?? 'unknown'}`,
          });
        }
      });

      ws.on('error', (err) => finish({ ok: false, detail: `ws error: ${err.message}` }));

      ws.on('close', (code, reason) => {
        const events = seen.join(',');
        finish({
          ok: false,
          detail: `ws closed code=${code} reason="${reason?.toString()}" events=[${events}]`,
        });
      });
    });

    if (!result.ok) {
      throw new Error(`Foreman GA handshake failed: ${result.detail}`);
    }
    expect(result.ok).toBe(true);
  }, 20000);
});

// Mic capture e2e: spawn the EXACT production ffmpeg command and require real
// PCM bytes on stdout. This is the test that catches "ffmpeg exits before
// capturing a byte" regressions — unsupported avfoundation flags, a dead
// ":default" device mapping, a removed option in a new ffmpeg release.
// Skips when ffmpeg is not installed (spawn ENOENT).
describe('foreman mic capture', () => {
  test('production ffmpeg args capture PCM16 from the default input', async () => {
    const { spawn } = await import('child_process');
    const result = await new Promise<{ bytes: number; stderr: string; spawnFailed: boolean }>((resolve) => {
      const proc = spawn('ffmpeg', [...MIC_FFMPEG_ARGS]);
      let bytes = 0;
      let stderr = '';
      let spawnFailed = false;
      // Half a second of 24kHz mono PCM16 is SAMPLE_RATE bytes.
      proc.stdout?.on('data', (b: Buffer) => {
        bytes += b.length;
        if (bytes >= SAMPLE_RATE) proc.kill('SIGTERM');
      });
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });
      proc.on('error', () => { spawnFailed = true; });
      const timeout = setTimeout(() => proc.kill('SIGKILL'), 8000);
      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve({ bytes, stderr, spawnFailed });
      });
    });

    if (result.spawnFailed) return; // no ffmpeg on this machine

    expect(result.stderr).toBe('');
    expect(result.bytes).toBeGreaterThanOrEqual(SAMPLE_RATE);
  }, 15000);
});

// Context excision e2e: the transcript x button sends conversation.item.delete
// with the item_id from the transcript events. Prove against the live API that
// a created item can be deleted and the server confirms with
// conversation.item.deleted — the contract the delete button depends on.
describeIfKey('foreman conversation item delete', () => {
  test('conversation.item.delete removes a created item', async () => {
    const result = await new Promise<{ ok: boolean; detail?: string }>((resolve) => {
      const ws = new WebSocket(REALTIME_WS, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const seen: string[] = [];
      const timeout = setTimeout(() => {
        try { ws.close(); } catch { /* noop */ }
        resolve({ ok: false, detail: `timeout waiting for conversation.item.deleted, events=[${seen.join(',')}]` });
      }, 15000);

      let done = false;
      const finish = (r: { ok: boolean; detail?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* noop */ }
        resolve(r);
      };

      let createdItemId = '';
      ws.on('open', () => {
        ws.send(JSON.stringify(buildForemanSessionUpdate()));
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'transcription glitch to excise' }],
          },
        }));
      });

      ws.on('message', (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        const t: string = msg?.type ?? '';
        seen.push(t);
        // GA acks item creation with conversation.item.added (beta said
        // conversation.item.created — that name never arrives on GA).
        if (t === 'conversation.item.added' && msg.item?.id && !createdItemId) {
          createdItemId = msg.item.id;
          // The exact payload ForemanAudioSession.deleteItem sends.
          ws.send(JSON.stringify({ type: 'conversation.item.delete', item_id: createdItemId }));
        } else if (t === 'conversation.item.deleted') {
          finish(msg.item_id === createdItemId
            ? { ok: true }
            : { ok: false, detail: `deleted wrong item: ${msg.item_id} != ${createdItemId}` });
        } else if (t === 'error') {
          finish({ ok: false, detail: `${msg.error?.code ?? 'error'}: ${msg.error?.message ?? 'unknown'}` });
        }
      });

      ws.on('error', (err) => finish({ ok: false, detail: `ws error: ${err.message}` }));
    });

    if (!result.ok) {
      throw new Error(`Foreman item delete failed: ${result.detail}`);
    }
    expect(result.ok).toBe(true);
  }, 20000);
});

// Speaker playback e2e: pipe real PCM through the EXACT production ffplay
// command and require a SILENT stderr. The session treats any speaker stderr
// as an error status (no keyword filtering — that hid a fatal mic failure
// once), so ffplay must not chat: its status clock prints ESC[2K lines to
// stderr even at -loglevel error unless -nostats is set, which made every
// spoken reply flash a red "ffplay: [2K" in the orb.
// Skips when ffplay is not installed (spawn ENOENT).
describe('foreman speaker playback', () => {
  test('production ffplay args play PCM16 with a silent stderr', async () => {
    const { spawn } = await import('child_process');
    const result = await new Promise<{ code: number | null; stderr: string; spawnFailed: boolean }>((resolve) => {
      const proc = spawn('ffplay', [...SPEAKER_FFPLAY_ARGS], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      let spawnFailed = false;
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });
      proc.on('error', () => { spawnFailed = true; });
      // Half a second of 24kHz mono PCM16 silence; -autoexit ends playback at EOF.
      proc.stdin?.end(Buffer.alloc(SAMPLE_RATE));
      const timeout = setTimeout(() => proc.kill('SIGKILL'), 8000);
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, stderr, spawnFailed });
      });
    });

    if (result.spawnFailed) return; // no ffplay on this machine

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  }, 15000);
});

// The mic-gate playback clock. If this regresses to delta-arrival timing the
// mic reopens mid-speech and the assistant answers its own playback in a
// loop — the bug class is "burst-arriving audio must gate for its full
// real-time play duration".
describe('foreman playback clock', () => {
  test('a burst of fast-arriving deltas gates for the full play duration', () => {
    // 10s of audio (480000 bytes) arriving as 10 chunks within one millisecond.
    const now = 1_000_000
    let endsAt = 0
    for (let i = 0; i < 10; i++) {
      endsAt = advancePlaybackClock(now, endsAt, SAMPLE_RATE * 2) // 1s of PCM each
    }
    expect(endsAt).toBe(now + 10_000)
  })

  test('clock anchors to now after idle silence instead of accumulating stale time', () => {
    const endsAt = advancePlaybackClock(1_000_000, 0, SAMPLE_RATE) // 0.5s chunk, queue long drained
    expect(endsAt).toBe(1_000_500)
  })
})
