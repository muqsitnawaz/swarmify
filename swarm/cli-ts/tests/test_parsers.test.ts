import { describe, test, expect } from 'bun:test';
import { normalizeEvent } from '../src/parsers.js';

describe('Codex Parser', () => {
  test('should normalize thread.started event', () => {
    const raw = { type: 'thread.started', thread_id: 'test-123' };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('codex');
    expect(event.session_id).toBe('test-123');
    expect(event.timestamp).toBeDefined();
  });

  test('should normalize turn.started event', () => {
    const raw = { type: 'turn.started' };
    const event = normalizeEvent('codex', raw);

    expect(event.type).toBe('turn_start');
    expect(event.agent).toBe('codex');
  });

  test('should normalize agent_message item', () => {
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

  test('should normalize file write tool call', () => {
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

  test('should normalize file read tool call', () => {
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

  test('should normalize bash tool call', () => {
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

  test('should normalize turn.completed event', () => {
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

  test('should normalize unknown tool call', () => {
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
  test('should normalize system/init event', () => {
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

  test('should normalize thinking completed event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'completed',
      text: 'I need to implement authentication.',
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('thinking');
    expect(event.agent).toBe('cursor');
    expect(event.content).toBe('I need to implement authentication.');
    expect(event.complete).toBe(true);
  });

  test('should normalize thinking delta event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: 'I need',
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('thinking');
    expect(event.complete).toBe(false);
  });

  test('should normalize assistant message', () => {
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

  test('should normalize result success event', () => {
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

  test('should normalize shell tool_call completed event', () => {
    const raw = {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_4c91ae03-9c12-4e34-8525-13b1ad8cc67',
      tool_call: {
        shellToolCall: {
          args: {
            command: "echo 'hello world' > /tmp/test.txt",
            workingDirectory: '',
            timeout: 300000,
          },
          result: {
            success: {
              exitCode: 0,
              stdout: '',
              stderr: '',
            },
          },
        },
      },
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('bash');
    expect(event.agent).toBe('cursor');
    expect(event.tool).toBe('shell');
    expect(event.command).toBe("echo 'hello world' > /tmp/test.txt");
  });

  test('should normalize edit tool_call completed event', () => {
    const raw = {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_c2be2308-a0e6-42c3-a8b6-8a7343fe254',
      tool_call: {
        editToolCall: {
          args: {
            path: '/tmp/test-cursor-output-123.txt',
            streamContent: 'hello world',
          },
          result: {
            rejected: { path: '', reason: '' },
          },
        },
      },
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('file_write');
    expect(event.agent).toBe('cursor');
    expect(event.tool).toBe('edit');
    expect(event.path).toBe('/tmp/test-cursor-output-123.txt');
  });

  test('should normalize delete tool_call completed event', () => {
    const raw = {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_delete_123',
      tool_call: {
        deleteToolCall: {
          args: {
            path: '/tmp/file-to-delete.txt',
          },
          result: {
            success: {},
          },
        },
      },
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('file_delete');
    expect(event.agent).toBe('cursor');
    expect(event.tool).toBe('delete');
    expect(event.path).toBe('/tmp/file-to-delete.txt');
  });

  test('should normalize list tool_call completed event', () => {
    const raw = {
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'tool_list_123',
      tool_call: {
        listToolCall: {
          args: {
            path: '/tmp/testdir',
          },
          result: {
            success: {
              entries: [],
            },
          },
        },
      },
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('directory_list');
    expect(event.agent).toBe('cursor');
    expect(event.tool).toBe('list');
    expect(event.path).toBe('/tmp/testdir');
  });

  test('should ignore tool_call started events', () => {
    const raw = {
      type: 'tool_call',
      subtype: 'started',
      call_id: 'tool_123',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo test' },
        },
      },
    };
    const event = normalizeEvent('cursor', raw);

    expect(event.type).toBe('tool_call');
  });
});

describe('Gemini Parser', () => {
  test('should normalize init event', () => {
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

  test('should normalize complete message', () => {
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

  test('should normalize delta message', () => {
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

  test('should normalize file write tool call', () => {
    const raw = {
      type: 'tool_call',
      name: 'write_file',
      args: { path: 'src/test.ts' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_write');
    expect(event.path).toBe('src/test.ts');
  });

  test('should normalize bash tool call', () => {
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
  test('should use Cursor format', () => {
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
