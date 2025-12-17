// Pure utility functions that can be tested without VS Code dependencies

export const CLAUDE_TITLE = 'CC';
export const CODEX_TITLE = 'CX';
export const GEMINI_TITLE = 'GX';
export const CURSOR_TITLE = 'CR';
export const LABEL_MAX_WORDS = 5;

export const KNOWN_PREFIXES = [CLAUDE_TITLE, CODEX_TITLE, GEMINI_TITLE, CURSOR_TITLE];

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

  for (const prefix of KNOWN_PREFIXES) {
    // Exact match: "CC"
    if (trimmed === prefix) {
      return { isAgent: true, prefix, label: null };
    }
    // Match with label: "CC - some label"
    if (trimmed.startsWith(`${prefix} - `)) {
      const label = trimmed.substring(prefix.length + 3).trim();
      return { isAgent: true, prefix, label: label || null };
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
  const expandedNames: Record<string, string> = {
    [CLAUDE_TITLE]: 'Claude',
    [CODEX_TITLE]: 'Codex',
    [GEMINI_TITLE]: 'Gemini',
    [CURSOR_TITLE]: 'Cursor'
  };
  return expandedNames[prefix] || prefix;
}

/**
 * Get the icon filename for an agent prefix.
 */
export function getIconFilename(prefix: string): string | null {
  const iconMap: Record<string, string> = {
    [CLAUDE_TITLE]: 'claude.png',
    [CODEX_TITLE]: 'chatgpt.png',
    [GEMINI_TITLE]: 'gemini.png',
    [CURSOR_TITLE]: 'cursor.png'
  };
  return iconMap[prefix] || null;
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
 * Get complete display info for a terminal by name.
 * Single source of truth for identifying agent terminals.
 */
export function getTerminalDisplayInfo(terminalName: string): TerminalDisplayInfo {
  const parsed = parseTerminalName(terminalName);

  if (!parsed.isAgent || !parsed.prefix) {
    return {
      isAgent: false,
      prefix: null,
      label: null,
      expandedName: null,
      statusBarText: null,
      iconFilename: null
    };
  }

  const expandedName = getExpandedAgentName(parsed.prefix);
  const statusBarText = parsed.label
    ? `${expandedName} - ${parsed.label}`
    : expandedName;

  return {
    isAgent: true,
    prefix: parsed.prefix,
    label: parsed.label,
    expandedName,
    statusBarText,
    iconFilename: getIconFilename(parsed.prefix)
  };
}
