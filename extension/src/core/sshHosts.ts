// Candidate hosts for the cross-host Factory Floor picker. Parses Host aliases
// from an ~/.ssh/config (pure, testable); the VS Code layer merges these with
// online Tailscale peers, because MagicDNS hosts (yosemite-s0, zion, ...) are
// reachable without an explicit Host block.

// Returns the concrete Host aliases declared in an ssh config, in file order,
// deduped. Pattern entries (containing '*' or '?') and the catch-all 'Host *'
// are skipped — they aren't selectable targets. Tokens after the first on a
// `Host a b c` line are all aliases for the same block.
export function parseSshConfigHosts(configText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of configText.split(/\r?\n/)) {
    const m = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!m) continue;
    for (const alias of m[1].split(/\s+/)) {
      if (!alias || alias.includes('*') || alias.includes('?')) continue;
      if (seen.has(alias)) continue;
      seen.add(alias);
      out.push(alias);
    }
  }
  return out;
}

// Merge ssh-config aliases with Tailscale peer hostnames into one deduped,
// sorted candidate list. selfHost (the local machine) is excluded so we don't
// offer to SSH into ourselves.
export function mergeHostCandidates(
  sshHosts: string[],
  tailscalePeers: string[],
  selfHost?: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [...sshHosts, ...tailscalePeers]) {
    const host = h.trim();
    if (!host || host === selfHost) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
