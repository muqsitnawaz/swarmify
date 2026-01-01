import { describe, test, expect } from 'bun:test';
import {
  AgentSummary,
  summarizeEvents,
  getDelta,
  filterEventsByPriority,
  getQuickStatus,
  getLastMessages,
} from '../src/summarizer.js';

describe('GetLastMessages', () => {
  test('should return standard complete messages', () => {
    const events = [
      { type: 'message', content: 'First', complete: true },
      { type: 'message', content: 'Second', complete: true },
      { type: 'message', content: 'Third', complete: true },
    ];
    
    const messages = getLastMessages(events, 3);
    expect(messages).toEqual(['First', 'Second', 'Third']);
  });

  test('should return last N messages', () => {
    const events = [
      { type: 'message', content: 'One', complete: true },
      { type: 'message', content: 'Two', complete: true },
      { type: 'message', content: 'Three', complete: true },
      { type: 'message', content: 'Four', complete: true },
    ];
    
    const messages = getLastMessages(events, 2);
    expect(messages).toEqual(['Three', 'Four']);
  });

  test('should concatenate streaming messages', () => {
    const events = [
      { type: 'message', content: 'Hello', complete: false },
      { type: 'message', content: ' World', complete: false },
      { type: 'tool_use', tool: 'test' }, // Break stream
      { type: 'message', content: 'Another', complete: false },
      { type: 'message', content: ' message', complete: false },
      { type: 'result', status: 'success' } // Break stream
    ];
    
    const messages = getLastMessages(events, 3);
    expect(messages).toEqual(['Hello World', 'Another message']);
  });

  test('should handle mixed complete and streaming messages', () => {
    const events = [
      { type: 'message', content: 'Complete msg', complete: true },
      { type: 'message', content: 'Stream', complete: false },
      { type: 'message', content: 'ing', complete: false },
      { type: 'tool_use', tool: 'test' }
    ];
    
    const messages = getLastMessages(events, 3);
    expect(messages).toEqual(['Complete msg', 'Streaming']);
  });
  
  test('should handle streaming messages at the very end', () => {
      const events = [
          { type: 'message', content: 'Start', complete: false },
          { type: 'message', content: 'ing', complete: false }
      ];
      const messages = getLastMessages(events, 3);
      expect(messages).toEqual(['Starting']);
  });
});

describe('SummarizeEvents', () => {
  test('should handle empty events', () => {
    const summary = summarizeEvents('test-1', 'codex', 'running', [], null);

    expect(summary.agentId).toBe('test-1');
    expect(summary.agentType).toBe('codex');
    expect(summary.status).toBe('running');
    expect(summary.filesModified.size).toBe(0);
    expect(summary.toolsUsed.size).toBe(0);
    expect(summary.toolCallCount).toBe(0);
  });

  test('should extract file operations', () => {
    const events = [
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'file_create', path: 'src/types.ts', timestamp: '2024-01-01' },
      { type: 'file_read', path: 'src/config.ts', timestamp: '2024-01-01' },
      { type: 'file_delete', path: 'src/old.ts', timestamp: '2024-01-01' },
    ];

    const summary = summarizeEvents('test-2', 'codex', 'completed', events, '5 seconds');

    expect(summary.filesModified.has('src/auth.ts')).toBe(true);
    expect(summary.filesCreated.has('src/types.ts')).toBe(true);
    expect(summary.filesRead.has('src/config.ts')).toBe(true);
    expect(summary.filesDeleted.has('src/old.ts')).toBe(true);
    expect(summary.toolCallCount).toBe(4);
  });

  test('should track tool usage', () => {
    const events = [
      { type: 'tool_use', tool: 'write_file', timestamp: '2024-01-01' },
      { type: 'tool_use', tool: 'read_file', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm install', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
    ];

    const summary = summarizeEvents('test-3', 'codex', 'running', events);

    expect(summary.toolsUsed.has('write_file')).toBe(true);
    expect(summary.toolsUsed.has('read_file')).toBe(true);
    expect(summary.toolsUsed.has('bash')).toBe(true);
    expect(summary.toolCallCount).toBe(4);
    expect(summary.bashCommands.length).toBe(2);
    expect(summary.bashCommands).toContain('npm install');
    expect(summary.bashCommands).toContain('npm test');
  });

  test('should extract errors', () => {
    const events = [
      { type: 'error', message: 'File not found', timestamp: '2024-01-01' },
      {
        type: 'result',
        status: 'error',
        message: 'Task failed',
        timestamp: '2024-01-01',
      },
    ];

    const summary = summarizeEvents('test-4', 'codex', 'failed', events);

    expect(summary.errors.length).toBeGreaterThan(0);
  });

  test('should extract final message', () => {
    const events = [
      {
        type: 'message',
        content: 'Starting task...',
        complete: false,
        timestamp: '2024-01-01',
      },
      {
        type: 'message',
        content: 'Task completed successfully!',
        complete: true,
        timestamp: '2024-01-01',
      },
    ];

    const summary = summarizeEvents('test-5', 'codex', 'completed', events);

    expect(summary.finalMessage).toBe('Task completed successfully!');
  });

  test('should extract duration from result event', () => {
    const events = [
      {
        type: 'result',
        status: 'success',
        duration_ms: 7500,
        timestamp: '2024-01-01',
      },
    ];

    const summary = summarizeEvents('test-6', 'codex', 'completed', events, null);

    expect(summary.duration).toBe('7.5 seconds');
  });

  test('should track event count', () => {
    const events = Array(10).fill({ type: 'init', timestamp: '2024-01-01' });

    const summary = summarizeEvents('test-7', 'codex', 'running', events);

    expect(summary.eventCount).toBe(10);
  });
});

describe('SummaryToDict', () => {
  test('should serialize brief detail level correctly', () => {
    const events = [
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/types.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/config.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/utils.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/main.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/extra.ts', timestamp: '2024-01-01' },
    ];

    const summary = summarizeEvents('test-8', 'codex', 'completed', events, '5 seconds');

    const result = summary.toDict('brief');

    expect(result.agent_id).toBe('test-8');
    expect(result.agent_type).toBe('codex');
    expect(result.status).toBe('completed');
    expect(result.files_modified.length).toBe(5);
    expect(result.duration).toBe('5 seconds');
    expect(result.tool_call_count).toBe(6);
    expect(result.last_activity).toBe('file_write');
  });

  test('should serialize standard detail level correctly', () => {
    const events = [
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'tool_use', tool: 'write_file', timestamp: '2024-01-01' },
      {
        type: 'message',
        content: 'Done!'.repeat(100),
        complete: true,
        timestamp: '2024-01-01',
      },
    ];

    const summary = summarizeEvents('test-9', 'codex', 'completed', events, '5 seconds');

    const result = summary.toDict('standard');

    expect(result.duration).toBe('5 seconds');
    expect(result.files_modified).toBeDefined();
    expect(result.tools_used).toBeDefined();
    expect(result.tool_call_count).toBeDefined();
    expect(result.errors).toBeDefined();
    expect(result.final_message).toBeDefined();
  });

  test('should serialize detailed detail level correctly', () => {
    const events = [
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'file_read', path: 'src/config.ts', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm install', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
    ];

    const summary = summarizeEvents('test-10', 'codex', 'completed', events);

    const result = summary.toDict('detailed');

    expect(result.files_read).toBeDefined();
    expect(result.files_deleted).toBeDefined();
    expect(result.bash_commands).toBeDefined();
    expect(result.warnings).toBeDefined();
    expect(result.event_count).toBeDefined();
    expect(result.last_activity).toBeDefined();
    expect(result.bash_commands.length).toBe(2);
  });
});

describe('GetDelta', () => {
  test('should return no changes when no new events', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
    ];

    const delta = getDelta('test-11', 'codex', 'completed', events, 2);

    expect(delta.new_events_count).toBe(0);
    expect(delta.has_changes).toBe(false);
    expect(delta.since_event).toBe(2);
  });

  test('should return new events in delta', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/types.ts', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm install', timestamp: '2024-01-01' },
    ];

    const delta = getDelta('test-12', 'codex', 'running', events, 1);

    expect(delta.new_events_count).toBe(3);
    expect(delta.has_changes).toBe(true);
    expect(delta.current_event_count).toBe(4);
    expect(delta.new_files_modified).toContain('src/types.ts');
    expect(delta.new_tool_calls.length).toBeGreaterThan(0);
  });

  test('should include latest message in delta', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      {
        type: 'message',
        content: 'Working on it...',
        complete: true,
        timestamp: '2024-01-01',
      },
    ];

    const delta = getDelta('test-13', 'codex', 'running', events, 0);

    expect(delta.latest_message).toBe('Working on it...');
  });
});

describe('EventPriorityFiltering', () => {
  test('should filter to critical events only', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'error', message: 'Failed', timestamp: '2024-01-01' },
      { type: 'thinking', content: 'Hmm...', timestamp: '2024-01-01' },
    ];

    const filtered = filterEventsByPriority(events, ['critical']);

    expect(filtered.length).toBe(2);
    expect(filtered.some(e => e.type === 'file_write')).toBe(true);
    expect(filtered.some(e => e.type === 'error')).toBe(true);
    expect(filtered.some(e => e.type === 'init')).toBe(false);
    expect(filtered.some(e => e.type === 'thinking')).toBe(false);
  });

  test('should filter to critical and important events', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
      { type: 'tool_use', tool: 'read_file', timestamp: '2024-01-01' },
      { type: 'thinking', content: 'Hmm...', complete: true, timestamp: '2024-01-01' },
    ];

    const filtered = filterEventsByPriority(events, ['critical', 'important']);

    expect(filtered.length).toBe(3);
    expect(filtered.some(e => e.type === 'file_write')).toBe(true);
    expect(filtered.some(e => e.type === 'tool_use')).toBe(true);
    expect(filtered.some(e => e.type === 'thinking')).toBe(true);
    expect(filtered.some(e => e.type === 'init')).toBe(false);
  });
});

describe('GetQuickStatus', () => {
  test('should return correct counts for empty events', () => {
    const status = getQuickStatus('test-1', 'codex', 'running', []);

    expect(status.agent_id).toBe('test-1');
    expect(status.agent_type).toBe('codex');
    expect(status.status).toBe('running');
    expect(status.files_created).toBe(0);
    expect(status.files_modified).toBe(0);
    expect(status.files_deleted).toBe(0);
    expect(status.files_read).toBe(0);
    expect(status.tool_count).toBe(0);
    expect(status.last_commands).toEqual([]);
    expect(status.has_errors).toBe(false);
  });

  test('should count file operations correctly', () => {
    const events = [
      { type: 'file_create', path: 'src/new.ts', timestamp: '2024-01-01' },
      { type: 'file_create', path: 'src/another.ts', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/existing.ts', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-2', 'codex', 'running', events);

    expect(status.files_created).toBe(2);
    expect(status.files_modified).toBe(1);
    expect(status.tool_count).toBe(3);
  });

  test('should track last bash commands', () => {
    const events = [
      { type: 'bash', command: 'npm install', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm run build', timestamp: '2024-01-01' },
      { type: 'bash', command: 'npm run lint', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-3', 'codex', 'running', events);

    expect(status.last_commands.length).toBe(3);
    expect(status.last_commands).toContain('npm test');
    expect(status.last_commands).toContain('npm run build');
    expect(status.last_commands).toContain('npm run lint');
    expect(status.last_commands).not.toContain('npm install');
  });

  test('should truncate long commands', () => {
    const longCommand = 'a'.repeat(150);
    const events = [
      { type: 'bash', command: longCommand, timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-4', 'codex', 'running', events);

    expect(status.last_commands[0].length).toBe(100);
    expect(status.last_commands[0].endsWith('...')).toBe(true);
  });

  test('should detect errors', () => {
    const events = [
      { type: 'error', message: 'Something went wrong', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-5', 'codex', 'failed', events);

    expect(status.has_errors).toBe(true);
  });

  test('should detect errors from result events', () => {
    const events = [
      { type: 'result', status: 'error', message: 'Task failed', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-6', 'codex', 'failed', events);

    expect(status.has_errors).toBe(true);
  });

  test('should count other tool uses', () => {
    const events = [
      { type: 'tool_use', tool: 'read_file', timestamp: '2024-01-01' },
      { type: 'file_read', path: 'src/config.ts', timestamp: '2024-01-01' },
      { type: 'file_delete', path: 'src/old.ts', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-7', 'codex', 'running', events);

    expect(status.tool_count).toBe(3);
    expect(status.files_read).toBe(1);
    expect(status.files_deleted).toBe(1);
  });

  test('should extract file operations from bash commands', () => {
    const events = [
      { type: 'bash', command: "echo 'hello' > /tmp/test.txt", timestamp: '2024-01-01' },
      { type: 'bash', command: 'cat /tmp/test.txt', timestamp: '2024-01-01' },
      { type: 'bash', command: "echo 'world' >> /tmp/test.txt", timestamp: '2024-01-01' },
      { type: 'bash', command: 'rm /tmp/test.txt', timestamp: '2024-01-01' },
    ];

    const status = getQuickStatus('test-8', 'cursor', 'running', events);

    expect(status.files_modified).toBeGreaterThanOrEqual(1);
    expect(status.files_read).toBeGreaterThanOrEqual(1);
    expect(status.files_deleted).toBeGreaterThanOrEqual(1);
    expect(status.tool_count).toBe(4);
    expect(status.last_commands.length).toBe(3);
  });
});
