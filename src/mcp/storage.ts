import * as vscode from 'vscode';

export const STORAGE_KEYS = {
  LINEAR_TOKEN: 'linear_mcp_token',
  GITHUB_TOKEN: 'github_mcp_token',
} as const;

export async function storeToken(provider: string, token: string): Promise<void> {
  const key = `${provider}_mcp_token`;
  await vscode.env.set(key, token);
}

export async function getToken(provider: string): Promise<string | null> {
  const key = `${provider}_mcp_token`;
  return await vscode.env.get(key);
}

export async function clearToken(provider: string): Promise<void> {
  const key = `${provider}_mcp_token`;
  await vscode.env.set(key, undefined);
}
