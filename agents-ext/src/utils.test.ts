import { describe, test, expect } from 'bun:test';
import {
  parseTerminalName,
  sanitizeLabel,
  getExpandedAgentName,
  getIconFilename,
  getTerminalDisplayInfo,
  findTerminalNameByTabLabel,
  formatTerminalTitle,
  mergeMcpConfig,
  createSwarmServerConfig,
  generateTmuxSessionName,
  buildTmuxInitCommand,
  buildTmuxSplitCommand,
  buildTmuxKillCommand,
  isValidTmuxSessionName,
  sortPrompts,
  isBuiltInPromptId,
  truncateText,
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  OPENCODE_TITLE,
  CURSOR_TITLE,
  SHELL_TITLE
} from './utils';

describe('parseTerminalName', () => {
  test('identifies exact agent prefixes', () => {
    expect(parseTerminalName('CC')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('CX')).toEqual({ isAgent: true, prefix: 'CX', label: null });
    expect(parseTerminalName('GX')).toEqual({ isAgent: true, prefix: 'GX', label: null });
    expect(parseTerminalName('OC')).toEqual({ isAgent: true, prefix: 'OC', label: null });
    expect(parseTerminalName('CR')).toEqual({ isAgent: true, prefix: 'CR', label: null });
    expect(parseTerminalName('SH')).toEqual({ isAgent: true, prefix: 'SH', label: null });
  });

  test('accepts full agent names', () => {
    expect(parseTerminalName('Claude')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('Codex')).toEqual({ isAgent: true, prefix: 'CX', label: null });
    expect(parseTerminalName('Gemini')).toEqual({ isAgent: true, prefix: 'GX', label: null });
    expect(parseTerminalName('OpenCode')).toEqual({ isAgent: true, prefix: 'OC', label: null });
    expect(parseTerminalName('Cursor')).toEqual({ isAgent: true, prefix: 'CR', label: null });
  });

  test('accepts full agent names with labels', () => {
    expect(parseTerminalName('Cursor - auth')).toEqual({
      isAgent: true,
      prefix: 'CR',
      label: 'auth'
    });
    expect(parseTerminalName('Claude - feature work')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'feature work'
    });
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
    expect(getExpandedAgentName(SHELL_TITLE)).toBe('Shell');
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
    expect(getIconFilename(SHELL_TITLE)).toBe('agents.png');
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
    expect(getTerminalDisplayInfo('SH')).toEqual({
      isAgent: true,
      prefix: 'SH',
      label: null,
      expandedName: 'Shell',
      statusBarText: 'Shell',
      iconFilename: 'agents.png'
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

describe('tmux utilities', () => {
  describe('generateTmuxSessionName', () => {
    test('generates unique session names with prefix', () => {
      const originalNow = Date.now;
      let callCount = 0;
      Date.now = () => 1700000000000 + callCount++;
      try {
        const name1 = generateTmuxSessionName('cc');
        const name2 = generateTmuxSessionName('cc');

        expect(name1).toMatch(/^agents-cc-\d+$/);
        expect(name2).toMatch(/^agents-cc-\d+$/);
        expect(name1).not.toBe(name2);
      } finally {
        Date.now = originalNow;
      }
    });

    test('handles different prefixes', () => {
      const claude = generateTmuxSessionName('cc');
      const codex = generateTmuxSessionName('cx');

      expect(claude).toContain('-cc-');
      expect(codex).toContain('-cx-');
    });
  });

  describe('buildTmuxInitCommand', () => {
    test('builds init command with session name and pane label', () => {
      const cmd = buildTmuxInitCommand('agents-cc-123', 'Claude');

      expect(cmd).toContain('tmux new-session -s agents-cc-123');
      expect(cmd).toContain('set-option -t agents-cc-123 mouse on');
      expect(cmd).toContain('set-option -t agents-cc-123 pane-border-status top');
      expect(cmd).toContain('Claude');
    });
  });

  describe('buildTmuxSplitCommand', () => {
    test('horizontal split uses -v flag', () => {
      const cmd = buildTmuxSplitCommand('horizontal');
      expect(cmd).toBe('tmux split-window -v');
    });

    test('vertical split uses -h flag', () => {
      const cmd = buildTmuxSplitCommand('vertical');
      expect(cmd).toBe('tmux split-window -h');
    });
  });

  describe('buildTmuxKillCommand', () => {
    test('builds kill command with session name', () => {
      const cmd = buildTmuxKillCommand('agents-cc-123');
      expect(cmd).toBe('tmux kill-session -t agents-cc-123');
    });
  });

  describe('isValidTmuxSessionName', () => {
    test('accepts valid names', () => {
      expect(isValidTmuxSessionName('agents-cc-123')).toBe(true);
      expect(isValidTmuxSessionName('my_session')).toBe(true);
      expect(isValidTmuxSessionName('ABC123')).toBe(true);
    });

    test('rejects invalid names', () => {
      expect(isValidTmuxSessionName('has space')).toBe(false);
      expect(isValidTmuxSessionName('has:colon')).toBe(false);
      expect(isValidTmuxSessionName('has.dot')).toBe(false);
      expect(isValidTmuxSessionName('')).toBe(false);
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

describe('formatTerminalTitle', () => {
  test('uses short code when showFullAgentNames is false', () => {
    expect(formatTerminalTitle('CX', { display: { showFullAgentNames: false, showLabelsInTitles: true } })).toBe('CX');
  });

  test('uses full name when showFullAgentNames is true', () => {
    expect(formatTerminalTitle('CX', { display: { showFullAgentNames: true, showLabelsInTitles: true } })).toBe('Codex');
  });

  test('includes label when allowed', () => {
    expect(formatTerminalTitle('CR', { label: 'auth', display: { showFullAgentNames: true, showLabelsInTitles: true } }))
      .toBe('Cursor - auth');
  });

  test('omits label when showLabelsInTitles is false', () => {
    expect(formatTerminalTitle('CR', { label: 'auth', display: { showFullAgentNames: true, showLabelsInTitles: false } }))
      .toBe('Cursor');
  });
});

describe('prompt utilities', () => {
  describe('sortPrompts', () => {
    test('sorts favorites first', () => {
      const prompts = [
        { id: '1', isFavorite: false, accessedAt: 100 },
        { id: '2', isFavorite: true, accessedAt: 50 },
        { id: '3', isFavorite: false, accessedAt: 200 }
      ];
      const sorted = sortPrompts(prompts);
      expect(sorted[0].id).toBe('2'); // favorite first
      expect(sorted[1].id).toBe('3'); // then by accessedAt desc
      expect(sorted[2].id).toBe('1');
    });

    test('sorts by accessedAt within same favorite status', () => {
      const prompts = [
        { id: '1', isFavorite: true, accessedAt: 100 },
        { id: '2', isFavorite: true, accessedAt: 300 },
        { id: '3', isFavorite: true, accessedAt: 200 }
      ];
      const sorted = sortPrompts(prompts);
      expect(sorted[0].id).toBe('2'); // most recent first
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    test('does not mutate original array', () => {
      const prompts = [
        { id: '1', isFavorite: false, accessedAt: 100 },
        { id: '2', isFavorite: true, accessedAt: 50 }
      ];
      const sorted = sortPrompts(prompts);
      expect(prompts[0].id).toBe('1'); // original unchanged
      expect(sorted[0].id).toBe('2');
    });

    test('handles empty array', () => {
      expect(sortPrompts([])).toEqual([]);
    });
  });

  describe('isBuiltInPromptId', () => {
    test('identifies built-in prompts', () => {
      expect(isBuiltInPromptId('builtin-rethink')).toBe(true);
      expect(isBuiltInPromptId('builtin-debugit')).toBe(true);
      expect(isBuiltInPromptId('builtin-anything')).toBe(true);
    });

    test('identifies user prompts', () => {
      expect(isBuiltInPromptId('1234567890-abc123')).toBe(false);
      expect(isBuiltInPromptId('user-prompt')).toBe(false);
      expect(isBuiltInPromptId('my-builtin')).toBe(false); // must start with builtin-
    });
  });

  describe('truncateText', () => {
    test('returns text unchanged if within limit', () => {
      expect(truncateText('hello', 10)).toBe('hello');
      expect(truncateText('hello', 5)).toBe('hello');
    });

    test('truncates text with ellipsis', () => {
      expect(truncateText('hello world', 8)).toBe('hello...');
      expect(truncateText('abcdefghij', 7)).toBe('abcd...');
    });

    test('handles edge cases', () => {
      expect(truncateText('', 10)).toBe('');
      expect(truncateText('abc', 3)).toBe('abc');
      expect(truncateText('abcd', 3)).toBe('...');
    });
  });
});
