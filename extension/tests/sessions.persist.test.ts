import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import {
  getWorkspaceSessions,
  saveWorkspaceSessions,
  clearWorkspaceSessions,
  wasCleanShutdown,
  markDirtyShutdown,
  updateSession,
  PersistedSession
} from '../src/core/sessions.persist';

// Note: These tests use the real sessions.yaml file at ~/.swarmify/agents/sessions.yaml
// They use a unique test workspace path to avoid interfering with real data

const TEST_WORKSPACE = `/tmp/swarmify-test-workspace-${Date.now()}`;
const SESSIONS_PATH = path.join(homedir(), '.swarmify', 'agents', 'sessions.yaml');

describe('sessions.persist', () => {
  beforeEach(() => {
    // Clear any existing test data
    clearWorkspaceSessions(TEST_WORKSPACE);
  });

  afterAll(() => {
    // Clean up test workspace data
    clearWorkspaceSessions(TEST_WORKSPACE);
  });

  describe('saveWorkspaceSessions / getWorkspaceSessions', () => {
    test('saves and retrieves sessions', () => {
      const sessions: PersistedSession[] = [
        {
          terminalId: 'CL-123-1',
          prefix: 'CL',
          sessionId: 'abc123',
          label: 'test task',
          agentType: 'claude',
          createdAt: Date.now()
        }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions, true);
      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].terminalId).toBe('CL-123-1');
      expect(retrieved[0].sessionId).toBe('abc123');
      expect(retrieved[0].label).toBe('test task');
      expect(retrieved[0].agentType).toBe('claude');
    });

    test('returns empty array for unknown workspace', () => {
      const sessions = getWorkspaceSessions('/nonexistent/workspace/path');
      expect(sessions).toEqual([]);
    });

    test('saves multiple sessions', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() },
        { terminalId: 'CX-1', prefix: 'CX', createdAt: Date.now() },
        { terminalId: 'GX-1', prefix: 'GX', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);

      expect(retrieved).toHaveLength(3);
      expect(retrieved.map(s => s.terminalId)).toEqual(['CL-1', 'CX-1', 'GX-1']);
    });
  });

  describe('clearWorkspaceSessions', () => {
    test('clears sessions for workspace', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      expect(getWorkspaceSessions(TEST_WORKSPACE)).toHaveLength(1);

      clearWorkspaceSessions(TEST_WORKSPACE);
      expect(getWorkspaceSessions(TEST_WORKSPACE)).toHaveLength(0);
    });

    test('does not affect other workspaces', () => {
      const workspace2 = `${TEST_WORKSPACE}-2`;

      saveWorkspaceSessions(TEST_WORKSPACE, [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ]);
      saveWorkspaceSessions(workspace2, [
        { terminalId: 'CX-1', prefix: 'CX', createdAt: Date.now() }
      ]);

      clearWorkspaceSessions(TEST_WORKSPACE);

      expect(getWorkspaceSessions(TEST_WORKSPACE)).toHaveLength(0);
      expect(getWorkspaceSessions(workspace2)).toHaveLength(1);

      // Clean up
      clearWorkspaceSessions(workspace2);
    });
  });

  describe('wasCleanShutdown / markDirtyShutdown', () => {
    test('defaults to true for unknown workspace', () => {
      expect(wasCleanShutdown('/unknown/workspace')).toBe(true);
    });

    test('returns true after saveWorkspaceSessions with cleanShutdown=true', () => {
      saveWorkspaceSessions(TEST_WORKSPACE, [], true);
      expect(wasCleanShutdown(TEST_WORKSPACE)).toBe(true);
    });

    test('returns false after saveWorkspaceSessions with cleanShutdown=false', () => {
      saveWorkspaceSessions(TEST_WORKSPACE, [], false);
      expect(wasCleanShutdown(TEST_WORKSPACE)).toBe(false);
    });

    test('markDirtyShutdown sets cleanShutdown to false', () => {
      saveWorkspaceSessions(TEST_WORKSPACE, [], true);
      expect(wasCleanShutdown(TEST_WORKSPACE)).toBe(true);

      markDirtyShutdown(TEST_WORKSPACE);
      expect(wasCleanShutdown(TEST_WORKSPACE)).toBe(false);
    });
  });

  describe('updateSession', () => {
    test('updates sessionId for existing session', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      updateSession(TEST_WORKSPACE, 'CL-1', { sessionId: 'new-session-id' });

      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);
      expect(retrieved[0].sessionId).toBe('new-session-id');
    });

    test('updates label for existing session', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      updateSession(TEST_WORKSPACE, 'CL-1', { label: 'updated label' });

      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);
      expect(retrieved[0].label).toBe('updated label');
    });

    test('does nothing for non-existent session', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      updateSession(TEST_WORKSPACE, 'nonexistent', { sessionId: 'test' });

      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].sessionId).toBeUndefined();
    });

    test('updates multiple fields at once', () => {
      const sessions: PersistedSession[] = [
        { terminalId: 'CL-1', prefix: 'CL', createdAt: Date.now() }
      ];

      saveWorkspaceSessions(TEST_WORKSPACE, sessions);
      updateSession(TEST_WORKSPACE, 'CL-1', {
        sessionId: 'sid',
        label: 'lbl',
        agentType: 'claude'
      });

      const retrieved = getWorkspaceSessions(TEST_WORKSPACE);
      expect(retrieved[0].sessionId).toBe('sid');
      expect(retrieved[0].label).toBe('lbl');
      expect(retrieved[0].agentType).toBe('claude');
    });
  });
});
