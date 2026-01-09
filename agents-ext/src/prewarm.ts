// Session pre-warming - pure functions and types
// VS Code integration in prewarm.vscode.ts

export type PrewarmAgentType = 'claude' | 'codex' | 'gemini';

/** Configuration for pre-warming per agent type */
export interface PrewarmConfig {
  agentType: PrewarmAgentType;
  command: string;              // CLI command (e.g., 'claude', 'codex', 'gemini')
  statusCommand: string;        // Command to get session info (e.g., '/status', '/stats')
  sessionIdPattern: RegExp;     // Pattern to extract session ID from output
  exitSequence: string[];       // Key sequences to cleanly exit
  resumeCommand: (sessionId: string) => string;
}

/** A pre-warmed session ready for hand-off */
export interface PrewarmedSession {
  agentType: PrewarmAgentType;
  sessionId: string;
  createdAt: number;
  workingDirectory: string;
}

/** Session pool state */
export interface SessionPoolState {
  available: PrewarmedSession[];
  pending: number;              // Number currently being created
}

/** Terminal-to-session mapping for crash recovery */
export interface TerminalSessionMapping {
  terminalId: string;           // AGENT_TERMINAL_ID
  sessionId: string;            // CLI session ID
  agentType: PrewarmAgentType;
  createdAt: number;
  workingDirectory: string;
}

// Pre-warm configurations per agent
export const PREWARM_CONFIGS: Record<PrewarmAgentType, PrewarmConfig> = {
  claude: {
    agentType: 'claude',
    command: 'claude',
    statusCommand: '/status',
    // Matches: "Session ID: abc123-def456-..."
    sessionIdPattern: /Session\s+ID:\s*([a-f0-9-]+)/i,
    exitSequence: ['\x1b', '\x03', '\x03'],  // Esc, Ctrl+C, Ctrl+C
    resumeCommand: (id) => `claude -r ${id}`
  },
  codex: {
    agentType: 'codex',
    command: 'codex',
    statusCommand: '/status',
    // Matches: "Session: abc123-def456-..."
    sessionIdPattern: /Session:\s*([a-f0-9-]+)/i,
    exitSequence: ['\x03'],  // Ctrl+C
    resumeCommand: (id) => `codex resume ${id}`
  },
  gemini: {
    agentType: 'gemini',
    command: 'gemini',
    statusCommand: '/stats',
    // Matches session ID pattern (TBD - using similar pattern)
    sessionIdPattern: /Session(?:\s+ID)?:\s*([a-f0-9-]+)/i,
    exitSequence: ['\x03'],  // Ctrl+C
    resumeCommand: (id) => `gemini --session ${id}`
  }
};

// Default pool size per agent type
export const DEFAULT_POOL_SIZE = 3;

/**
 * Parse session ID from CLI /status or /stats output
 */
export function parseSessionId(output: string, config: PrewarmConfig): string | null {
  const match = output.match(config.sessionIdPattern);
  return match ? match[1] : null;
}

/**
 * Check if output indicates CLI is ready for input
 * Looks for common prompt indicators
 */
export function isCliReady(output: string, agentType: PrewarmAgentType): boolean {
  // Common patterns that indicate CLI is ready:
  // - ">" prompt
  // - "Welcome" message followed by prompt area
  // - Specific ready indicators per CLI
  const readyPatterns: Record<PrewarmAgentType, RegExp[]> = {
    claude: [
      />\s*$/,                    // Prompt ready
      /Welcome.*\n.*>/s,          // Welcome message + prompt
      /Claude Code v[\d.]+/       // Version banner indicates startup
    ],
    codex: [
      />\s*$/,
      /OpenAI Codex.*\n.*>/s,
      /Context window:/           // Status area indicates ready
    ],
    gemini: [
      />\s*$/,
      /Gemini.*\n.*>/s
    ]
  };

  return readyPatterns[agentType].some(pattern => pattern.test(output));
}

/**
 * Calculate how many sessions need to be created to reach target pool size
 */
export function needsReplenishment(pool: SessionPoolState, targetSize: number): number {
  const current = pool.available.length + pool.pending;
  return Math.max(0, targetSize - current);
}

/**
 * Select best session from pool for given working directory
 * Prefers same directory, then oldest session
 */
export function selectBestSession(
  available: PrewarmedSession[],
  targetCwd: string
): PrewarmedSession | null {
  if (available.length === 0) return null;

  // First try to find one with matching cwd
  const sameCwd = available.find(s => s.workingDirectory === targetCwd);
  if (sameCwd) return sameCwd;

  // Otherwise return oldest (FIFO)
  return available.reduce((oldest, current) =>
    current.createdAt < oldest.createdAt ? current : oldest
  );
}

/**
 * Build resume command for a pre-warmed session
 */
export function buildResumeCommand(session: PrewarmedSession): string {
  const config = PREWARM_CONFIGS[session.agentType];
  return config.resumeCommand(session.sessionId);
}

/**
 * Get all supported agent types
 */
export function getSupportedAgentTypes(): PrewarmAgentType[] {
  return ['claude', 'codex', 'gemini'];
}

/**
 * Check if an agent type supports pre-warming
 */
export function supportsPrewarming(agentType: string): agentType is PrewarmAgentType {
  return agentType === 'claude' || agentType === 'codex' || agentType === 'gemini';
}
