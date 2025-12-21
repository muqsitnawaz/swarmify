// Swarm MCP configuration - VS Code dependent functions

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

const SWARM_PACKAGE = 'swarm-mcp';

// Check if Swarm MCP server is configured
export async function isSwarmEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('claude mcp list');
    return stdout.includes('Swarm');
  } catch {
    return false;
  }
}

// Find agent-swarm binary in common locations
async function findSwarmBinary(): Promise<string | null> {
  const home = os.homedir();

  // Check common global install locations
  const candidates = [
    // Bun global
    path.join(home, '.bun', 'bin', 'swarm-mcp'),
    // npm/yarn global (macOS/Linux)
    path.join(home, '.npm-global', 'bin', 'swarm-mcp'),
    '/usr/local/bin/swarm-mcp',
    // npm global (Windows)
    path.join(process.env.APPDATA || '', 'npm', 'swarm-mcp.cmd'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try which/where command
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(`${cmd} swarm-mcp`);
    const found = stdout.trim().split('\n')[0];
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {
    // Not found via which/where
  }

  return null;
}

// Check if bun is available
async function hasBun(): Promise<boolean> {
  try {
    await execAsync('bun --version');
    return true;
  } catch {
    return false;
  }
}

// Install agent-swarm globally
async function installSwarm(): Promise<boolean> {
  const useBun = await hasBun();
  const installCmd = useBun
    ? `bun add -g ${SWARM_PACKAGE}`
    : `npm install -g ${SWARM_PACKAGE}`;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing ${SWARM_PACKAGE}...`,
        cancellable: false,
      },
      async () => {
        await execAsync(installCmd);
      }
    );
    return true;
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(
      `Failed to install ${SWARM_PACKAGE}: ${error.stderr || error.message}`
    );
    return false;
  }
}

export async function enableSwarm(_context: vscode.ExtensionContext): Promise<void> {
  // Check if already enabled
  if (await isSwarmEnabled()) {
    vscode.window.showInformationMessage('Swarm is already enabled.');
    return;
  }

  // Find or install agent-swarm
  let binaryPath = await findSwarmBinary();

  if (!binaryPath) {
    const choice = await vscode.window.showInformationMessage(
      `${SWARM_PACKAGE} is not installed. Install it now?`,
      'Install',
      'Cancel'
    );

    if (choice !== 'Install') {
      return;
    }

    const installed = await installSwarm();
    if (!installed) {
      return;
    }

    binaryPath = await findSwarmBinary();
    if (!binaryPath) {
      vscode.window.showErrorMessage(
        `Installed ${SWARM_PACKAGE} but could not find binary. Try: claude mcp add Swarm npx ${SWARM_PACKAGE}`
      );
      return;
    }
  }

  try {
    // Use claude mcp add to register the server
    await execAsync(`claude mcp add --scope user Swarm "${binaryPath}"`);
    vscode.window.showInformationMessage('Multi-agent support enabled. Reload Claude Code.');
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to enable swarm: ${error.stderr || error.message}`);
  }
}
