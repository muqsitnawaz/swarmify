import { describe, expect, test } from 'bun:test';
import { extractSessionQuickDetails, extractSessionQuickSummary } from './session.summary';

describe('extractSessionQuickSummary', () => {
  test('parses Claude session summary details', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/a.ts' } },
            { type: 'tool_use', name: 'WebSearch', input: { query: 'foo' } },
            { type: 'tool_use', name: 'mcp__Swarm__status', input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        tool_use_result: {
          type: 'create',
          filePath: '/repo/src/new.ts',
        },
      }),
      JSON.stringify({
        type: 'result',
        usage: {
          server_tool_use: {
            web_search_requests: 2,
            web_fetch_requests: 1,
          },
        },
      }),
    ];

    const summary = extractSessionQuickSummary(lines.join('\n'), 'claude');
    expect(summary.filesEdited).toBe(2);
    expect(summary.filesCreated).toBe(1);
    expect(summary.toolCalls).toBe(3);
    expect(summary.webSearches).toBe(2);
    expect(summary.webFetches).toBe(1);
    expect(summary.mcpCalls).toBe(1);
  });

  test('parses Codex function calls with JSON-string arguments', () => {
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'write_file',
          arguments: '{"path":"src/a.ts"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'read_file',
          arguments: '{"path":"src/a.ts"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'web_search',
          arguments: '{"query":"terminal colors"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'mcp__Swarm__status',
          arguments: '{}',
        },
      }),
    ];

    const summary = extractSessionQuickSummary(lines.join('\n'), 'codex');
    expect(summary.filesEdited).toBe(1);
    expect(summary.filesRead).toBe(1);
    expect(summary.toolCalls).toBe(4);
    expect(summary.webSearches).toBe(1);
    expect(summary.mcpCalls).toBe(1);
  });

  test('parses Gemini tool calls', () => {
    const lines = [
      JSON.stringify({
        type: 'tool_use',
        tool_name: 'write_file',
        parameters: { file_path: 'src/b.ts' },
      }),
      JSON.stringify({
        type: 'tool_call',
        tool_name: 'run_shell_command',
        parameters: { command: 'ls -la' },
      }),
      JSON.stringify({
        type: 'tool_use',
        tool_name: 'web_fetch',
        parameters: { url: 'https://example.com' },
      }),
      JSON.stringify({
        type: 'tool_use',
        tool_name: 'mcp__linear__issues',
        parameters: {},
      }),
      JSON.stringify({
        type: 'tool_call',
        tool_name: 'delete_file',
        parameters: { file_path: 'src/old.ts' },
      }),
    ];

    const summary = extractSessionQuickSummary(lines.join('\n'), 'gemini');
    expect(summary.filesEdited).toBe(2);
    expect(summary.filesDeleted).toBe(1);
    expect(summary.toolCalls).toBe(5);
    expect(summary.webFetches).toBe(1);
    expect(summary.mcpCalls).toBe(1);
  });

  test('ignores malformed lines', () => {
    const content = [
      'not-json',
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } }),
      '',
    ].join('\n');

    const summary = extractSessionQuickSummary(content, 'codex');
    expect(summary.filesEdited).toBe(0);
    expect(summary.toolCalls).toBe(0);
    expect(summary.webSearches).toBe(0);
    expect(summary.mcpCalls).toBe(0);
  });

  test('returns recent files and tools in recency order', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/a.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/b.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/c.ts' } },
            { type: 'tool_use', name: 'WebSearch', input: { query: 'foo' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/b.ts' } },
          ],
        },
      }),
    ];

    const details = extractSessionQuickDetails(lines.join('\n'), 'claude');
    expect(details.lastFilePath).toBe('/repo/src/b.ts');
    expect(details.recentFiles[0]).toBe('/repo/src/b.ts');
    expect(details.recentFiles[1]).toBe('/repo/src/c.ts');
    expect(details.recentTools[0]).toBe('Edit');
    expect(details.recentTools[1]).toBe('WebSearch');
    expect(details.recentTools[2]).toBe('Read');
  });
});
