import { describe, it, expect } from 'vitest';
import {
  AgentSummary,
  summarizeEvents,
  getDelta,
  filterEventsByPriority,
} from '../src/summarizer.js';

describe('SummarizeEvents', () => {
  it('should handle empty events', () => {
    const summary = summarizeEvents('test-1', 'codex', 'running', [], null);

    expect(summary.agentId).toBe('test-1');
    expect(summary.agentType).toBe('codex');
    expect(summary.status).toBe('running');
    expect(summary.filesModified.size).toBe(0);
    expect(summary.toolsUsed.size).toBe(0);
    expect(summary.toolCallCount).toBe(0);
  });

  it('should extract file operations', () => {
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

  it('should track tool usage', () => {
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

  it('should extract errors', () => {
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

  it('should extract final message', () => {
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

  it('should extract duration from result event', () => {
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

  it('should track event count', () => {
    const events = Array(10).fill({ type: 'init', timestamp: '2024-01-01' });

    const summary = summarizeEvents('test-7', 'codex', 'running', events);

    expect(summary.eventCount).toBe(10);
  });
});

describe('SummaryToDict', () => {
  it('should serialize brief detail level correctly', () => {
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

  it('should serialize standard detail level correctly', () => {
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

  it('should serialize detailed detail level correctly', () => {
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
  it('should return no changes when no new events', () => {
    const events = [
      { type: 'init', timestamp: '2024-01-01' },
      { type: 'file_write', path: 'src/auth.ts', timestamp: '2024-01-01' },
    ];

    const delta = getDelta('test-11', 'codex', 'completed', events, 2);

    expect(delta.new_events_count).toBe(0);
    expect(delta.has_changes).toBe(false);
    expect(delta.since_event).toBe(2);
  });

  it('should return new events in delta', () => {
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

  it('should include latest message in delta', () => {
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
  it('should filter to critical events only', () => {
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

  it('should filter to critical and important events', () => {
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
