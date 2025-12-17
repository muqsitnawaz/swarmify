// Swarm MCP configuration - VS Code dependent functions

import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export async function enableSwarm(context: vscode.ExtensionContext): Promise<void> {
  const cliTsPath = path.join(context.extensionPath, '..', 'cli-ts', 'dist', 'index.js');

  try {
    // Use claude mcp add to register the server
    await execAsync(`claude mcp add --scope user Swarm node "${cliTsPath}"`);
    vscode.window.showInformationMessage('Multi-agent support enabled. Reload Claude Code.');
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to enable swarm: ${error.stderr || error.message}`);
  }
}
