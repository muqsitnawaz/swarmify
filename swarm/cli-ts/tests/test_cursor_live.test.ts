import { describe, test, expect } from 'bun:test';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeEvents } from '../src/parsers.js';
import { summarizeEvents, getQuickStatus, getToolBreakdown } from '../src/summarizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run cursor-agent and capture its JSON output.
 * Returns parsed and normalized events, plus raw events and raw stdout for logging.
 */
async function runCursorAgent(prompt: string, timeoutMs: number = 60000): Promise<{ events: any[], rawEvents: any[], rawStdout: string }> {
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

      const lines = stdout.split('\n').filter(line => line.trim());
      const allEvents: any[] = [];
      const rawEvents: any[] = [];

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          rawEvents.push(raw);
          const normalized = normalizeEvents('cursor', raw);
          allEvents.push(...normalized);
        } catch (e) {
          // Skip malformed lines
        }
      }

      resolve({ events: allEvents, rawEvents, rawStdout: stdout });
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

    const { events, rawEvents, rawStdout } = await runCursorAgent(prompt, 120000);

    console.log('Total events:', events.length);

    const typeCounts: Record<string, number> = {};
    for (const event of events) {
      typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
    }
    console.log('Event type counts:', typeCounts);

    expect(events.length).toBeGreaterThan(0);
    expect(typeCounts['bash']).toBeGreaterThanOrEqual(1);
    expect(typeCounts['result']).toBe(1);

    const summary = summarizeEvents('live-agent', 'cursor', 'completed', events, null);
    const testdataDir = join(__dirname, 'testdata');
    const summaryFilePath = join(testdataDir, 'cursor-summary-simple.jsonl');
    const { writeFileSync } = await import('fs');
    writeFileSync(summaryFilePath, JSON.stringify(summary.toDict('detailed')) + '\n', 'utf-8');
    console.log(`Saved summary to: ${summaryFilePath}`);
    console.log('Summary:', {
      toolCallCount: summary.toolCallCount,
      bashCommands: summary.bashCommands,
      filesModified: Array.from(summary.filesModified),
    });

    expect(summary.toolCallCount).toBeGreaterThan(0);
    expect(summary.bashCommands.length).toBeGreaterThan(0);

    const quickStatus = getQuickStatus('live-agent', 'cursor', 'completed', events);
    console.log('Quick status:', quickStatus);

    expect(quickStatus.tool_count).toBeGreaterThan(0);

    const breakdown = getToolBreakdown(events);
    console.log('Tool breakdown:', breakdown);

    expect(breakdown['bash']).toBeGreaterThanOrEqual(1);

    try {
      const { unlinkSync } = await import('fs');
      unlinkSync(testFile);
    } catch {
      // File may not exist if cursor failed
    }
  }, 120000);

  test('should handle comprehensive file operations', async () => {
    const testDir = `/tmp/cursor-comprehensive-test-${Date.now()}`;
    const testDataPath = `${testDir}/tests/testdata`;
    
    const { mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } = await import('fs');
    
    try {
      mkdirSync(testDataPath, { recursive: true });
      mkdirSync(join(testDataPath, 'dir1'), { recursive: true });
      mkdirSync(join(testDataPath, 'dir2'), { recursive: true });
      mkdirSync(join(testDataPath, 'dir3'), { recursive: true });
      
      writeFileSync(join(testDataPath, 'dir1', 'file1.py'), 'def hello():\n    print("Hello")\n');
      writeFileSync(join(testDataPath, 'dir1', 'file2.ts'), 'export const x = 1;\n');
      writeFileSync(join(testDataPath, 'dir2', 'file3.md'), '# File 3\n');
      writeFileSync(join(testDataPath, 'dir2', 'file4.json'), '{"name": "file4"}\n');
      writeFileSync(join(testDataPath, 'dir3', 'file5.py'), 'def process():\n    pass\n');
      writeFileSync(join(testDataPath, 'dir3', 'file6.ts'), 'export const y = 2;\n');
      writeFileSync(join(testDataPath, 'dir3', 'file7.md'), '# File 7\n');
      writeFileSync(join(testDataPath, 'root1.json'), '{"root": true}\n');
      writeFileSync(join(testDataPath, 'root2.md'), '# Root\n');
      
      const fileToDelete = join(testDataPath, 'dir1', 'file1.py');
      const deletedFileContent = readFileSync(fileToDelete, 'utf-8');
      
      const prompt = `Working in ${testDataPath}, do the following:
1. List directory contents using ls command
2. Read the file dir1/file1.py to get its content
3. Modify dir1/file2.ts to add a new export
4. Delete dir1/file1.py using rm command
5. After deletion, tell me how many files are left in dir1
6. Recreate dir1/file1.py with the same content it had before deletion
7. Create a new directory called dir4 using mkdir command
8. Create a new file dir4/newfile.txt with content "new file"`;

      console.log('Running comprehensive test with prompt:', prompt);
      console.log('Raw event types before normalization:');
      
      const { events, rawEvents, rawStdout } = await runCursorAgent(prompt, 180000);
      
      const testdataDir = join(__dirname, 'testdata');
      const logFilePath = join(testdataDir, 'cursor-agent-log-comprehensive.jsonl');
      writeFileSync(logFilePath, rawStdout, 'utf-8');
      console.log(`Saved full stdout to: ${logFilePath}`);
      
      const rawTypeCounts: Record<string, number> = {};
      for (const raw of rawEvents) {
        const rawType = raw.type || 'unknown';
        rawTypeCounts[rawType] = (rawTypeCounts[rawType] || 0) + 1;
        if (raw.subtype) {
          const fullType = `${rawType}.${raw.subtype}`;
          rawTypeCounts[fullType] = (rawTypeCounts[fullType] || 0) + 1;
        }
      }
      console.log('Raw event type counts:', rawTypeCounts);
      console.log('Sample raw events:', rawEvents.slice(0, 5).map(r => ({ type: r.type, subtype: r.subtype, tool_call: r.tool_call ? Object.keys(r.tool_call) : null })));
      
      console.log('Total normalized events:', events.length);
      
      const typeCounts: Record<string, number> = {};
      for (const event of events) {
        typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
      }
      console.log('Normalized event type counts:', typeCounts);
      
      expect(events.length).toBeGreaterThan(0);
      expect(typeCounts['result']).toBe(1);
      
      const summary = summarizeEvents('comprehensive-agent', 'cursor', 'completed', events, null);
      const summaryFilePath = join(testdataDir, 'cursor-summary-comprehensive.jsonl');
      writeFileSync(summaryFilePath, JSON.stringify(summary.toDict('detailed')) + '\n', 'utf-8');
      console.log(`Saved summary to: ${summaryFilePath}`);
      console.log('Summary:', {
        toolCallCount: summary.toolCallCount,
        filesCreated: Array.from(summary.filesCreated),
        filesModified: Array.from(summary.filesModified),
        filesRead: Array.from(summary.filesRead),
        filesDeleted: Array.from(summary.filesDeleted),
        bashCommands: summary.bashCommands.slice(-10),
      });
      
      const quickStatus = getQuickStatus('comprehensive-agent', 'cursor', 'completed', events);
      console.log('Quick status:', quickStatus);
      
      expect(quickStatus.tool_count).toBeGreaterThan(0);
      expect(typeCounts['file_read']).toBeGreaterThanOrEqual(1);
      expect(typeCounts['file_write']).toBeGreaterThanOrEqual(1);
      
      const breakdown = getToolBreakdown(events);
      console.log('Tool breakdown:', breakdown);
      
    } finally {
      try {
        const { rmSync } = await import('fs');
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Cleanup failed, ignore
      }
    }
  }, 180000);
});
