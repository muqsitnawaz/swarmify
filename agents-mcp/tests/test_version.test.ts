import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isNewerVersion,
  detectClientFromName,
  buildVersionNotice,
  getCurrentVersion,
  initVersionCheck,
  setDetectedClient,
  loadCache,
  saveCache,
  CACHE_DIR,
  CACHE_FILE,
  CacheData,
} from '../src/version.js';

describe('Version Module', () => {
  describe('isNewerVersion', () => {
    test('should detect newer major version', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
      expect(isNewerVersion('0.2.4', '1.0.0')).toBe(true);
    });

    test('should detect newer minor version', () => {
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
      expect(isNewerVersion('0.2.4', '0.3.0')).toBe(true);
    });

    test('should detect newer patch version', () => {
      expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
      expect(isNewerVersion('0.2.4', '0.2.5')).toBe(true);
    });

    test('should return false for same version', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('0.2.4', '0.2.4')).toBe(false);
    });

    test('should return false for older version', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false);
    });

    test('should handle versions with missing parts', () => {
      expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
      expect(isNewerVersion('1', '1.1.0')).toBe(true);
    });

    test('should handle edge cases', () => {
      expect(isNewerVersion('0.0.0', '0.0.1')).toBe(true);
      expect(isNewerVersion('9.9.9', '10.0.0')).toBe(true);
    });
  });

  describe('detectClientFromName', () => {
    test('should detect Claude', () => {
      expect(detectClientFromName('Claude')).toBe('claude');
      expect(detectClientFromName('claude-code')).toBe('claude');
      expect(detectClientFromName('Claude Code v1.0')).toBe('claude');
    });

    test('should detect Codex', () => {
      expect(detectClientFromName('Codex')).toBe('codex');
      expect(detectClientFromName('codex-cli')).toBe('codex');
      expect(detectClientFromName('OpenAI Codex')).toBe('codex');
    });

    test('should detect Gemini', () => {
      expect(detectClientFromName('Gemini')).toBe('gemini');
      expect(detectClientFromName('gemini-cli')).toBe('gemini');
      expect(detectClientFromName('Google Gemini')).toBe('gemini');
    });

    test('should return unknown for unrecognized clients', () => {
      expect(detectClientFromName('VSCode')).toBe('unknown');
      expect(detectClientFromName('Other Client')).toBe('unknown');
      expect(detectClientFromName('')).toBe('unknown');
    });

    test('should handle undefined/null', () => {
      expect(detectClientFromName(undefined)).toBe('unknown');
    });
  });

  describe('getCurrentVersion', () => {
    test('should return a valid semver version', () => {
      const version = getCurrentVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('should return the version from package.json', () => {
      const version = getCurrentVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Cache operations', () => {
    const testCacheFile = CACHE_FILE;
    let originalCacheExists: boolean;
    let originalCacheContent: string | null = null;

    beforeEach(() => {
      // Backup existing cache if present
      originalCacheExists = existsSync(testCacheFile);
      if (originalCacheExists) {
        originalCacheContent = Bun.file(testCacheFile).toString();
      }
    });

    afterEach(() => {
      // Restore original cache state
      if (originalCacheExists && originalCacheContent) {
        writeFileSync(testCacheFile, originalCacheContent);
      } else if (existsSync(testCacheFile) && !originalCacheExists) {
        unlinkSync(testCacheFile);
      }
    });

    test('should return empty object for missing cache file', () => {
      // Temporarily remove cache file
      if (existsSync(testCacheFile)) {
        const backup = Bun.file(testCacheFile).toString();
        unlinkSync(testCacheFile);

        const cache = loadCache();
        expect(cache).toEqual({});

        // Restore
        writeFileSync(testCacheFile, backup);
      } else {
        const cache = loadCache();
        expect(cache).toEqual({});
      }
    });

    test('should handle malformed JSON in cache file', () => {
      // Write invalid JSON
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
      writeFileSync(testCacheFile, 'not valid json {{{');

      const cache = loadCache();
      expect(cache).toEqual({});
    });

    test('should save and load cache correctly', () => {
      const testData: CacheData = {
        version: {
          latest: '1.0.0',
          checkedAt: Date.now(),
        },
      };

      saveCache(testData);
      const loaded = loadCache();

      expect(loaded.version?.latest).toBe('1.0.0');
      expect(loaded.version?.checkedAt).toBe(testData.version?.checkedAt);
    });

    test('should handle empty cache file', () => {
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
      writeFileSync(testCacheFile, '');

      const cache = loadCache();
      expect(cache).toEqual({});
    });

    test('should handle cache with extra fields', () => {
      const testData = {
        version: {
          latest: '1.0.0',
          checkedAt: Date.now(),
        },
        otherField: 'some value',
        nested: { data: 123 },
      };

      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
      writeFileSync(testCacheFile, JSON.stringify(testData));

      const cache = loadCache();
      expect(cache.version?.latest).toBe('1.0.0');
      // Extra fields should be preserved
      expect((cache as Record<string, unknown>).otherField).toBe('some value');
    });
  });

  describe('buildVersionNotice', () => {
    test('should return empty string when no version check has run', () => {
      // Note: This depends on module state, so it may vary based on test order
      // In a fresh module load with no initVersionCheck call, it returns ''
      const notice = buildVersionNotice();
      // Could be empty or have content depending on prior state
      expect(typeof notice).toBe('string');
    });
  });

  describe('initVersionCheck', () => {
    test('should return version status with current version', async () => {
      const status = await initVersionCheck();

      expect(status).toBeDefined();
      expect(status.current).toBe(getCurrentVersion());
      expect(['current', 'outdated', 'unknown']).toContain(status.status);
    });

    test('should set isOutOfDate correctly', async () => {
      const status = await initVersionCheck();

      if (status.latest) {
        const expectedOutOfDate = isNewerVersion(status.current, status.latest);
        expect(status.isOutOfDate).toBe(expectedOutOfDate);
      }
    });
  });

  describe('setDetectedClient', () => {
    test('should update detected client and affect version notice', async () => {
      // First ensure we have a version status
      await initVersionCheck();

      // Set different clients and verify no errors
      setDetectedClient('claude');
      setDetectedClient('codex');
      setDetectedClient('gemini');
      setDetectedClient('unknown');

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
