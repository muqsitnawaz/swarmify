// VS Code-dependent symlink creation for context files

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getSymlinkTargetsForFileName,
  getMissingTargets,
  getContextMappings,
  isSymlinkingEnabled,
} from '../core/agentlinks';
import { AgentsConfig } from '../core/swarmifyConfig';
import { loadWorkspaceConfig, configExists } from './swarmifyConfig.vscode';

const PROMPT_ACTION_CREATE = 'Create symlinks';
const PROMPT_ACTION_NOT_NOW = 'Not now';

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// Legacy function for backward compatibility - used when no .agents config exists
export async function maybePromptForAgentSymlinks(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): Promise<void> {
  const fileName = path.basename(document.uri.fsPath);
  const targets = getSymlinkTargetsForFileName(fileName);
  if (targets.length === 0) return;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;

  // If .agents exists, use config-driven symlinks instead
  if (configExists(workspaceFolder)) {
    return;
  }

  const folderPath = workspaceFolder.uri.fsPath;
  const existingTargets = targets.filter(target => {
    const targetPath = path.join(folderPath, target);
    return pathExists(targetPath);
  });

  const missingTargets = getMissingTargets(targets, existingTargets);
  if (missingTargets.length === 0) return;

  const stateKey = `agents.symlinkPrompted:${workspaceFolder.uri.toString()}:${document.uri.fsPath}`;
  if (context.workspaceState.get<boolean>(stateKey, false)) return;

  const message = `Link ${missingTargets.join(', ')} to ${fileName}?`;
  const selection = await vscode.window.showInformationMessage(
    message,
    { modal: false },
    PROMPT_ACTION_CREATE,
    PROMPT_ACTION_NOT_NOW
  );

  await context.workspaceState.update(stateKey, true);

  if (selection !== PROMPT_ACTION_CREATE) return;

  const sourcePath = document.uri.fsPath;
  const errors: string[] = [];

  for (const target of missingTargets) {
    const targetPath = path.join(folderPath, target);
    if (pathExists(targetPath)) {
      continue;
    }

    try {
      const relativeSource = path.relative(path.dirname(targetPath), sourcePath);
      fs.symlinkSync(relativeSource, targetPath, 'file');
    } catch (err) {
      const error = err as Error;
      errors.push(`${target}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    vscode.window.showErrorMessage(
      `Failed to create symlinks. ${errors.join(' | ')}`
    );
    return;
  }

  vscode.window.showInformationMessage('Symlinks created.');
}

// Create symlink at a specific path
function createSymlink(sourcePath: string, targetPath: string): string | null {
  if (pathExists(targetPath)) {
    return null; // Target exists, skip (safety: don't overwrite)
  }

  try {
    const relativeSource = path.relative(path.dirname(targetPath), sourcePath);
    fs.symlinkSync(relativeSource, targetPath, 'file');
    return null;
  } catch (err) {
    const error = err as Error;
    return error.message;
  }
}

// Find all source files recursively in a directory
async function findSourceFilesRecursively(
  rootPath: string,
  sourceFileName: string
): Promise<string[]> {
  const pattern = new vscode.RelativePattern(rootPath, `**/${sourceFileName}`);
  const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
  return files.map(f => f.fsPath);
}

// Create symlinks for a single source file in its directory
function createSymlinksInDirectory(
  sourcePath: string,
  aliases: string[]
): { created: number; errors: string[] } {
  const dirPath = path.dirname(sourcePath);
  const errors: string[] = [];
  let created = 0;

  for (const target of aliases) {
    const targetPath = path.join(dirPath, target);
    const error = createSymlink(sourcePath, targetPath);
    if (error) {
      errors.push(`${targetPath}: ${error}`);
    } else if (!pathExists(targetPath)) {
      // Symlink was not created because target already existed
    } else {
      created++;
    }
  }

  return { created, errors };
}

// Create symlinks codebase-wide using config
export async function createSymlinksCodebaseWide(
  workspaceFolder: vscode.WorkspaceFolder,
  config: AgentsConfig
): Promise<{ created: number; errors: string[] }> {
  if (!isSymlinkingEnabled(config)) {
    return { created: 0, errors: [] };
  }

  let totalCreated = 0;
  const allErrors: string[] = [];

  // Process each context mapping (source -> aliases)
  for (const mapping of getContextMappings(config)) {
    const sourceFiles = await findSourceFilesRecursively(
      workspaceFolder.uri.fsPath,
      mapping.source
    );

    for (const sourcePath of sourceFiles) {
      const { created, errors } = createSymlinksInDirectory(sourcePath, mapping.aliases);
      totalCreated += created;
      allErrors.push(...errors);
    }
  }

  return { created: totalCreated, errors: allErrors };
}

// Ensure symlinks exist on workspace open (silent, no prompts)
export async function ensureSymlinksOnWorkspaceOpen(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
  if (!configExists(workspaceFolder)) {
    return;
  }

  const config = await loadWorkspaceConfig(workspaceFolder);
  if (!isSymlinkingEnabled(config)) {
    return;
  }

  const { created, errors } = await createSymlinksCodebaseWide(workspaceFolder, config);

  // Silent operation - only show errors if any
  if (errors.length > 0) {
    console.error('[agents] Symlink errors:', errors);
  }

  if (created > 0) {
    console.log(`[agents] Created ${created} symlink(s) in workspace`);
  }
}
