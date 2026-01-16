// Version checking module for @swarmify/agents-mcp
// Checks npm registry for latest version and caches result

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Types (exported for testing)
export interface CacheData {
  version?: {
    latest: string;
    checkedAt: number;
  };
  // Other cache fields can be added here
}

interface VersionStatus {
  current: string;
  latest: string | null;
  isOutOfDate: boolean;
  status: 'current' | 'outdated' | 'unknown';
}

type ClientType = 'claude' | 'codex' | 'gemini' | 'unknown';

// Constants (exported for testing)
export const CACHE_DIR = join(homedir(), '.swarmify');
export const CACHE_FILE = join(CACHE_DIR, 'cache.json');
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@swarmify/agents-mcp/latest';
const FETCH_TIMEOUT_MS = 3000;

// Module state
let versionStatus: VersionStatus | null = null;
let detectedClient: ClientType = 'unknown';

// Get current version from package.json
export function getCurrentVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Load cache from disk
// Exported for testing
export function loadCache(): CacheData {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as CacheData;
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

// Save cache to disk
// Exported for testing
export function saveCache(data: CacheData): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Ignore write errors
  }
}

// Fetch latest version from npm registry
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

// Compare semver versions (simple comparison)
// Exported for testing
export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// Initialize version check (call on startup)
export async function initVersionCheck(): Promise<VersionStatus> {
  const current = getCurrentVersion();

  // Check cache first
  const cache = loadCache();
  const cachedVersion = cache.version;
  const now = Date.now();

  if (cachedVersion && now - cachedVersion.checkedAt < CACHE_TTL_MS) {
    // Use cached value
    const isOutOfDate = isNewerVersion(current, cachedVersion.latest);
    versionStatus = {
      current,
      latest: cachedVersion.latest,
      isOutOfDate,
      status: isOutOfDate ? 'outdated' : 'current',
    };
    return versionStatus;
  }

  // Fetch from npm (with timeout, non-blocking)
  const latest = await fetchLatestVersion();

  if (latest) {
    // Update cache
    cache.version = { latest, checkedAt: now };
    saveCache(cache);

    const isOutOfDate = isNewerVersion(current, latest);
    versionStatus = {
      current,
      latest,
      isOutOfDate,
      status: isOutOfDate ? 'outdated' : 'current',
    };
  } else {
    // Network failed, use stale cache or unknown
    if (cachedVersion) {
      const isOutOfDate = isNewerVersion(current, cachedVersion.latest);
      versionStatus = {
        current,
        latest: cachedVersion.latest,
        isOutOfDate,
        status: isOutOfDate ? 'outdated' : 'current',
      };
    } else {
      versionStatus = {
        current,
        latest: null,
        isOutOfDate: false,
        status: 'unknown',
      };
    }
  }

  return versionStatus;
}

// Set detected client (call from MCP initialize handler)
export function setDetectedClient(client: ClientType): void {
  detectedClient = client;
}

// Detect client from clientInfo name
export function detectClientFromName(name: string | undefined): ClientType {
  if (!name) return 'unknown';
  const lower = name.toLowerCase();
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('gemini')) return 'gemini';
  return 'unknown';
}

// Get update command for client
function getUpdateCommand(client: ClientType): string {
  switch (client) {
    case 'claude':
      return 'claude mcp add --scope user Swarm -- npx -y @swarmify/agents-mcp@latest';
    case 'codex':
      return 'codex mcp add Swarm -- npx -y @swarmify/agents-mcp@latest';
    case 'gemini':
      return 'gemini mcp add Swarm -- npx -y @swarmify/agents-mcp@latest';
    default:
      return [
        'Claude: claude mcp add --scope user Swarm -- npx -y @swarmify/agents-mcp@latest',
        'Codex: codex mcp add Swarm -- npx -y @swarmify/agents-mcp@latest',
        'Gemini: gemini mcp add Swarm -- npx -y @swarmify/agents-mcp@latest',
      ].join('\n');
  }
}

// Build version notice for tool descriptions
export function buildVersionNotice(): string {
  if (!versionStatus) return '';

  if (versionStatus.status === 'outdated') {
    const cmd = getUpdateCommand(detectedClient);
    return `\n\n---\nWARNING: Your Swarm MCP server (v${versionStatus.current}) is out of date. Latest: v${versionStatus.latest}.\nPlease update:\n${cmd}`;
  }

  // Optionally show "up to date" message (commented out to reduce noise)
  // if (versionStatus.status === 'current') {
  //   return `\n\n---\nSwarm MCP server v${versionStatus.current} is up to date.`;
  // }

  return '';
}

// Get current version status
export function getVersionStatus(): VersionStatus | null {
  return versionStatus;
}
