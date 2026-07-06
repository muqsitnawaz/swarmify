/**
 * E2E: the Foreman smart-mode brain against the LIVE OpenAI API (no mocks).
 * The OpenAI service is real; the tool runner is dependency-injected (the same
 * seam the extension uses to pass runForemanTool). Verifies the real critical
 * path: text in -> model routes a tool -> we run it -> model answers from the
 * result -> text out, plus the streaming/tool-call reassembly.
 *
 * Skips when no OpenAI key is available.
 */

import { describe, test, expect } from 'bun:test';
import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { runSmartTurn, adaptToolsForOpenAI, capHistory } from '../src/vscode/foreman.smart';
import { ForemanTool } from '../src/core/foreman.config';

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
      const m = fs.readFileSync(p, 'utf8').match(/"agents\.openaiApiKey"\s*:\s*"(sk-[^"]+)"/);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  return null;
}

const apiKey = loadOpenAIKey();
const describeIfKey = apiKey ? describe : describe.skip;

const BRIEFING_TOOL: ForemanTool = {
  type: 'function',
  name: 'briefing',
  description: 'Live factory floor: which agents are running, on what, for how long.',
  parameters: { type: 'object', properties: {}, required: [] },
};

describe('capHistory', () => {
  // Turn shape: user, assistant(tool_calls), tool, assistant(final).
  const turn = (u: string, id: string) => [
    { role: 'user', content: u },
    { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'briefing', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, content: '{"ok":true}' },
    { role: 'assistant', content: `answer ${u}` },
  ];

  test('returns as-is when under the cap', () => {
    const msgs = turn('a', 'c1');
    expect(capHistory(msgs, 10)).toBe(msgs);
  });

  test('never begins the window on a dangling tool message', () => {
    // Two full turns = 8 messages; cap at 6 would raw-slice to start at a
    // `tool` message (index 2 of turn 1's tail) — capHistory must advance to
    // the next user boundary instead.
    const msgs = [...turn('a', 'c1'), ...turn('b', 'c2')];
    const capped = capHistory(msgs, 6);
    expect(capped[0].role).toBe('user');
    // No tool message may appear before its assistant(tool_calls) parent.
    for (let i = 0; i < capped.length; i++) {
      if (capped[i].role === 'tool') {
        const prev = capped[i - 1];
        expect(prev && prev.role === 'assistant' && Array.isArray(prev.tool_calls)).toBe(true);
      }
    }
    // Keeps the most recent whole turn.
    expect(capped).toEqual(turn('b', 'c2'));
  });
});

describe('adaptToolsForOpenAI', () => {
  test('wraps the schema under function', () => {
    const [t] = adaptToolsForOpenAI([BRIEFING_TOOL]);
    expect(t.type).toBe('function');
    expect(t.function.name).toBe('briefing');
    expect(t.function.parameters).toEqual(BRIEFING_TOOL.parameters);
  });
});

describeIfKey('foreman smart brain (live OpenAI)', () => {
  test('routes a tool call and answers from the injected result', async () => {
    const called: string[] = [];
    let streamed = '';
    const { text, history } = await runSmartTurn({
      apiKey: apiKey as string,
      history: [],
      userText: 'Which agents are running right now? One short sentence.',
      tools: [BRIEFING_TOOL],
      runTool: async (name) => {
        called.push(name);
        // A real tool-shaped result (this is the dependency, injected, not a
        // mock of the service under test).
        return { agents: [{ kind: 'claude', task: 'auth refactor', elapsed: '12 min' }], summary: '1 agent local' };
      },
      events: { onText: (d) => { streamed += d; } },
    });

    expect(called).toContain('briefing');           // model chose the right tool
    expect(text.length).toBeGreaterThan(0);
    expect(streamed).toBe(text);                     // streaming delta sum == final
    expect(text.toLowerCase()).toContain('claude');  // answered FROM the tool result
    // history ends on the assistant answer and contains the tool round.
    expect(history.some((m) => m.role === 'tool')).toBe(true);
    expect(history[history.length - 1].role).toBe('assistant');
  }, 30_000);

  test('answers directly when no tool is needed', async () => {
    const called: string[] = [];
    const { text } = await runSmartTurn({
      apiKey: apiKey as string,
      history: [],
      userText: 'Reply with exactly the word: ready',
      tools: [BRIEFING_TOOL],
      runTool: async (name) => { called.push(name); return {}; },
    });
    expect(called).toHaveLength(0);                  // no gratuitous tool call
    expect(text.toLowerCase()).toContain('ready');
  }, 30_000);
});
