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

// Check if /swarm slash command is installed
export function isSwarmCommandInstalled(): boolean {
  const commandPath = path.join(os.homedir(), '.claude', 'commands', 'swarm.md');
  return fs.existsSync(commandPath);
}

export interface SwarmStatus {
  mcpEnabled: boolean;
  commandInstalled: boolean;
}

// Get full swarm integration status
export async function getSwarmStatus(): Promise<SwarmStatus> {
  return {
    mcpEnabled: await isSwarmEnabled(),
    commandInstalled: isSwarmCommandInstalled(),
  };
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

// Install /swarm slash command from bundled asset
function installSwarmCommand(context: vscode.ExtensionContext): boolean {
  const commandsDir = path.join(os.homedir(), '.claude', 'commands');
  const targetPath = path.join(commandsDir, 'swarm.md');

  // Create commands dir if needed
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  // Read from bundled asset
  const sourcePath = path.join(context.extensionPath, 'assets', 'swarm.md');
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const content = fs.readFileSync(sourcePath, 'utf-8');

  // Always overwrite to ensure latest version
  fs.writeFileSync(targetPath, content);
  return true;
}

// Install swarm-mcp globally
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

export async function enableSwarm(context: vscode.ExtensionContext): Promise<void> {
  // Install /swarm slash command
  const commandInstalled = installSwarmCommand(context);

  // Check if MCP already enabled
  if (await isSwarmEnabled()) {
    if (commandInstalled) {
      vscode.window.showInformationMessage('Swarm /swarm command updated.');
    } else {
      vscode.window.showInformationMessage('Swarm is already enabled.');
    }
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
    vscode.window.showInformationMessage('Swarm MCP + /swarm command installed. Reload Claude Code.');
  } catch (err) {
    const error = err as Error & { stderr?: string };
    vscode.window.showErrorMessage(`Failed to enable swarm: ${error.stderr || error.message}`);
  }
}
