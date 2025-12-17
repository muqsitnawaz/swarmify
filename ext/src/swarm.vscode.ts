// Swarm MCP configuration - VS Code dependent functions

import * as vscode from 'vscode';
import * as path from 'path';
import { McpConfig, createSwarmServerConfig, mergeMcpConfig } from './utils';

export async function enableSwarm(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const cliTsPath = path.join(context.extensionPath, '..', 'cli-ts', 'dist', 'index.js');
  const mcpJsonPath = path.join(workspaceFolder.uri.fsPath, '.mcp.json');

  // Read existing .mcp.json or create new
  let existingConfig: McpConfig | null = null;
  try {
    const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(mcpJsonPath));
    existingConfig = JSON.parse(existing.toString());
  } catch {
    // File doesn't exist, use null
  }

  // Merge swarm server config
  const swarmConfig = createSwarmServerConfig(cliTsPath);
  const mcpConfig = mergeMcpConfig(existingConfig, 'swarm', swarmConfig);

  // Write back
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(mcpJsonPath),
    Buffer.from(JSON.stringify(mcpConfig, null, 2))
  );

  vscode.window.showInformationMessage('Multi-agent support enabled. Reload Agents.');
}
