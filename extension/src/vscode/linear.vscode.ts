// Linear MCP integration for fetching tasks
// Checks if Linear MCP server is configured and fetches issues

import { promisify } from 'util';
import { exec } from 'child_process';
import { UnifiedTask, linearToUnifiedTask } from '../core/tasks';

const execAsync = promisify(exec);

// Cache for MCP availability check
let linearAvailableCache: boolean | null = null;
let linearAvailableCacheTime: number = 0;
const CACHE_TTL = 30000; // 30 seconds

// Check if Linear MCP server is configured for any agent
export async function isLinearAvailable(): Promise<boolean> {
  // Use cache if fresh
  const now = Date.now();
  if (linearAvailableCache !== null && (now - linearAvailableCacheTime) < CACHE_TTL) {
    return linearAvailableCache;
  }

  // Check Claude, Codex, and Gemini MCP configs for Linear
  const agents = ['claude', 'codex', 'gemini'];

  for (const agent of agents) {
    try {
      const { stdout } = await execAsync(`${agent} mcp list`);
      if (/linear/i.test(stdout)) {
        linearAvailableCache = true;
        linearAvailableCacheTime = now;
        return true;
      }
    } catch {
      // Agent not installed or mcp list failed
    }
  }

  linearAvailableCache = false;
  linearAvailableCacheTime = now;
  return false;
}

// Fetch tasks from Linear via MCP
// Uses Claude's MCP tool invocation to query Linear
export async function fetchLinearTasks(): Promise<UnifiedTask[]> {
  // Check if Linear is available
  if (!await isLinearAvailable()) {
    return [];
  }

  try {
    // Use Claude MCP to invoke Linear's list_issues tool
    // This executes: claude mcp call linear list_issues
    const { stdout } = await execAsync(
      'claude mcp call linear list_issues --args \'{"filter": {"assignee": {"isMe": {"eq": true}}, "state": {"type": {"nin": ["completed", "canceled"]}}}}\'',
      { timeout: 15000 }
    );

    // Parse the JSON response
    const response = JSON.parse(stdout);

    // Handle both direct array and nested nodes structure
    const issues = Array.isArray(response)
      ? response
      : response.nodes || response.issues || [];

    return issues.map(linearToUnifiedTask);
  } catch (err) {
    console.error('[LINEAR] Error fetching tasks:', err);
    return [];
  }
}

// Clear the availability cache (useful for testing or after config changes)
export function clearLinearCache(): void {
  linearAvailableCache = null;
  linearAvailableCacheTime = 0;
}
