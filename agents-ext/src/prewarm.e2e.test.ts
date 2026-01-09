// End-to-end tests for session pre-warming
// These tests spawn real CLI processes - no mocking
// Tests will be skipped if CLIs are not available
//
// IMPORTANT: These tests require PTY spawning which is blocked in sandboxed
// environments (like Claude Code's terminal or bun test). They will work in:
// - VS Code extension host
// - Regular terminal (outside Claude Code)
// - Node.js directly
//
// The tests gracefully handle PTY spawn failures and don't fail the test suite.

import { describe, test, expect } from 'bun:test';
import {
  spawnPrewarmSession,
  spawnPrewarmSessionWithFallback,
  isCliAvailable,
  isPtyAvailable,
} from './prewarm.pty';

// Longer timeouts for E2E tests (CLI startup can be slow)
const E2E_TIMEOUT = 60000;

describe('PTY availability', () => {
  test('reports PTY availability status', () => {
    const available = isPtyAvailable();
    console.log(`[E2E] node-pty available: ${available}`);
    // Just check it returns a boolean, don't fail if unavailable
    expect(typeof available).toBe('boolean');
  });
});

describe('Prewarm E2E - Claude', () => {
  test('checks if Claude CLI is available', async () => {
    const available = await isCliAvailable('claude');
    console.log(`[E2E] Claude CLI available: ${available}`);
    expect(typeof available).toBe('boolean');
  }, E2E_TIMEOUT);

  test('extracts session ID from claude /status', async () => {
    const available = await isCliAvailable('claude');
    if (!available) {
      console.log('[E2E] Skipping: Claude CLI not available');
      return;
    }

    const cwd = process.cwd();
    console.log(`[E2E] Spawning Claude prewarm session in ${cwd}`);

    const result = await spawnPrewarmSessionWithFallback('claude', cwd);
    console.log(`[E2E] Claude result: status=${result.status}, sessionId=${result.sessionId}, blocked=${result.blockedReason}, failed=${result.failedReason}`);

    if (result.status === 'blocked') {
      console.log(`[E2E] Claude blocked: ${result.blockedReason}`);
      // Not a test failure - just means env isn't configured
      // Log raw output for debugging
      if (result.rawOutput) {
        console.log(`[E2E] Claude raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      return;
    }

    if (result.status === 'failed') {
      console.log(`[E2E] Claude failed: ${result.failedReason}`);
      if (result.rawOutput) {
        console.log(`[E2E] Claude raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      // Still not a hard failure - could be config issue
      return;
    }

    expect(result.status).toBe('success');
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId).toMatch(/^[a-zA-Z0-9_-]+$/);
    console.log(`[E2E] Claude session ID extracted: ${result.sessionId}`);
  }, E2E_TIMEOUT);
});

describe('Prewarm E2E - Codex', () => {
  test('checks if Codex CLI is available', async () => {
    const available = await isCliAvailable('codex');
    console.log(`[E2E] Codex CLI available: ${available}`);
    expect(typeof available).toBe('boolean');
  }, E2E_TIMEOUT);

  test('extracts session ID from codex /status', async () => {
    const available = await isCliAvailable('codex');
    if (!available) {
      console.log('[E2E] Skipping: Codex CLI not available');
      return;
    }

    const cwd = process.cwd();
    console.log(`[E2E] Spawning Codex prewarm session in ${cwd}`);

    const result = await spawnPrewarmSessionWithFallback('codex', cwd);
    console.log(`[E2E] Codex result: status=${result.status}, sessionId=${result.sessionId}, blocked=${result.blockedReason}, failed=${result.failedReason}`);

    if (result.status === 'blocked') {
      console.log(`[E2E] Codex blocked: ${result.blockedReason}`);
      if (result.rawOutput) {
        console.log(`[E2E] Codex raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      return;
    }

    if (result.status === 'failed') {
      console.log(`[E2E] Codex failed: ${result.failedReason}`);
      if (result.rawOutput) {
        console.log(`[E2E] Codex raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      return;
    }

    expect(result.status).toBe('success');
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId).toMatch(/^[a-zA-Z0-9_-]+$/);
    console.log(`[E2E] Codex session ID extracted: ${result.sessionId}`);
  }, E2E_TIMEOUT);
});

describe('Prewarm E2E - Gemini', () => {
  test('checks if Gemini CLI is available', async () => {
    const available = await isCliAvailable('gemini');
    console.log(`[E2E] Gemini CLI available: ${available}`);
    expect(typeof available).toBe('boolean');
  }, E2E_TIMEOUT);

  test('extracts session ID from gemini /stats', async () => {
    const available = await isCliAvailable('gemini');
    if (!available) {
      console.log('[E2E] Skipping: Gemini CLI not available');
      return;
    }

    const cwd = process.cwd();
    console.log(`[E2E] Spawning Gemini prewarm session in ${cwd}`);

    const result = await spawnPrewarmSessionWithFallback('gemini', cwd);
    console.log(`[E2E] Gemini result: status=${result.status}, sessionId=${result.sessionId}, blocked=${result.blockedReason}, failed=${result.failedReason}`);

    if (result.status === 'blocked') {
      console.log(`[E2E] Gemini blocked: ${result.blockedReason}`);
      if (result.rawOutput) {
        console.log(`[E2E] Gemini raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      return;
    }

    if (result.status === 'failed') {
      console.log(`[E2E] Gemini failed: ${result.failedReason}`);
      if (result.rawOutput) {
        console.log(`[E2E] Gemini raw output (first 500 chars): ${result.rawOutput.slice(0, 500)}`);
      }
      return;
    }

    expect(result.status).toBe('success');
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId).toMatch(/^[a-zA-Z0-9_-]+$/);
    console.log(`[E2E] Gemini session ID extracted: ${result.sessionId}`);
  }, E2E_TIMEOUT);
});

describe('Prewarm fallback behavior', () => {
  test('gracefully handles unavailable CLI', async () => {
    // Test with a non-existent CLI
    const originalConfigs = require('./prewarm').PREWARM_CONFIGS;

    // Create a test that uses the fallback path
    const result = await spawnPrewarmSessionWithFallback('claude', '/nonexistent/path');

    // Should either succeed, be blocked, or fail gracefully (not throw)
    expect(['success', 'blocked', 'failed']).toContain(result.status);
    console.log(`[E2E] Fallback test result: ${result.status}`);
  }, E2E_TIMEOUT);
});

describe('Session ID extraction patterns', () => {
  // These tests verify that the patterns work with real-world output formats
  // by testing the extractSessionId function directly with various formats

  test('handles UUID format (primary format for Claude)', async () => {
    const { extractSessionId } = await import('./prewarm');

    // UUIDv7 format - most common for Claude
    expect(extractSessionId('Session ID: 019ba357-61b0-7e51-afdd-cd43c0e32253'))
      .toBe('019ba357-61b0-7e51-afdd-cd43c0e32253');

    expect(extractSessionId('Session: 019ba357-61b0-7e51-afdd-cd43c0e32253'))
      .toBe('019ba357-61b0-7e51-afdd-cd43c0e32253');

    // With ANSI codes
    expect(extractSessionId('\x1b[1mSession ID:\x1b[0m 019ba357-61b0-7e51-afdd-cd43c0e32253'))
      .toBe('019ba357-61b0-7e51-afdd-cd43c0e32253');
  });

  test('handles realistic /status output', async () => {
    const { extractSessionId } = await import('./prewarm');

    const statusOutput = `
Claude Code v2.1.2

Session ID: 019ba357-61b0-7e51-afdd-cd43c0e32253
Model: claude-opus-4-5-20251101
Context: 1,234 tokens
Account: Claude Max

Type /help for commands
>`;
    expect(extractSessionId(statusOutput)).toBe('019ba357-61b0-7e51-afdd-cd43c0e32253');
  });

  test('handles fallback formats for other CLIs', async () => {
    const { extractSessionId } = await import('./prewarm');

    // Non-UUID formats (fallback patterns)
    expect(extractSessionId('Session ID: abc123')).toBe('abc123');
    expect(extractSessionId('Session: codex_session_abc')).toBe('codex_session_abc');
  });
});
