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
