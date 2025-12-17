import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeEvents } from '../src/parsers.js';
import { summarizeEvents, getQuickStatus, getToolBreakdown } from '../src/summarizer.js';

const TESTDATA_DIR = path.join(import.meta.dir, 'testdata');

/**
 * Parse a JSONL file and normalize all events through our cursor parser.
 */
function parseJsonlFile(filename: string): any[] {
  const filepath = path.join(TESTDATA_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const allEvents: any[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line);
      const normalized = normalizeEvents('cursor', raw);
      allEvents.push(...normalized);
    } catch (e) {
      // Skip malformed lines
    }
  }
  return allEvents;
}

describe('Cursor E2E Parsing', () => {
  test('should parse real cursor output and count tool calls correctly', () => {
    const events = parseJsonlFile('cursor_create_file.jsonl');

    // Should have parsed events
    expect(events.length).toBeGreaterThan(0);

    // Count event types
    const typeCounts: Record<string, number> = {};
    for (const event of events) {
      typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
    }

    console.log('Event type counts:', typeCounts);

    // Should have bash events from shell tool calls
    expect(typeCounts['bash']).toBeGreaterThanOrEqual(2); // echo and cat commands

    // Should have file_write from editToolCall
    expect(typeCounts['file_write']).toBeGreaterThanOrEqual(1);

    // Should have result event
    expect(typeCounts['result']).toBe(1);

    // Should have message events
    expect(typeCounts['message']).toBeGreaterThanOrEqual(1);
  });

  test('should correctly summarize cursor events', () => {
    const events = parseJsonlFile('cursor_create_file.jsonl');

    const summary = summarizeEvents('test-agent', 'cursor', 'completed', events, '5 seconds');

    console.log('Summary:', {
      filesModified: Array.from(summary.filesModified),
      toolCallCount: summary.toolCallCount,
      bashCommands: summary.bashCommands,
      toolsUsed: Array.from(summary.toolsUsed),
    });

    // Should have counted file modifications
    expect(summary.filesModified.size).toBeGreaterThanOrEqual(1);

    // Should have counted tool calls (bash + file_write)
    expect(summary.toolCallCount).toBeGreaterThanOrEqual(3);

    // Should have bash commands
    expect(summary.bashCommands.length).toBeGreaterThanOrEqual(2);
    expect(summary.bashCommands.some(cmd => cmd.includes('echo'))).toBe(true);
    expect(summary.bashCommands.some(cmd => cmd.includes('cat'))).toBe(true);

    // Should have tools used
    expect(summary.toolsUsed.has('bash')).toBe(true);
  });

  test('should produce correct quick status', () => {
    const events = parseJsonlFile('cursor_create_file.jsonl');

    const quickStatus = getQuickStatus('test-agent', 'cursor', 'completed', events);

    console.log('Quick status:', quickStatus);

    // Should have non-zero tool count
    expect(quickStatus.tool_count).toBeGreaterThan(0);

    // Should have file modifications
    expect(quickStatus.files_modified).toBeGreaterThanOrEqual(1);

    // Should have last commands
    expect(quickStatus.last_commands.length).toBeGreaterThan(0);
  });

  test('should produce correct tool breakdown', () => {
    const events = parseJsonlFile('cursor_create_file.jsonl');

    const breakdown = getToolBreakdown(events);

    console.log('Tool breakdown:', breakdown);

    // Should have bash calls
    expect(breakdown['bash']).toBeGreaterThanOrEqual(2);

    // Should have file_write calls
    expect(breakdown['file_write']).toBeGreaterThanOrEqual(1);
  });
});
