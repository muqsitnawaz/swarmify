import { describe, test, expect } from 'bun:test';
import { spawn } from 'child_process';
import { normalizeEvents } from '../src/parsers.js';
import { summarizeEvents, getQuickStatus, getToolBreakdown } from '../src/summarizer.js';

/**
 * Run cursor-agent and capture its JSON output.
 * Returns parsed and normalized events.
 */
async function runCursorAgent(prompt: string, timeoutMs: number = 60000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', prompt];
    const proc = spawn('cursor-agent', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`cursor-agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0 && !stdout) {
        reject(new Error(`cursor-agent exited with code ${code}: ${stderr}`));
        return;
      }

      // Parse JSONL output
      const lines = stdout.split('\n').filter(line => line.trim());
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

      resolve(allEvents);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('Cursor Live E2E', () => {
  test('should spawn cursor-agent and parse tool calls correctly', async () => {
    const testFile = `/tmp/cursor-live-test-${Date.now()}.txt`;
    const prompt = `Create a file at ${testFile} with the content 'hello from live test' using echo command`;

    console.log('Running cursor-agent with prompt:', prompt);

    const events = await runCursorAgent(prompt, 120000);

    console.log('Total events:', events.length);

    // Count event types
    const typeCounts: Record<string, number> = {};
    for (const event of events) {
      typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
    }
    console.log('Event type counts:', typeCounts);

    // Should have some events
    expect(events.length).toBeGreaterThan(0);

    // Should have bash events (echo command)
    expect(typeCounts['bash']).toBeGreaterThanOrEqual(1);

    // Should have result event
    expect(typeCounts['result']).toBe(1);

    // Test summarizer
    const summary = summarizeEvents('live-agent', 'cursor', 'completed', events, null);
    console.log('Summary:', {
      toolCallCount: summary.toolCallCount,
      bashCommands: summary.bashCommands,
      filesModified: Array.from(summary.filesModified),
    });

    expect(summary.toolCallCount).toBeGreaterThan(0);
    expect(summary.bashCommands.length).toBeGreaterThan(0);

    // Test quick status
    const quickStatus = getQuickStatus('live-agent', 'cursor', 'completed', events);
    console.log('Quick status:', quickStatus);

    expect(quickStatus.tool_count).toBeGreaterThan(0);

    // Test tool breakdown
    const breakdown = getToolBreakdown(events);
    console.log('Tool breakdown:', breakdown);

    expect(breakdown['bash']).toBeGreaterThanOrEqual(1);

    // Cleanup
    try {
      const { unlinkSync } = await import('fs');
      unlinkSync(testFile);
    } catch {
      // File may not exist if cursor failed
    }
  }, 120000); // 2 minute timeout for the test
});
