// VS Code integration for .agents config

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AGENTS_CONFIG_FILENAME,
  AgentsConfig,
  getDefaultConfig,
  parseAgentsConfig,
  parseAgentsConfigOverrides,
  mergeAgentsConfig,
  serializeAgentsConfig,
  // Legacy exports for backward compat
  SwarmifyConfig,
  parseSwarmifyConfig,
  serializeSwarmifyConfig,
} from '../core/swarmifyConfig';

// Re-export legacy names for backward compatibility
export { SwarmifyConfig, parseSwarmifyConfig, serializeSwarmifyConfig };

// Cache for loaded configs per workspace
const configCache = new Map<string, AgentsConfig>();

export function getConfigPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, AGENTS_CONFIG_FILENAME);
}

export function getUserConfigPath(): string {
  return path.join(os.homedir(), AGENTS_CONFIG_FILENAME);
}

export function configExists(workspaceFolder: vscode.WorkspaceFolder): boolean {
  const configPath = getConfigPath(workspaceFolder);
  try {
    fs.accessSync(configPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function userConfigExists(): boolean {
  const configPath = getUserConfigPath();
  try {
    fs.accessSync(configPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasEffectiveConfig(workspaceFolder: vscode.WorkspaceFolder): boolean {
  return configExists(workspaceFolder) || userConfigExists();
}

export function loadUserConfig(): AgentsConfig {
  const configPath = getUserConfigPath();
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return parseAgentsConfig(content);
  } catch {
    return getDefaultConfig();
  }
}

export async function loadWorkspaceConfig(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<AgentsConfig> {
  const cacheKey = workspaceFolder.uri.toString();

  // Check cache first
  const cached = configCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const userConfig = loadUserConfig();
  const configPath = getConfigPath(workspaceFolder);

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const overrides = parseAgentsConfigOverrides(content);
    const config = overrides
      ? mergeAgentsConfig(userConfig, overrides, { contextMerge: 'union' })
      : userConfig;
    configCache.set(cacheKey, config);
    return config;
  } catch {
    // File doesn't exist or is unreadable, return user config
    configCache.set(cacheKey, userConfig);
    return userConfig;
  }
}

export async function saveWorkspaceConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: AgentsConfig
): Promise<void> {
  const configPath = getConfigPath(workspaceFolder);
  const content = serializeAgentsConfig(config);
  fs.writeFileSync(configPath, content, 'utf-8');

  // Update cache
  const cacheKey = workspaceFolder.uri.toString();
  configCache.set(cacheKey, config);
}

export function clearConfigCache(workspaceFolder?: vscode.WorkspaceFolder): void {
  if (workspaceFolder) {
    configCache.delete(workspaceFolder.uri.toString());
  } else {
    configCache.clear();
  }
}

export function watchConfigFile(
  context: vscode.ExtensionContext,
  onConfigChange: (workspaceFolder: vscode.WorkspaceFolder) => void
): void {
  // Watch for .agents file changes in all workspace folders
  const watcher = vscode.workspace.createFileSystemWatcher(
    `**/${AGENTS_CONFIG_FILENAME}`,
    false, // create
    false, // change
    false // delete
  );

  watcher.onDidChange(uri => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      clearConfigCache(workspaceFolder);
      onConfigChange(workspaceFolder);
    }
  });

  watcher.onDidCreate(uri => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      clearConfigCache(workspaceFolder);
      onConfigChange(workspaceFolder);
    }
  });

  watcher.onDidDelete(uri => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      clearConfigCache(workspaceFolder);
      onConfigChange(workspaceFolder);
    }
  });

  context.subscriptions.push(watcher);
}

export function watchUserConfig(
  context: vscode.ExtensionContext,
  onConfigChange: () => void
): void {
  const configPath = path.join(os.homedir(), AGENTS_CONFIG_FILENAME);

  try {
    // Watch the specific .agents file instead of entire home directory
    // This is much more efficient on macOS (FSEvents overhead)
    const watcher = fs.watch(configPath, () => {
      clearConfigCache();
      onConfigChange();
    });

    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (error) {
    // File may not exist yet - fall back to watching home directory
    // but only trigger on .agents filename
    try {
      const homeDir = os.homedir();
      const fallbackWatcher = fs.watch(homeDir, (eventType, filename) => {
        if (filename === AGENTS_CONFIG_FILENAME) {
          clearConfigCache();
          onConfigChange();
        }
      });
      context.subscriptions.push({ dispose: () => fallbackWatcher.close() });
    } catch (fallbackError) {
      console.error('[agents] Failed to watch user config:', fallbackError);
    }
  }
}

export async function initWorkspaceConfig(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<AgentsConfig | null> {
  const configPath = getConfigPath(workspaceFolder);

  // Check if config already exists
  if (configExists(workspaceFolder)) {
    // Load and return existing config
    const config = await loadWorkspaceConfig(workspaceFolder);

    // Open file in editor
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);

    return config;
  }

  // Create new config with defaults
  const config = getDefaultConfig();
  await saveWorkspaceConfig(workspaceFolder, config);

  // Open file in editor
  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);

  return config;
}

export function getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  // Try to get workspace folder from active editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder;
    }
  }

  // Fall back to first workspace folder
  return vscode.workspace.workspaceFolders?.[0];
}
