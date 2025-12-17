// Swarm MCP configuration - VS Code dependent functions

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { McpConfig, createSwarmServerConfig, mergeMcpConfig } from './utils';

export async function enableSwarm(context: vscode.ExtensionContext): Promise<void> {
  const cliTsPath = path.join(context.extensionPath, '..', 'cli-ts', 'dist', 'index.js');
  const mcpJsonPath = path.join(os.homedir(), '.claude', 'mcp.json');

  // Ensure ~/.claude directory exists
  const claudeDir = path.join(os.homedir(), '.claude');
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(claudeDir));
  } catch {
    // Directory already exists
  }

  // Read existing mcp.json or create new
  let existingConfig: McpConfig | null = null;
  try {
    const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(mcpJsonPath));
    existingConfig = JSON.parse(existing.toString());
  } catch {
    // File doesn't exist, use null
  }

  // Merge swarm server config
  const swarmConfig = createSwarmServerConfig(cliTsPath);
  const mcpConfig = mergeMcpConfig(existingConfig, 'Swarm', swarmConfig);

  // Write back
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(mcpJsonPath),
    Buffer.from(JSON.stringify(mcpConfig, null, 2))
  );

  vscode.window.showInformationMessage('Multi-agent support enabled. Reload Claude Code.');
}
