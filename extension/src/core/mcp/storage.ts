export const STORAGE_KEYS = {
  LINEAR_TOKEN: 'linear_mcp_token',
  GITHUB_TOKEN: 'github_mcp_token',
} as const;

export function getTokenKey(provider: string): string {
  return `${provider}_mcp_token`;
}
