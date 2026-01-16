// GitHub MCP integration for fetching issues as tasks
// Checks if GitHub MCP server is configured and fetches issues

import { promisify } from 'util';
import { exec } from 'child_process';
import { UnifiedTask, githubToUnifiedTask } from '../core/tasks';

const execAsync = promisify(exec);

// Cache for MCP availability check
let githubAvailableCache: boolean | null = null;
let githubAvailableCacheTime: number = 0;
const CACHE_TTL = 30000; // 30 seconds

// Check if GitHub MCP server is configured for any agent
export async function isGitHubAvailable(): Promise<boolean> {
  // Use cache if fresh
  const now = Date.now();
  if (githubAvailableCache !== null && (now - githubAvailableCacheTime) < CACHE_TTL) {
    return githubAvailableCache;
  }

  // Check Claude, Codex, and Gemini MCP configs for GitHub
  const agents = ['claude', 'codex', 'gemini'];

  for (const agent of agents) {
    try {
      const { stdout } = await execAsync(`${agent} mcp list`);
      if (/github/i.test(stdout)) {
        githubAvailableCache = true;
        githubAvailableCacheTime = now;
        return true;
      }
    } catch {
      // Agent not installed or mcp list failed
    }
  }

  githubAvailableCache = false;
  githubAvailableCacheTime = now;
  return false;
}

// Fetch issues from GitHub via MCP
// Uses Claude's MCP tool invocation to query GitHub
export async function fetchGitHubTasks(): Promise<UnifiedTask[]> {
  // Check if GitHub is available
  if (!await isGitHubAvailable()) {
    return [];
  }

  try {
    // Use Claude MCP to invoke GitHub's list_issues tool
    // Fetches open issues assigned to the current user
    const { stdout } = await execAsync(
      'claude mcp call github list_issues --args \'{"state": "open", "assignee": "@me"}\'',
      { timeout: 15000 }
    );

    // Parse the JSON response
    const response = JSON.parse(stdout);

    // Handle both direct array and paginated response
    const issues = Array.isArray(response)
      ? response
      : response.items || response.issues || [];

    return issues.map(githubToUnifiedTask);
  } catch (err) {
    console.error('[GITHUB] Error fetching tasks:', err);
    return [];
  }
}

// Clear the availability cache (useful for testing or after config changes)
export function clearGitHubCache(): void {
  githubAvailableCache = null;
  githubAvailableCacheTime = 0;
}
