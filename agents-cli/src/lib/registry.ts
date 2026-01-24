import type {
  RegistryType,
  RegistryConfig,
  McpServerEntry,
  McpRegistryResponse,
  SkillEntry,
  RegistrySearchResult,
  ResolvedPackage,
} from './types.js';
import { DEFAULT_REGISTRIES } from './types.js';
import { readMeta, writeMeta } from './state.js';

export function getRegistries(type: RegistryType): Record<string, RegistryConfig> {
  const meta = readMeta();
  const defaultRegs = DEFAULT_REGISTRIES[type] || {};
  const userRegs = meta.registries?.[type] || {};

  // Merge defaults with user config (user overrides defaults)
  return { ...defaultRegs, ...userRegs };
}

export function getEnabledRegistries(type: RegistryType): Array<{ name: string; config: RegistryConfig }> {
  const registries = getRegistries(type);
  return Object.entries(registries)
    .filter(([, config]) => config.enabled)
    .map(([name, config]) => ({ name, config }));
}

export function setRegistry(
  type: RegistryType,
  name: string,
  config: Partial<RegistryConfig>
): void {
  const meta = readMeta();
  if (!meta.registries) {
    meta.registries = { mcp: {}, skill: {} };
  }
  if (!meta.registries[type]) {
    meta.registries[type] = {};
  }

  const existing = meta.registries[type][name] || DEFAULT_REGISTRIES[type]?.[name];
  meta.registries[type][name] = { ...existing, ...config } as RegistryConfig;
  writeMeta(meta);
}

export function removeRegistry(type: RegistryType, name: string): boolean {
  const meta = readMeta();
  if (meta.registries?.[type]?.[name]) {
    delete meta.registries[type][name];
    writeMeta(meta);
    return true;
  }
  return false;
}

async function fetchMcpRegistry(
  url: string,
  query?: string,
  limit: number = 20,
  apiKey?: string
): Promise<McpRegistryResponse> {
  const params = new URLSearchParams();
  if (query) params.set('search', query);
  params.set('limit', String(limit));

  const fullUrl = `${url}/servers?${params}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(fullUrl, { headers });
  if (!response.ok) {
    throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<McpRegistryResponse>;
}

export async function searchMcpRegistries(
  query: string,
  options?: { registry?: string; limit?: number }
): Promise<RegistrySearchResult[]> {
  const registries = getEnabledRegistries('mcp');
  const results: RegistrySearchResult[] = [];

  const targetRegistries = options?.registry
    ? registries.filter((r) => r.name === options.registry)
    : registries;

  if (targetRegistries.length === 0) {
    if (options?.registry) {
      throw new Error(`Registry '${options.registry}' not found or not enabled`);
    }
    return [];
  }

  for (const { name, config } of targetRegistries) {
    try {
      const response = await fetchMcpRegistry(
        config.url,
        query,
        options?.limit || 20,
        config.apiKey
      );

      for (const { server } of response.servers) {
        results.push({
          name: server.name,
          description: server.description,
          type: 'mcp',
          source: server.repository?.url || server.name,
          registry: name,
          version: server.version_detail?.version,
        });
      }
    } catch (err) {
      // Log but continue with other registries
      console.error(`Failed to search ${name}: ${(err as Error).message}`);
    }
  }

  return results;
}

export async function getMcpServerInfo(
  serverName: string,
  registryName?: string
): Promise<McpServerEntry | null> {
  const registries = getEnabledRegistries('mcp');

  const targetRegistries = registryName
    ? registries.filter((r) => r.name === registryName)
    : registries;

  for (const { config } of targetRegistries) {
    try {
      // Search with exact name
      const response = await fetchMcpRegistry(config.url, serverName, 10, config.apiKey);

      // Find exact match
      const match = response.servers.find(
        ({ server }) =>
          server.name === serverName ||
          server.name.endsWith(`/${serverName}`)
      );

      if (match) {
        return match.server;
      }
    } catch {
      // Continue to next registry
    }
  }

  return null;
}

export async function searchSkillRegistries(
  _query: string,
  _options?: { registry?: string; limit?: number }
): Promise<RegistrySearchResult[]> {
  const registries = getEnabledRegistries('skill');

  if (registries.length === 0) {
    // No skill registries configured - this is expected for now
    return [];
  }

  // Future: implement skill registry API calls when available
  // For now, skill: prefix falls back to git sources
  return [];
}

export async function search(
  query: string,
  options?: { type?: RegistryType; registry?: string; limit?: number }
): Promise<RegistrySearchResult[]> {
  const results: RegistrySearchResult[] = [];

  if (!options?.type || options.type === 'mcp') {
    const mcpResults = await searchMcpRegistries(query, options);
    results.push(...mcpResults);
  }

  if (!options?.type || options.type === 'skill') {
    const skillResults = await searchSkillRegistries(query, options);
    results.push(...skillResults);
  }

  return results;
}

export function parsePackageIdentifier(identifier: string): {
  type: RegistryType | 'git' | 'unknown';
  name: string;
} {
  // mcp:filesystem -> MCP registry
  if (identifier.startsWith('mcp:')) {
    return { type: 'mcp', name: identifier.slice(4) };
  }

  // skill:user/repo -> skill registry (or git fallback)
  if (identifier.startsWith('skill:')) {
    return { type: 'skill', name: identifier.slice(6) };
  }

  // gh:user/repo -> git source
  if (identifier.startsWith('gh:')) {
    return { type: 'git', name: identifier };
  }

  // https://... or git@... -> git source
  if (identifier.startsWith('https://') || identifier.startsWith('git@')) {
    return { type: 'git', name: identifier };
  }

  // user/repo format -> could be either, need to search
  if (identifier.includes('/') && !identifier.includes(':')) {
    return { type: 'unknown', name: identifier };
  }

  // Single word -> search MCP registries first
  return { type: 'unknown', name: identifier };
}

export async function resolvePackage(identifier: string): Promise<ResolvedPackage | null> {
  const parsed = parsePackageIdentifier(identifier);

  if (parsed.type === 'git') {
    return { type: 'git', source: parsed.name };
  }

  if (parsed.type === 'mcp') {
    const entry = await getMcpServerInfo(parsed.name);
    if (entry) {
      return {
        type: 'mcp',
        source: entry.repository?.url || entry.name,
        mcpEntry: entry,
      };
    }
    return null;
  }

  if (parsed.type === 'skill') {
    // Skill registries not available yet, treat as git source
    const gitSource = parsed.name.startsWith('gh:') ? parsed.name : `gh:${parsed.name}`;
    return { type: 'git', source: gitSource };
  }

  // Unknown type - search registries
  if (parsed.type === 'unknown') {
    // Try MCP first
    const mcpEntry = await getMcpServerInfo(parsed.name);
    if (mcpEntry) {
      return {
        type: 'mcp',
        source: mcpEntry.repository?.url || mcpEntry.name,
        mcpEntry,
      };
    }

    // If it looks like a git path (user/repo), treat as git
    if (parsed.name.includes('/')) {
      return { type: 'git', source: `gh:${parsed.name}` };
    }
  }

  return null;
}
