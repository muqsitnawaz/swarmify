// Pure utility functions that can be tested without VS Code dependencies

export const CLAUDE_TITLE = 'CC';
export const CODEX_TITLE = 'CX';
export const GEMINI_TITLE = 'GX';
export const OPENCODE_TITLE = 'OC';
export const CURSOR_TITLE = 'CR';
export const SHELL_TITLE = 'SH';
export const LABEL_MAX_WORDS = 5;

export const KNOWN_PREFIXES = [CLAUDE_TITLE, CODEX_TITLE, GEMINI_TITLE, OPENCODE_TITLE, CURSOR_TITLE, SHELL_TITLE];

// Mapping of acceptable terminal base names to canonical prefixes
const NAME_TO_PREFIX: Record<string, string> = {
  [CLAUDE_TITLE]: CLAUDE_TITLE,
  'CLAUDE': CLAUDE_TITLE,
  'Claude': CLAUDE_TITLE,
  'claude': CLAUDE_TITLE,
  [CODEX_TITLE]: CODEX_TITLE,
  'CODEX': CODEX_TITLE,
  'Codex': CODEX_TITLE,
  'codex': CODEX_TITLE,
  [GEMINI_TITLE]: GEMINI_TITLE,
  'GEMINI': GEMINI_TITLE,
  'Gemini': GEMINI_TITLE,
  'gemini': GEMINI_TITLE,
  [OPENCODE_TITLE]: OPENCODE_TITLE,
  'OPENCODE': OPENCODE_TITLE,
  'OpenCode': OPENCODE_TITLE,
  'opencode': OPENCODE_TITLE,
  [CURSOR_TITLE]: CURSOR_TITLE,
  'CURSOR': CURSOR_TITLE,
  'Cursor': CURSOR_TITLE,
  'cursor': CURSOR_TITLE,
  [SHELL_TITLE]: SHELL_TITLE,
  'SHELL': SHELL_TITLE,
  'Shell': SHELL_TITLE,
  'shell': SHELL_TITLE
};

export interface DisplayPreferences {
  showFullAgentNames: boolean;
  showLabelsInTitles: boolean;
}

export interface ParsedTerminalName {
  isAgent: boolean;
  prefix: string | null;
  label: string | null;
}

/**
 * Parse a terminal name to identify if it's an agent terminal.
 * Strict matching: only matches exact prefixes or "PREFIX - label" format.
 */
export function parseTerminalName(name: string): ParsedTerminalName {
  const trimmed = name.trim();

  // Support both short codes (CC) and full names (Claude)
  for (const [candidate, canonicalPrefix] of Object.entries(NAME_TO_PREFIX)) {
    // Exact match
    if (trimmed === candidate) {
      return { isAgent: true, prefix: canonicalPrefix, label: null };
    }
    // Match with label
    if (trimmed.startsWith(`${candidate} - `)) {
      const label = trimmed.substring(candidate.length + 3).trim();
      if (label) {
        return { isAgent: true, prefix: canonicalPrefix, label };
      }
    }
  }

  return { isAgent: false, prefix: null, label: null };
}

/**
 * Sanitize user input for terminal labels.
 * Removes quotes, limits to max words.
 */
export function sanitizeLabel(raw: string): string {
  const stripped = raw.replace(/["'`]/g, '').trim();
  if (!stripped) {
    return '';
  }
  const words = stripped.split(/\s+/).slice(0, LABEL_MAX_WORDS);
  return words.join(' ').trim();
}

/**
 * Get the expanded human-readable name for an agent prefix.
 */
export function getExpandedAgentName(prefix: string): string {
  // Map both title (CC) and prefix (cc) to expanded names
  const expandedNames: Record<string, string> = {
    [CLAUDE_TITLE]: 'Claude',
    [CODEX_TITLE]: 'Codex',
    [GEMINI_TITLE]: 'Gemini',
    [OPENCODE_TITLE]: 'OpenCode',
    [CURSOR_TITLE]: 'Cursor',
    [SHELL_TITLE]: 'Shell',
    // Also map lowercase prefixes from agents.ts
    'cc': 'Claude',
    'cx': 'Codex',
    'gm': 'Gemini',
    'oc': 'OpenCode',
    'cr': 'Cursor',
    'sh': 'Shell',
    // Allow already-expanded names to pass through
    'claude': 'Claude',
    'codex': 'Codex',
    'gemini': 'Gemini',
    'opencode': 'OpenCode',
    'cursor': 'Cursor',
    'shell': 'Shell'
  };
  return expandedNames[prefix] || prefix;
}

// Bidirectional icon <-> prefix mapping
const ICON_TO_PREFIX: Record<string, string> = {
  'claude.png': CLAUDE_TITLE,
  'chatgpt.png': CODEX_TITLE,
  'gemini.png': GEMINI_TITLE,
  'opencode.png': OPENCODE_TITLE,
  'cursor.png': CURSOR_TITLE,
  'agents.png': SHELL_TITLE
};

const PREFIX_TO_ICON: Record<string, string> = {
  [CLAUDE_TITLE]: 'claude.png',
  [CODEX_TITLE]: 'chatgpt.png',
  [GEMINI_TITLE]: 'gemini.png',
  [OPENCODE_TITLE]: 'opencode.png',
  [CURSOR_TITLE]: 'cursor.png',
  [SHELL_TITLE]: 'agents.png'
};

/**
 * Get the icon filename for an agent prefix.
 */
export function getIconFilename(prefix: string): string | null {
  return PREFIX_TO_ICON[prefix] || null;
}

/**
 * Get the agent prefix from an icon filename.
 * Reverse lookup for icon-based identification.
 */
export function getPrefixFromIconFilename(iconFilename: string): string | null {
  return ICON_TO_PREFIX[iconFilename] || null;
}

export interface TerminalTitleOptions {
  display?: DisplayPreferences;
  label?: string | null;
}

/**
 * Build the terminal tab title based on display preferences.
 * Canonical prefix should be one of the KNOWN_PREFIXES.
 */
export function formatTerminalTitle(prefix: string, options?: TerminalTitleOptions): string {
  const display = options?.display;
  const base = display?.showFullAgentNames ? getExpandedAgentName(prefix) : prefix;

  const label = options?.label?.trim();
  if (!display?.showLabelsInTitles || !label) {
    return base;
  }

  // If label is set and we show labels in titles, display ONLY the label
  // to avoid redundancy with the terminal icon.
  return label;
}

export interface TerminalDisplayInfo {
  isAgent: boolean;
  prefix: string | null;
  label: string | null;
  expandedName: string | null;
  statusBarText: string | null;
  iconFilename: string | null;
}

/**
 * Options for terminal identification.
 * Multiple inputs allow fallback strategies when name parsing fails.
 */
export interface TerminalIdentificationOptions {
  /** Terminal name (required) */
  name: string;
  /** Icon filename (e.g., "claude.png") - extracted from terminal.creationOptions.iconPath */
  iconFilename?: string | null;
  /** Terminal ID from AGENT_TERMINAL_ID env var (e.g., "CC-1735824000000-1") */
  terminalId?: string | null;
}

/**
 * Get complete display info for a terminal.
 *
 * SINGLE SOURCE OF TRUTH for identifying agent terminals.
 * Uses multiple fallback strategies in priority order:
 *
 * 1. Parse name - handles "CC", "Claude", "CC - label", "Claude - label"
 * 2. Extract prefix from AGENT_TERMINAL_ID env var
 * 3. Reverse-lookup prefix from icon filename
 *
 * When name parsing fails but we identify via env/icon, the terminal name
 * is treated as the label (e.g., name="auth feature" becomes the label).
 */
export function getTerminalDisplayInfo(options: TerminalIdentificationOptions): TerminalDisplayInfo {
  const { name, iconFilename, terminalId } = options;

  // Strategy 1: Parse name (handles "CC", "Claude", "CC - label", etc.)
  const parsed = parseTerminalName(name);
  if (parsed.isAgent && parsed.prefix) {
    return buildDisplayInfo(parsed.prefix, parsed.label);
  }

  // Strategy 2: Extract prefix from AGENT_TERMINAL_ID env var
  if (terminalId) {
    const prefix = getPrefixFromTerminalId(terminalId);
    if (prefix && KNOWN_PREFIXES.includes(prefix)) {
      return buildDisplayInfo(prefix, name.trim() || null);
    }
  }

  // Strategy 3: Reverse-lookup from icon filename
  if (iconFilename) {
    const prefix = getPrefixFromIconFilename(iconFilename);
    if (prefix) {
      return buildDisplayInfo(prefix, name.trim() || null);
    }
  }

  // Not an agent terminal
  return {
    isAgent: false,
    prefix: null,
    label: null,
    expandedName: null,
    statusBarText: null,
    iconFilename: null
  };
}

function buildDisplayInfo(prefix: string, label: string | null): TerminalDisplayInfo {
  const expandedName = getExpandedAgentName(prefix);
  const statusBarText = label
    ? `${expandedName} - ${label}`
    : expandedName;

  return {
    isAgent: true,
    prefix,
    label,
    expandedName,
    statusBarText,
    iconFilename: getIconFilename(prefix)
  };
}

/**
 * Extract agent prefix from a terminal ID (e.g., "CC-1735824000000-1" -> "CC")
 */
export function getPrefixFromTerminalId(terminalId: string): string | null {
  const prefix = terminalId.split('-')[0];
  // We don't strictly check KNOWN_PREFIXES here to allow custom agents 
  // which might use their name as prefix.
  return prefix || null;
}

/**
 * Find a terminal name that matches a tab label.
 * Returns the matching name from the list, or null if not found.
 * Used for matching terminal tabs to terminal instances.
 */
export function findTerminalNameByTabLabel(
  terminalNames: string[],
  tabLabel: string
): string | null {
  return terminalNames.find(name => name === tabLabel) ?? null;
}

export interface McpServerConfig {
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Merge a new MCP server into an existing config.
 * Preserves existing servers while adding/updating the specified one.
 */
export function mergeMcpConfig(
  existing: McpConfig | null,
  serverName: string,
  serverConfig: McpServerConfig
): McpConfig {
  const config: McpConfig = existing ? { ...existing } : {};
  config.mcpServers = { ...(config.mcpServers || {}), [serverName]: serverConfig };
  return config;
}

/**
 * Create the swarm MCP server config for a given cli-ts path.
 */
export function createSwarmServerConfig(cliTsIndexPath: string): McpServerConfig {
  return {
    type: 'stdio',
    command: 'node',
    args: [cliTsIndexPath],
    env: {}
  };
}

// === TMUX UTILITIES ===

/**
 * Generate a unique tmux session name
 */
export function generateTmuxSessionName(prefix: string): string {
  return `agents-${prefix}-${Date.now()}`;
}

/**
 * Build tmux initialization command with mouse support and pane labels
 */
export function buildTmuxInitCommand(sessionName: string, paneLabel: string): string {
  return [
    `tmux new-session -s ${sessionName} -n main`,
    `tmux set-option -t ${sessionName} mouse on`,
    `tmux set-option -t ${sessionName} pane-border-status top`,
    `tmux set-option -t ${sessionName} pane-border-format " #{pane_index}: ${paneLabel} "`,
  ].join(' \\; ');
}

/**
 * Build tmux split command
 * Note: tmux -v = horizontal split (new pane below), -h = vertical split (new pane to right)
 */
export function buildTmuxSplitCommand(direction: 'horizontal' | 'vertical'): string {
  // tmux uses opposite terminology: -v splits horizontally, -h splits vertically
  const flag = direction === 'horizontal' ? '-v' : '-h';
  return `tmux split-window ${flag}`;
}

/**
 * Build tmux kill session command
 */
export function buildTmuxKillCommand(sessionName: string): string {
  return `tmux kill-session -t ${sessionName}`;
}

/**
 * Check if a session name is a valid tmux session name (alphanumeric, dash, underscore)
 */
export function isValidTmuxSessionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

// === PROMPT UTILITIES ===

export interface PromptEntryLike {
  id: string;
  isFavorite: boolean;
  accessedAt: number;
}

/**
 * Sort prompt entries: favorites first, then by accessedAt (most recently used first).
 */
export function sortPrompts<T extends PromptEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    // Favorites first
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    // Then by accessedAt (most recently used first)
    return b.accessedAt - a.accessedAt;
  });
}

/**
 * Check if a prompt ID is a built-in prompt (not user-created).
 */
export function isBuiltInPromptId(id: string): boolean {
  return id.startsWith('builtin-');
}

/**
 * Truncate text with ellipsis for display.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}
