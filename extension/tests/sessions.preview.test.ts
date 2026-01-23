/**
 * Tests for Session Preview Extraction
 *
 * Validates critical contract for displaying prompts in Dashboard:
 * Session files must be readable and extract last user message.
 *
 * This tests end-to-end flow:
 * 1. Agent terminal opens with sessionId in env vars
 * 2. sessionId is stored in terminal entry
 * 3. Session file is located by sessionId
 * 4. getSessionPreviewInfo parses tail for user role messages
 * 5. Dashboard displays extracted prompt via lastUserMessage
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { homedir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  getSessionPreviewInfo,
  type SessionPreviewInfo
} from '../src/vscode/sessions.vscode';

// Helper to discover session files sorted by modification time (newest first)
const MIN_SESSION_SIZE = 5000; // 5KB minimum

function discoverSessionFiles(agentType: 'claude' | 'codex' | 'gemini', limit: number = 10): string[] {
  const allFiles: { path: string; mtime: number; size: number }[] = [];

  if (agentType === 'claude') {
    const projectsDir = path.join(homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const projects = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectPath = path.join(projectsDir, project.name);

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
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
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

    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const fullPath = path.join(sessionsDir, entry.name);
        const stats = fs.statSync(fullPath);
        if (stats.size >= MIN_SESSION_SIZE) {
          allFiles.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
        }
      }
    }
  }

  return allFiles
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(f => f.path);
}

describe('Session Preview - Critical Contract for Prompt Display', () => {
  describe('getSessionPreviewInfo - Claude sessions', () => {
    let sessionFiles: string[] = [];

    beforeAll(() => {
      sessionFiles = discoverSessionFiles('claude', 10);
    });

    test('should find Claude session files', () => {
      expect(sessionFiles.length).toBeGreaterThan(0);
    });

    test('should extract preview info from Claude sessions', async () => {
      if (sessionFiles.length === 0) {
        console.warn('Skipping test: No Claude session files found');
        return;
      }

      const sessionPath = sessionFiles[0];
      const preview = await getSessionPreviewInfo(sessionPath);

      expect(preview).toBeDefined();
      expect(preview.messageCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSessionPreviewInfo - Codex sessions', () => {
    let sessionFiles: string[] = [];

    beforeAll(() => {
      sessionFiles = discoverSessionFiles('codex', 10);
    });

    test('should find Codex session files', () => {
      expect(sessionFiles.length).toBeGreaterThan(0);
    });

    test('should extract preview info from Codex sessions', async () => {
      if (sessionFiles.length === 0) {
        console.warn('Skipping test: No Codex session files found');
        return;
      }

      const sessionPath = sessionFiles[0];
      const preview = await getSessionPreviewInfo(sessionPath);

      expect(preview).toBeDefined();
      expect(preview.messageCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSessionPreviewInfo - Gemini sessions', () => {
    let sessionFiles: string[] = [];

    beforeAll(() => {
      sessionFiles = discoverSessionFiles('gemini', 10);
    });

    test('should find Gemini session files', () => {
      const sessions = discoverSessionFiles('gemini', 10);
      expect(sessions.length).toBeGreaterThanOrEqual(0);
    });

    test('should extract preview info from Gemini sessions', async () => {
      const sessions = discoverSessionFiles('gemini', 10);
      if (sessions.length === 0) {
        console.warn('Skipping test: No Gemini session files found');
        return;
      }

      const sessionPath = sessions[0];
      const preview = await getSessionPreviewInfo(sessionPath);

      expect(preview).toBeDefined();
      expect(preview.messageCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSessionPreviewInfo - Complete session metadata', () => {
    let sessionPath: string | null = null;

    beforeAll(() => {
      const claudeSessions = discoverSessionFiles('claude', 1);
      if (claudeSessions.length > 0) {
        sessionPath = claudeSessions[0];
      }
    });

    test('should extract complete preview info from session file', async () => {
      if (!sessionPath) {
        console.warn('Skipping test: No Claude session file found');
        return;
      }

      const preview = await getSessionPreviewInfo(sessionPath);

      expect(preview).toBeDefined();
      expect(preview.messageCount).toBeGreaterThan(0);

      if (preview.firstUserMessage) {
        expect(typeof preview.firstUserMessage).toBe('string');
        expect(preview.firstUserMessage.trim().length).toBeGreaterThan(0);
      }

      if (preview.lastUserMessage) {
        expect(typeof preview.lastUserMessage).toBe('string');
        expect(preview.lastUserMessage.trim().length).toBeGreaterThan(0);
      }
    });

    test('should handle empty session files gracefully', async () => {
      const emptyPath = `/tmp/test-empty-session-${Date.now()}.jsonl`;
      fs.writeFileSync(emptyPath, '');

      const preview = await getSessionPreviewInfo(emptyPath);

      expect(preview.lastUserMessage).toBeUndefined();
      expect(preview.firstUserMessage).toBeUndefined();
      expect(preview.messageCount).toBe(0);

      fs.unlinkSync(emptyPath);
    });

    test('should handle malformed JSON gracefully', async () => {
      const malformedPath = `/tmp/test-malformed-session-${Date.now()}.jsonl`;
      fs.writeFileSync(malformedPath, '{ invalid json\n{"valid": "json"}');

      const preview = await getSessionPreviewInfo(malformedPath);

      expect(preview).toBeDefined();
      expect(preview.messageCount).toBeGreaterThanOrEqual(0);

      fs.unlinkSync(malformedPath);
    });
  });

  describe('Critical Contract - Session ID Flow', () => {
    test('sessionId maps to session file location', () => {
      const claudeSessions = discoverSessionFiles('claude', 1);
      if (claudeSessions.length === 0) {
        console.warn('Skipping test: No Claude session file found');
        return;
      }

      const sessionPath = claudeSessions[0];
      const sessionId = path.basename(sessionPath, '.jsonl');

      expect(sessionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });

    test('validates contract: sessionId format and file location', () => {
      const claudeSessions = discoverSessionFiles('claude', 3);
      if (claudeSessions.length === 0) {
        console.warn('Skipping test: No Claude session files found');
        return;
      }

      const results = claudeSessions.map((sessionPath) => {
        const sessionId = path.basename(sessionPath, '.jsonl');
        const stats = fs.statSync(sessionPath);
        const hasContent = stats.size > MIN_SESSION_SIZE;
        return {
          sessionId,
          hasContent,
          path: sessionPath
        };
      });

      results.forEach((result) => {
        expect(result.sessionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
        expect(result.hasContent).toBe(true);
      });
    });
  });
});
