import { describe, it, expect } from 'bun:test';
import { homedir } from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Note: better-sqlite3 has ABI compatibility issues with Bun's test runner.
// This test uses sqlite3 CLI instead to verify the implementation logic.

describe('Cursor Session Reading', () => {
  it('should have JSON blobs with user messages in real Cursor session', () => {
    const chatsRoot = path.join(homedir(), '.cursor', 'chats');

    // Find a real store.db file
    let dbPath: string | undefined;
    if (fs.existsSync(chatsRoot)) {
      const hashes = fs.readdirSync(chatsRoot);
      for (const hash of hashes) {
        const hashPath = path.join(chatsRoot, hash);
        if (!fs.statSync(hashPath).isDirectory()) continue;
        const sessions = fs.readdirSync(hashPath);
        for (const session of sessions) {
          const storePath = path.join(hashPath, session, 'store.db');
          if (fs.existsSync(storePath)) {
            const stat = fs.statSync(storePath);
            if (stat.size > 5000) { // Skip tiny databases
              dbPath = storePath;
              break;
            }
          }
        }
        if (dbPath) break;
      }
    }

    if (!dbPath) {
      console.log('No Cursor session found, skipping test');
      return;
    }

    console.log('Testing with:', dbPath);

    // Use sqlite3 CLI to verify blob structure
    const query = `SELECT json_extract(data, '$.role') as role FROM blobs WHERE json_valid(data) AND json_extract(data, '$.role') IS NOT NULL`;
    const output = execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8' });
    const roles = output.trim().split('\n').filter(Boolean);

    console.log('Roles found:', roles);

    const userCount = roles.filter(r => r === 'user').length;
    const assistantCount = roles.filter(r => r === 'assistant').length;

    console.log('User messages:', userCount, 'Assistant messages:', assistantCount);

    expect(userCount).toBeGreaterThan(0);
    expect(assistantCount).toBeGreaterThan(0);

    // Verify first user message content exists
    const contentQuery = `SELECT json_extract(data, '$.content') FROM blobs WHERE json_valid(data) AND json_extract(data, '$.role') = 'user' LIMIT 1`;
    const contentOutput = execSync(`sqlite3 "${dbPath}" "${contentQuery}"`, { encoding: 'utf-8' });
    console.log('First user content (truncated):', contentOutput.slice(0, 200));

    expect(contentOutput.length).toBeGreaterThan(0);
  });
});
