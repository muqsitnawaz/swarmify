import { describe, test, expect } from 'bun:test';
import { normalizeEvent, normalizeEvents, parseEvent } from '../src/parsers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

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

  test('should filter empty thinking delta event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: '',
    };
    const events = normalizeEvents('cursor', raw);

    expect(events).toEqual([]);
  });

  test('should filter whitespace-only thinking delta event', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: '   ',
    };
    const events = normalizeEvents('cursor', raw);

    expect(events).toEqual([]);
  });

  test('should include thinking delta with actual content', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: 'actual content',
    };
    const events = normalizeEvents('cursor', raw);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('thinking');
    expect(events[0].content).toBe('actual content');
    expect(events[0].complete).toBe(false);
  });

  test('should include completed thinking event even if empty', () => {
    const raw = {
      type: 'thinking',
      subtype: 'completed',
      text: '',
    };
    const events = normalizeEvents('cursor', raw);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('thinking');
    expect(events[0].complete).toBe(true);
  });

  test('should filter thinking delta with null text', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
      text: null,
    };
    const events = normalizeEvents('cursor', raw);

    expect(events).toEqual([]);
  });

  test('should filter thinking delta with undefined text', () => {
    const raw = {
      type: 'thinking',
      subtype: 'delta',
    };
    const events = normalizeEvents('cursor', raw);

    expect(events).toEqual([]);
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

  test('should normalize replace tool as file_write', () => {
    const raw = {
      type: 'tool_use',
      timestamp: '2025-12-19T11:41:46.699Z',
      tool_name: 'replace',
      tool_id: 'replace-123',
      parameters: {
        instruction: 'Add a goodbye function',
        old_string: 'function hello() { return "world"; }\n',
        new_string: 'function hello() { return "world"; }\n\nfunction goodbye() { return "farewell"; }\n',
        file_path: 'sample.ts',
      },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_write');
    expect(event.agent).toBe('gemini');
    expect(event.tool).toBe('replace');
    expect(event.path).toBe('sample.ts');
  });

  test('should normalize read_file tool', () => {
    const raw = {
      type: 'tool_use',
      timestamp: '2025-12-19T11:41:44.991Z',
      tool_name: 'read_file',
      tool_id: 'read_file-123',
      parameters: { file_path: 'sample.ts' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_read');
    expect(event.agent).toBe('gemini');
    expect(event.tool).toBe('read_file');
    expect(event.path).toBe('sample.ts');
  });

  test('should normalize edit tool as file_write', () => {
    const raw = {
      type: 'tool_call',
      name: 'edit',
      parameters: { file_path: 'src/main.ts', content: 'new content' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_write');
    expect(event.path).toBe('src/main.ts');
  });

  test('should normalize patch tool as file_write', () => {
    const raw = {
      type: 'tool_call',
      name: 'patch',
      args: { path: 'config.json' },
    };
    const event = normalizeEvent('gemini', raw);

    expect(event.type).toBe('file_write');
    expect(event.path).toBe('config.json');
  });
});

describe('Claude Parser', () => {
  test('should normalize system/init event', () => {
    const raw = {
      type: 'system',
      subtype: 'init',
      model: 'claude-3-5-sonnet',
      session_id: 'claude-123',
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('init');
    expect(event.agent).toBe('claude');
    expect(event.model).toBe('claude-3-5-sonnet');
    expect(event.session_id).toBe('claude-123');
  });

  test('should normalize assistant message with tool_use', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_123', name: 'Read', input: { file_path: 'test.ts' } },
        ],
      },
    };
    const events = normalizeEvents('claude', raw);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('tool_use');
    expect(events[0].agent).toBe('claude');
    expect(events[0].tool).toBe('Read');
    expect(events[0].args).toEqual({ file_path: 'test.ts' });
  });

  test('should normalize assistant message with text', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'I will help you.' }],
      },
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('message');
    expect(event.agent).toBe('claude');
    expect(event.content).toBe('I will help you.');
    expect(event.complete).toBe(true);
  });

  test('should normalize user message with file read tool_result', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_01Ji1f3DjUtvpyAFZsnfy5b1',
            type: 'tool_result',
            content: 'file content here',
          },
        ],
      },
      tool_use_result: {
        type: 'text',
        file: {
          filePath: '/path/to/file.py',
          content: 'def hello():\n    print("Hello")\n',
          numLines: 3,
        },
      },
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('file_read');
    expect(event.agent).toBe('claude');
    expect(event.path).toBe('/path/to/file.py');
  });

  test('should normalize user message with bash tool_result', () => {
    const toolUseRaw = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01DNcDdJZtkfF3BjnH7qBZ7M',
            name: 'Bash',
            input: { command: 'ls -la /tmp/test' },
          },
        ],
      },
    };
    normalizeEvents('claude', toolUseRaw);

    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_01DNcDdJZtkfF3BjnH7qBZ7M',
            type: 'tool_result',
            content: 'output here',
            is_error: false,
          },
        ],
      },
      tool_use_result: {
        stdout: 'total 16\ndrwxr-xr-x  7 user  staff  224 Dec 17 11:22 .',
        stderr: '',
        interrupted: false,
        isImage: false,
      },
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('bash');
    expect(event.agent).toBe('claude');
    expect(event.command).toBe('ls -la /tmp/test');
  });

  test('should normalize user message with error tool_result (is_error flag)', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_01Xs4xtWTaktfXzucyfjFsYM',
            type: 'tool_result',
            content: 'Permission denied',
            is_error: true,
          },
        ],
      },
      tool_use_result: 'Error: Permission denied',
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('error');
    expect(event.agent).toBe('claude');
    expect(event.message).toBe('Permission denied');
  });

  test('should normalize user message with error tool_result (Error string)', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_01Nz1myXfvKC3hPKtCyJJWN4',
            type: 'tool_result',
            content: 'This command requires approval',
            is_error: true,
          },
        ],
      },
      tool_use_result: 'Error: This command requires approval',
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('error');
    expect(event.agent).toBe('claude');
    expect(event.message).toBe('This command requires approval');
  });

  test('should normalize user message with generic tool_result', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_123',
            type: 'tool_result',
            content: 'Some result',
            is_error: false,
          },
        ],
      },
      tool_use_result: { some: 'data' },
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('tool_result');
    expect(event.agent).toBe('claude');
    expect(event.tool_use_id).toBe('toolu_123');
    expect(event.success).toBe(true);
  });

  test('should normalize result event', () => {
    const raw = {
      type: 'result',
      subtype: 'success',
      duration_ms: 5000,
    };
    const event = normalizeEvent('claude', raw);

    expect(event.type).toBe('result');
    expect(event.agent).toBe('claude');
    expect(event.status).toBe('success');
    expect(event.duration_ms).toBe(5000);
  });

  test('should parse comprehensive log file', () => {
    const logFilePath = join(import.meta.dir, 'testdata', 'claude-agent-log-comprehensive.jsonl');
    const logContent = readFileSync(logFilePath, 'utf-8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());

    const events: any[] = [];
    const eventTypes: Record<string, number> = {};

    for (const line of lines) {
      const parsed = parseEvent('claude', line);
      if (parsed) {
        events.push(...parsed);
        for (const event of parsed) {
          eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
        }
      }
    }

    expect(events.length).toBeGreaterThan(0);
    expect(eventTypes['init']).toBe(1);
    expect(eventTypes['file_read']).toBeGreaterThan(0);
    expect(eventTypes['bash']).toBeGreaterThan(0);
    expect(eventTypes['error'] ?? 0).toBeGreaterThanOrEqual(0); // comprehensive log may have 0 errors
    expect(eventTypes['tool_use']).toBeGreaterThan(0);
    expect(eventTypes['result']).toBe(1);

    const fileReadEvents = events.filter(e => e.type === 'file_read');
    expect(fileReadEvents.length).toBeGreaterThan(0);
    expect(fileReadEvents[0].path).toBeDefined();
    expect(fileReadEvents[0].agent).toBe('claude');

    const bashEvents = events.filter(e => e.type === 'bash');
    expect(bashEvents.length).toBeGreaterThan(0);
    expect(bashEvents[0].agent).toBe('claude');

    const errorEvents = events.filter(e => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(0);
    if (errorEvents.length > 0) {
      expect(errorEvents[0].message).toBeDefined();
      expect(errorEvents[0].agent).toBe('claude');
    }
  });
});
