import { describe, test, expect } from 'bun:test';
import {
  parseTerminalName,
  sanitizeLabel,
  getExpandedAgentName,
  getIconFilename,
  getTerminalDisplayInfo,
  findTerminalNameByTabLabel,
  mergeMcpConfig,
  createSwarmServerConfig,
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  OPENCODE_TITLE,
  CURSOR_TITLE
} from './utils';

describe('parseTerminalName', () => {
  test('identifies exact agent prefixes', () => {
    expect(parseTerminalName('CC')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('CX')).toEqual({ isAgent: true, prefix: 'CX', label: null });
    expect(parseTerminalName('GX')).toEqual({ isAgent: true, prefix: 'GX', label: null });
    expect(parseTerminalName('OC')).toEqual({ isAgent: true, prefix: 'OC', label: null });
    expect(parseTerminalName('CR')).toEqual({ isAgent: true, prefix: 'CR', label: null });
  });

  test('identifies agent prefixes with labels', () => {
    expect(parseTerminalName('CC - auth feature')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'auth feature'
    });
    expect(parseTerminalName('CX - bug fix')).toEqual({
      isAgent: true,
      prefix: 'CX',
      label: 'bug fix'
    });
  });

  test('handles whitespace correctly', () => {
    expect(parseTerminalName('  CC  ')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('CC - label with spaces  ')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'label with spaces'
    });
  });

  test('rejects non-agent terminals', () => {
    expect(parseTerminalName('bash')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('zsh')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('node')).toEqual({ isAgent: false, prefix: null, label: null });
  });

  test('rejects partial matches (strict mode)', () => {
    // Should NOT match "cc" in lowercase
    expect(parseTerminalName('cc')).toEqual({ isAgent: false, prefix: null, label: null });
    // Should NOT match if prefix is part of larger word
    expect(parseTerminalName('success')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('CCTools')).toEqual({ isAgent: false, prefix: null, label: null });
    // Should NOT match without proper separator
    expect(parseTerminalName('CC-label')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('CClabel')).toEqual({ isAgent: false, prefix: null, label: null });
  });

  test('handles empty label after separator', () => {
    // "CC - " with empty trailing content is not a valid agent name pattern
    expect(parseTerminalName('CC - ')).toEqual({ isAgent: false, prefix: null, label: null });
  });
});

describe('sanitizeLabel', () => {
  test('removes quotes from input', () => {
    expect(sanitizeLabel('"auth feature"')).toBe('auth feature');
    expect(sanitizeLabel("'bug fix'")).toBe('bug fix');
    expect(sanitizeLabel('`code review`')).toBe('code review');
  });

  test('limits to max 5 words', () => {
    expect(sanitizeLabel('one two three four five six seven')).toBe('one two three four five');
  });

  test('handles empty and whitespace input', () => {
    expect(sanitizeLabel('')).toBe('');
    expect(sanitizeLabel('   ')).toBe('');
    expect(sanitizeLabel('  \t\n  ')).toBe('');
  });

  test('normalizes multiple spaces', () => {
    expect(sanitizeLabel('auth    feature')).toBe('auth feature');
  });
});

describe('getExpandedAgentName', () => {
  test('expands known prefixes', () => {
    expect(getExpandedAgentName(CLAUDE_TITLE)).toBe('Claude');
    expect(getExpandedAgentName(CODEX_TITLE)).toBe('Codex');
    expect(getExpandedAgentName(GEMINI_TITLE)).toBe('Gemini');
    expect(getExpandedAgentName(OPENCODE_TITLE)).toBe('OpenCode');
    expect(getExpandedAgentName(CURSOR_TITLE)).toBe('Cursor');
  });

  test('returns prefix as-is for unknown values', () => {
    expect(getExpandedAgentName('XX')).toBe('XX');
    expect(getExpandedAgentName('Custom')).toBe('Custom');
  });
});

describe('getIconFilename', () => {
  test('returns correct icon filenames', () => {
    expect(getIconFilename(CLAUDE_TITLE)).toBe('claude.png');
    expect(getIconFilename(CODEX_TITLE)).toBe('chatgpt.png');
    expect(getIconFilename(GEMINI_TITLE)).toBe('gemini.png');
    expect(getIconFilename(OPENCODE_TITLE)).toBe('opencode.png');
    expect(getIconFilename(CURSOR_TITLE)).toBe('cursor.png');
  });

  test('returns null for unknown prefixes', () => {
    expect(getIconFilename('XX')).toBeNull();
    expect(getIconFilename('Custom')).toBeNull();
  });
});

describe('getTerminalDisplayInfo', () => {
  test('returns full info for agent terminals without label', () => {
    expect(getTerminalDisplayInfo('CC')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: null,
      expandedName: 'Claude',
      statusBarText: 'Claude',
      iconFilename: 'claude.png'
    });
    expect(getTerminalDisplayInfo('CX')).toEqual({
      isAgent: true,
      prefix: 'CX',
      label: null,
      expandedName: 'Codex',
      statusBarText: 'Codex',
      iconFilename: 'chatgpt.png'
    });
    expect(getTerminalDisplayInfo('GX')).toEqual({
      isAgent: true,
      prefix: 'GX',
      label: null,
      expandedName: 'Gemini',
      statusBarText: 'Gemini',
      iconFilename: 'gemini.png'
    });
    expect(getTerminalDisplayInfo('OC')).toEqual({
      isAgent: true,
      prefix: 'OC',
      label: null,
      expandedName: 'OpenCode',
      statusBarText: 'OpenCode',
      iconFilename: 'opencode.png'
    });
    expect(getTerminalDisplayInfo('CR')).toEqual({
      isAgent: true,
      prefix: 'CR',
      label: null,
      expandedName: 'Cursor',
      statusBarText: 'Cursor',
      iconFilename: 'cursor.png'
    });
  });

  test('returns full info for agent terminals with label', () => {
    expect(getTerminalDisplayInfo('CC - auth feature')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'auth feature',
      expandedName: 'Claude',
      statusBarText: 'Claude - auth feature',
      iconFilename: 'claude.png'
    });
    expect(getTerminalDisplayInfo('GX - refactor')).toEqual({
      isAgent: true,
      prefix: 'GX',
      label: 'refactor',
      expandedName: 'Gemini',
      statusBarText: 'Gemini - refactor',
      iconFilename: 'gemini.png'
    });
  });

  test('returns null fields for non-agent terminals', () => {
    expect(getTerminalDisplayInfo('bash')).toEqual({
      isAgent: false,
      prefix: null,
      label: null,
      expandedName: null,
      statusBarText: null,
      iconFilename: null
    });
    expect(getTerminalDisplayInfo('zsh')).toEqual({
      isAgent: false,
      prefix: null,
      label: null,
      expandedName: null,
      statusBarText: null,
      iconFilename: null
    });
  });

  test('handles whitespace in terminal names', () => {
    expect(getTerminalDisplayInfo('  CC  ')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: null,
      expandedName: 'Claude',
      statusBarText: 'Claude',
      iconFilename: 'claude.png'
    });
  });
});

describe('createSwarmServerConfig', () => {
  test('creates correct server config for given path', () => {
    const config = createSwarmServerConfig('/path/to/cli-ts/dist/index.js');
    expect(config).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['/path/to/cli-ts/dist/index.js'],
      env: {}
    });
  });
});

describe('mergeMcpConfig', () => {
  test('creates new config when existing is null', () => {
    const serverConfig = createSwarmServerConfig('/path/to/index.js');
    const result = mergeMcpConfig(null, 'swarm', serverConfig);

    expect(result).toEqual({
      mcpServers: {
        swarm: {
          type: 'stdio',
          command: 'node',
          args: ['/path/to/index.js'],
          env: {}
        }
      }
    });
  });

  test('creates mcpServers when existing config has none', () => {
    const serverConfig = createSwarmServerConfig('/path/to/index.js');
    const result = mergeMcpConfig({}, 'swarm', serverConfig);

    expect(result.mcpServers).toBeDefined();
    expect(result.mcpServers!['swarm']).toEqual(serverConfig);
  });

  test('preserves existing servers when adding new one', () => {
    const existing = {
      mcpServers: {
        'other-server': {
          type: 'stdio',
          command: 'python',
          args: ['server.py'],
          env: { FOO: 'bar' }
        }
      }
    };
    const serverConfig = createSwarmServerConfig('/path/to/index.js');
    const result = mergeMcpConfig(existing, 'swarm', serverConfig);

    expect(result.mcpServers!['other-server']).toEqual(existing.mcpServers['other-server']);
    expect(result.mcpServers!['swarm']).toEqual(serverConfig);
  });

  test('overwrites existing server with same name', () => {
    const existing = {
      mcpServers: {
        swarm: {
          type: 'stdio',
          command: 'old-node',
          args: ['/old/path'],
          env: {}
        }
      }
    };
    const newConfig = createSwarmServerConfig('/new/path/index.js');
    const result = mergeMcpConfig(existing, 'swarm', newConfig);

    expect(result.mcpServers!['swarm'].args).toEqual(['/new/path/index.js']);
  });
});

describe('findTerminalNameByTabLabel', () => {
  test('finds exact match for agent terminal', () => {
    const terminalNames = ['CC', 'CX', 'GX', 'bash'];
    expect(findTerminalNameByTabLabel(terminalNames, 'CC')).toBe('CC');
    expect(findTerminalNameByTabLabel(terminalNames, 'CX')).toBe('CX');
    expect(findTerminalNameByTabLabel(terminalNames, 'GX')).toBe('GX');
  });

  test('finds terminal with label in name', () => {
    const terminalNames = ['CC', 'CC - auth feature', 'CX - bug fix'];
    expect(findTerminalNameByTabLabel(terminalNames, 'CC - auth feature')).toBe('CC - auth feature');
    expect(findTerminalNameByTabLabel(terminalNames, 'CX - bug fix')).toBe('CX - bug fix');
  });

  test('returns null when no match found', () => {
    const terminalNames = ['CC', 'CX', 'GX'];
    expect(findTerminalNameByTabLabel(terminalNames, 'bash')).toBeNull();
    expect(findTerminalNameByTabLabel(terminalNames, 'CR')).toBeNull();
    expect(findTerminalNameByTabLabel(terminalNames, 'CC - nonexistent')).toBeNull();
  });

  test('returns null for empty terminal list', () => {
    expect(findTerminalNameByTabLabel([], 'CC')).toBeNull();
  });

  test('handles multiple terminals with same base prefix', () => {
    // Simulates having multiple Claude terminals open
    const terminalNames = ['CC', 'CC', 'CC - task 1', 'CC - task 2'];
    // Should find first exact match
    expect(findTerminalNameByTabLabel(terminalNames, 'CC')).toBe('CC');
    expect(findTerminalNameByTabLabel(terminalNames, 'CC - task 1')).toBe('CC - task 1');
    expect(findTerminalNameByTabLabel(terminalNames, 'CC - task 2')).toBe('CC - task 2');
  });

  test('matches are case-sensitive', () => {
    const terminalNames = ['CC', 'Cc', 'cc'];
    expect(findTerminalNameByTabLabel(terminalNames, 'CC')).toBe('CC');
    expect(findTerminalNameByTabLabel(terminalNames, 'Cc')).toBe('Cc');
    expect(findTerminalNameByTabLabel(terminalNames, 'cc')).toBe('cc');
    expect(findTerminalNameByTabLabel(terminalNames, 'cC')).toBeNull();
  });

  test('does not match partial strings', () => {
    const terminalNames = ['CC - auth feature'];
    expect(findTerminalNameByTabLabel(terminalNames, 'CC')).toBeNull();
    expect(findTerminalNameByTabLabel(terminalNames, 'CC - auth')).toBeNull();
    expect(findTerminalNameByTabLabel(terminalNames, 'auth feature')).toBeNull();
  });
});
