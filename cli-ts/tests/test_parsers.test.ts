import { describe, test, expect } from 'bun:test';
import { normalizeEvent } from '../src/parsers.js';

describe('Codex Parser', () => {
  it('should normalize thread.started event', () => {
    const raw = { type: 'thread.started', thread_id: 'test-123' };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('codex');
    expect(event.session_id).toBe('test-123');
    expect(event.timestamp).toBeDefined();
  });

  it('should normalize turn.started event', () => {
    const raw = { type: 'turn.started' };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('turn_start');
    expect(event.agent).toBe('codex');
  });

  it('should normalize agent_message item', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: "Hello, I'm working on this task.",
      },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('message');
    expect(event.agent).toBe('codex');
    expect(event.content).toBe("Hello, I'm working on this task.");
    expect(event.complete).toBe(true);
  });

  it('should normalize file write tool call', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'tool_call',
        name: 'write_file',
        arguments: { path: 'src/auth.ts', content: '...' },
      },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('file_write');
    expect(event.agent).toBe('codex');
    expect(event.tool).toBe('write_file');
    expect(event.path).toBe('src/auth.ts');
  });

  it('should normalize file read tool call', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'tool_call',
        name: 'read_file',
        arguments: { path: 'src/auth.ts' },
      },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('file_read');
    expect(event.path).toBe('src/auth.ts');
  });

  it('should normalize bash tool call', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'tool_call',
        name: 'shell',
        arguments: { command: 'npm install' },
      },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('bash');
    expect(event.tool).toBe('shell');
    expect(event.command).toBe('npm install');
  });

  it('should normalize turn.completed event', () => {
    const raw = {
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('result');
    expect(event.agent).toBe('codex');
    expect(event.status).toBe('success');
    expect(event.usage.input_tokens).toBe(100);
    expect(event.usage.output_tokens).toBe(50);
  });

  it('should normalize unknown tool call', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'tool_call',
        name: 'custom_tool',
        arguments: { arg1: 'value1' },
      },
    };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('tool_use');
    expect(event.tool).toBe('custom_tool');
    expect(event.args).toEqual({ arg1: 'value1' });
  });
});

describe('Cursor Parser', () => {
  it('should normalize system/init event', () => {
    const raw = {
      type: 'system',
      subtype: 'init',
      model: 'claude-3-5-sonnet',
      session_id: 'cursor-123',
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('cursor');
    expect(event.model).toBe('claude-3-5-sonnet');
    expect(event.session_id).toBe('cursor-123');
  });

  it('should normalize thinking complete event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'complete',
      text: 'I need to implement authentication.',
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('thinking');
    expect(event.agent).toBe('cursor');
    expect(event.content).toBe('I need to implement authentication.');
    expect(event.complete).toBe(true);
  });

  it('should normalize thinking delta event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: 'I need',
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('thinking');
    expect(event.complete).toBe(false);
  });

  it('should normalize assistant message', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: "I'll implement auth now." }],
      },
    };
    const events = normalizeEvent('cursor', raw);

    expect(events.type).toBe('message');
    expect(events.agent).toBe('cursor');
    expect(events.content).toBe("I'll implement auth now.");
    expect(events.complete).toBe(true);
  });

  it('should normalize result success event', () => {
    const raw = {
      type: 'result',
      subtype: 'success',
      duration_ms: 5000,
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('result');
    expect(event.status).toBe('success');
    expect(event.duration_ms).toBe(5000);
  });
});

describe('Gemini Parser', () => {
  it('should normalize init event', () => {
    const raw = {
      type: 'init',
      timestamp: '2024-01-01T00:00:00Z',
      session_id: 'gemini-123',
      model: 'gemini-pro',
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('gemini');
    expect(event.session_id).toBe('gemini-123');
    expect(event.model).toBe('gemini-pro');
  });

  it('should normalize complete message', () => {
    const raw = {
      type: 'message',
      role: 'assistant',
      content: 'Task completed successfully.',
      delta: false,
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('message');
    expect(event.agent).toBe('gemini');
    expect(event.content).toBe('Task completed successfully.');
    expect(event.complete).toBe(true);
  });

  it('should normalize delta message', () => {
    const raw = {
      type: 'message',
      role: 'assistant',
      content: 'Task',
      delta: true,
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('message');
    expect(event.complete).toBe(false);
  });

  it('should normalize file write tool call', () => {
    const raw = {
      type: 'tool_call',
      name: 'write_file',
      args: { path: 'src/test.ts' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_write');
    expect(event.path).toBe('src/test.ts');
  });

  it('should normalize bash tool call', () => {
    const raw = {
      type: 'tool_call',
      name: 'run_command',
      args: { command: 'npm test' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('bash');
    expect(event.command).toBe('npm test');
  });
});

describe('Claude Parser', () => {
  it('should use Cursor format', () => {
    const raw = {
      type: 'system',
      subtype: 'init',
      model: 'claude-3-5-sonnet',
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('claude');
    expect(event.model).toBe('claude-3-5-sonnet');
  });
});
