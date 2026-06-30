import { describe, test, expect } from 'bun:test';
import { parseSshConfigHosts, mergeHostCandidates } from '../src/core/sshHosts';

const CONFIG = `
# personal boxes
Host phoenix
  HostName 1.2.3.4

Host yosemite-m0 yosemite-m1
  User muqsit

Host *.internal
  ForwardAgent yes

Host *
  AddKeysToAgent yes
`;

describe('parseSshConfigHosts', () => {
  test('extracts concrete aliases, multiple per line, skips patterns and catch-all', () => {
    expect(parseSshConfigHosts(CONFIG)).toEqual(['phoenix', 'yosemite-m0', 'yosemite-m1']);
  });

  test('dedups across blocks, file order preserved', () => {
    expect(parseSshConfigHosts('Host a\nHost b\nHost a')).toEqual(['a', 'b']);
  });
});

describe('mergeHostCandidates', () => {
  test('unions ssh + tailscale, dedups, excludes self, sorts', () => {
    const out = mergeHostCandidates(
      ['yosemite-m0', 'phoenix'],
      ['zion', 'yosemite-s0', 'yosemite-m0', 'this-mac'],
      'this-mac',
    );
    expect(out).toEqual(['phoenix', 'yosemite-m0', 'yosemite-s0', 'zion']);
    expect(out).not.toContain('this-mac');
  });
});
