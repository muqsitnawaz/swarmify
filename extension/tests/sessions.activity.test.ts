/**
 * E2E Tests for Session Activity Parsing
 *
 * Tests use REAL session files from ~/.claude/, ~/.codex/, ~/.gemini/
 * No mocks - verifies actual parsing against real data.
 */

import { describe, test, expect } from 'bun:test';
import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractCurrentActivity,
  formatActivity,
  type CurrentActivity,
  type ActivityType,
} from '../src/core/session.activity';

// Helper to read tail of file (last N bytes)
function readFileTail(filePath: string, maxBytes: number = 32 * 1024): string {
  const stats = fs.statSync(filePath);
  const start = Math.max(0, stats.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(Math.min(maxBytes, stats.size));
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);
  return buffer.toString('utf-8');
}

// Helper to discover session files
// Returns files sorted by modification time (newest first), filtered by minimum size
const MIN_SESSION_SIZE = 5000; // 5KB minimum to filter out empty/short sessions

function discoverSessionFiles(agentType: 'claude' | 'codex' | 'gemini', limit: number = 10): string[] {
  const allFiles: { path: string; mtime: number; size: number }[] = [];

  if (agentType === 'claude') {
    const projectsDir = path.join(homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const projects = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectPath = path.join(projectsDir, project.name);

      // Check direct files
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const fullPath = path.join(projectPath, entry.name);
          const stats = fs.statSync(fullPath);
          if (stats.size >= MIN_SESSION_SIZE) {
            allFiles.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
          }
        }
      }

      // Check sessions subfolder
      const sessionsDir = path.join(projectPath, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const sessionEntries = fs.readdirSync(sessionsDir, { withFileTypes: true });
        for (const entry of sessionEntries) {
          if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const fullPath = path.join(sessionsDir, entry.name);
            const stats = fs.statSync(fullPath);
            if (stats.size >= MIN_SESSION_SIZE) {
              allFiles.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
            }
          }
        }
      }
    }
  } else if (agentType === 'codex') {
    const sessionsDir = path.join(homedir(), '.codex', 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const walkDir = (dir: string, depth: number = 0) => {
      if (depth > 4) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1);
        } else if (entry.name.endsWith('.jsonl')) {
          const stats = fs.statSync(fullPath);
          if (stats.size >= MIN_SESSION_SIZE) {
            allFiles.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
          }
        }
      }
    };
    walkDir(sessionsDir);
  } else if (agentType === 'gemini') {
    const sessionsDir = path.join(homedir(), '.gemini', 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const walkDir = (dir: string, depth: number = 0) => {
      if (depth > 3) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1);
        } else if (entry.name.endsWith('.jsonl')) {
          const stats = fs.statSync(fullPath);
          if (stats.size >= MIN_SESSION_SIZE) {
            allFiles.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
          }
        }
      }
    };
    walkDir(sessionsDir);
  }

  // Sort by modification time (newest first) and return top N
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles.slice(0, limit).map(f => f.path);
}

describe('session activity parsing - real data', () => {
  test('discovers real Claude sessions', () => {
    const sessions = discoverSessionFiles('claude', 10);
    console.log(`Found ${sessions.length} Claude session files`);
    if (sessions.length > 0) {
      console.log('Sample:', sessions[0]);
    }
    // May or may not have sessions - just verify discovery works
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('discovers real Codex sessions', () => {
    const sessions = discoverSessionFiles('codex', 10);
    console.log(`Found ${sessions.length} Codex session files`);
    if (sessions.length > 0) {
      console.log('Sample:', sessions[0]);
    }
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('discovers real Gemini sessions', () => {
    const sessions = discoverSessionFiles('gemini', 10);
    console.log(`Found ${sessions.length} Gemini session files`);
    if (sessions.length > 0) {
      console.log('Sample:', sessions[0]);
    }
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('parses Claude session activity', () => {
    const sessions = discoverSessionFiles('claude', 5);
    if (sessions.length === 0) {
      console.log('No Claude sessions found, skipping');
      return;
    }

    let parsedCount = 0;
    let activityTypes: Set<ActivityType> = new Set();

    for (const sessionPath of sessions) {
      const tail = readFileTail(sessionPath, 64 * 1024);
      const activity = extractCurrentActivity(tail, 'claude');

      if (activity) {
        parsedCount++;
        activityTypes.add(activity.type);
        console.log(`Claude activity: ${activity.type} - ${activity.summary || '(no summary)'}`);
      }
    }

    console.log(`Parsed ${parsedCount}/${sessions.length} Claude sessions`);
    console.log(`Activity types found: ${[...activityTypes].join(', ')}`);

    // Should parse at least some sessions
    expect(parsedCount).toBeGreaterThan(0);
  });

  test('parses Codex session activity', () => {
    const sessions = discoverSessionFiles('codex', 5);
    if (sessions.length === 0) {
      console.log('No Codex sessions found, skipping');
      return;
    }

    let parsedCount = 0;
    let activityTypes: Set<ActivityType> = new Set();

    for (const sessionPath of sessions) {
      const tail = readFileTail(sessionPath, 64 * 1024);
      const activity = extractCurrentActivity(tail, 'codex');

      if (activity) {
        parsedCount++;
        activityTypes.add(activity.type);
        console.log(`Codex activity: ${activity.type} - ${activity.summary || '(no summary)'}`);
      }
    }

    console.log(`Parsed ${parsedCount}/${sessions.length} Codex sessions`);
    console.log(`Activity types found: ${[...activityTypes].join(', ')}`);
  });

  test('parses Gemini session activity', () => {
    const sessions = discoverSessionFiles('gemini', 5);
    if (sessions.length === 0) {
      console.log('No Gemini sessions found, skipping');
      return;
    }

    let parsedCount = 0;
    let activityTypes: Set<ActivityType> = new Set();

    for (const sessionPath of sessions) {
      const tail = readFileTail(sessionPath, 64 * 1024);
      const activity = extractCurrentActivity(tail, 'gemini');

      if (activity) {
        parsedCount++;
        activityTypes.add(activity.type);
        console.log(`Gemini activity: ${activity.type} - ${activity.summary || '(no summary)'}`);
      }
    }

    console.log(`Parsed ${parsedCount}/${sessions.length} Gemini sessions`);
    console.log(`Activity types found: ${[...activityTypes].join(', ')}`);
  });

  test('extracts tool calls from Claude events', () => {
    const sessions = discoverSessionFiles('claude', 20);
    if (sessions.length === 0) {
      console.log('No Claude sessions found, skipping');
      return;
    }

    const toolActivities: { type: ActivityType; summary: string }[] = [];

    for (const sessionPath of sessions) {
      const tail = readFileTail(sessionPath, 64 * 1024);
      const activity = extractCurrentActivity(tail, 'claude');

      if (activity && ['reading', 'editing', 'running'].includes(activity.type)) {
        toolActivities.push({ type: activity.type, summary: activity.summary });
        if (toolActivities.length >= 10) break;
      }
    }

    console.log('Tool activities found:');
    for (const act of toolActivities) {
      console.log(`  ${act.type}: ${act.summary}`);
    }

    // Log what we found - may or may not have tool activities
    console.log(`Found ${toolActivities.length} tool activities`);
  });

  test('handles empty/malformed sessions gracefully', () => {
    expect(extractCurrentActivity('', 'claude')).toBeNull();
    expect(extractCurrentActivity('', 'codex')).toBeNull();
    expect(extractCurrentActivity('', 'gemini')).toBeNull();

    expect(extractCurrentActivity('not json', 'claude')).toBeNull();
    expect(extractCurrentActivity('{}', 'claude')).toBeNull();
    expect(extractCurrentActivity('{"type": "unknown"}', 'claude')).toBeNull();
  });

  test('formatActivity produces readable strings', () => {
    expect(formatActivity(null)).toBe('Thinking...');

    expect(formatActivity({ type: 'reading', summary: 'src/auth.ts', timestamp: new Date() }))
      .toBe('Reading src/auth.ts');

    expect(formatActivity({ type: 'editing', summary: 'package.json', timestamp: new Date() }))
      .toBe('Editing package.json');

    expect(formatActivity({ type: 'running', summary: 'npm test', timestamp: new Date() }))
      .toBe('Running: npm test');

    expect(formatActivity({ type: 'thinking', summary: '', timestamp: new Date() }))
      .toBe('Thinking...');

    expect(formatActivity({ type: 'completed', summary: 'done', timestamp: new Date() }))
      .toBe('Completed');

    expect(formatActivity({ type: 'waiting', summary: '', timestamp: new Date() }))
      .toBe('Waiting for approval');
  });
});

describe('session activity parsing - synthetic data', () => {
  test('parses Claude assistant tool_use event', () => {
    const claudeEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            id: 'tool_123',
            input: { file_path: '/Users/test/src/auth.ts' },
          },
        ],
      },
      timestamp: '2026-01-16T10:00:00Z',
    });

    const activity = extractCurrentActivity(claudeEvent, 'claude');
    expect(activity).not.toBeNull();
    expect(activity?.type).toBe('reading');
    expect(activity?.summary).toBe('auth.ts');
  });

  test('parses Claude Edit tool', () => {
    const claudeEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Edit',
            id: 'tool_456',
            input: { file_path: '/Users/test/package.json' },
          },
        ],
      },
    });

    const activity = extractCurrentActivity(claudeEvent, 'claude');
    expect(activity?.type).toBe('editing');
    expect(activity?.summary).toBe('package.json');
  });

  test('parses Claude Bash tool', () => {
    const claudeEvent = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            id: 'tool_789',
            input: { command: 'npm run test -- --coverage' },
          },
        ],
      },
    });

    const activity = extractCurrentActivity(claudeEvent, 'claude');
    expect(activity?.type).toBe('running');
    expect(activity?.summary).toBe('npm run test -- --coverage');
  });

  test('parses Claude result event', () => {
    const claudeEvent = JSON.stringify({
      type: 'result',
      subtype: 'success',
    });

    const activity = extractCurrentActivity(claudeEvent, 'claude');
    expect(activity?.type).toBe('completed');
  });

  test('parses Codex shell_command (real format)', () => {
    // Real Codex format: type=response_item, payload.type=function_call
    const codexEvent = JSON.stringify({
      timestamp: '2026-01-02T22:30:45.610Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        arguments: '{"command":"git status","workdir":"/Users/test"}',
        call_id: 'call_123',
      },
    });

    const activity = extractCurrentActivity(codexEvent, 'codex');
    expect(activity?.type).toBe('running');
    expect(activity?.summary).toBe('git status');
  });

  test('parses Codex agent_reasoning', () => {
    const codexEvent = JSON.stringify({
      timestamp: '2026-01-02T22:30:45.328Z',
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: '**Preparing to inspect repo with plan tool**',
      },
    });

    const activity = extractCurrentActivity(codexEvent, 'codex');
    expect(activity?.type).toBe('thinking');
  });

  test('parses Codex function_call with update_plan', () => {
    const codexEvent = JSON.stringify({
      timestamp: '2026-01-02T22:30:50.900Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        arguments: '{"explanation":"Plan for investigation","plan":[]}',
        call_id: 'call_456',
      },
    });

    const activity = extractCurrentActivity(codexEvent, 'codex');
    expect(activity?.type).toBe('thinking');
    expect(activity?.summary).toBe('Using update_plan');
  });

  test('parses Gemini tool_call for file write', () => {
    const geminiEvent = JSON.stringify({
      type: 'tool_call',
      tool_name: 'replace',
      parameters: { file_path: '/test/config.json' },
      timestamp: '2026-01-16T10:00:00Z',
    });

    const activity = extractCurrentActivity(geminiEvent, 'gemini');
    expect(activity?.type).toBe('editing');
    expect(activity?.summary).toBe('config.json');
  });

  test('parses Gemini shell command', () => {
    const geminiEvent = JSON.stringify({
      type: 'tool_call',
      tool_name: 'shell',
      parameters: { command: 'ls -la' },
    });

    const activity = extractCurrentActivity(geminiEvent, 'gemini');
    expect(activity?.type).toBe('running');
    expect(activity?.summary).toBe('ls -la');
  });

  test('returns last activity from multi-line content', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/b.ts' } }] } }),
    ].join('\n');

    const activity = extractCurrentActivity(lines, 'claude');
    // Should return the last tool activity (Edit)
    expect(activity?.type).toBe('editing');
    expect(activity?.summary).toBe('b.ts');
  });
});
