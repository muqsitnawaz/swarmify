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
import { loadWorkspaceConfig, hasEffectiveConfig } from './swarmifyConfig.vscode';

const PROMPT_ACTION_CREATE = 'Create symlinks';
const PROMPT_ACTION_NOT_NOW = 'Not now';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.lstat(filePath);
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

  // If any config exists, use config-driven symlinks instead
  if (hasEffectiveConfig(workspaceFolder)) {
    return;
  }

  const folderPath = workspaceFolder.uri.fsPath;
  const existingTargets: string[] = [];
  for (const target of targets) {
    const targetPath = path.join(folderPath, target);
    if (await pathExists(targetPath)) {
      existingTargets.push(target);
    }
  }

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
    if (await pathExists(targetPath)) {
      continue;
    }

    try {
      const relativeSource = path.relative(path.dirname(targetPath), sourcePath);
      await fs.promises.symlink(relativeSource, targetPath, 'file');
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
async function createSymlink(sourcePath: string, targetPath: string): Promise<string | null> {
  if (await pathExists(targetPath)) {
    return null; // Target exists, skip (safety: don't overwrite)
  }

  try {
    const relativeSource = path.relative(path.dirname(targetPath), sourcePath);
    await fs.promises.symlink(relativeSource, targetPath, 'file');
    return null;
  } catch (err) {
    const error = err as Error;
    return error.message;
  }
}

// In-flight guard + short TTL cache for findFiles. Each findFiles spawns VS
// Code's bundled ripgrep; without this, concurrent or rapid-fire passes (one per
// workspace folder x mapping, fired by the .agents watcher) stack ripgrep
// processes for the same glob. Storing the promise dedupes in-flight calls; the
// TTL lets a burst of passes within the same window reuse one result.
const FIND_FILES_TTL_MS = 1000;
const findFilesCache = new Map<string, { at: number; result: Promise<string[]> }>();

// Find all source files recursively in a directory
async function findSourceFilesRecursively(
  rootPath: string,
  sourceFileName: string
): Promise<string[]> {
  const key = JSON.stringify([rootPath, sourceFileName]);
  const cached = findFilesCache.get(key);
  if (cached && Date.now() - cached.at < FIND_FILES_TTL_MS) {
    return cached.result;
  }

  const pattern = new vscode.RelativePattern(rootPath, `**/${sourceFileName}`);
  const result = Promise.resolve(
    vscode.workspace.findFiles(pattern, '**/node_modules/**')
  ).then(files => files.map(f => f.fsPath));
  findFilesCache.set(key, { at: Date.now(), result });
  return result;
}

// Create symlinks for a single source file in its directory
async function createSymlinksInDirectory(
  sourcePath: string,
  aliases: string[]
): Promise<{ created: number; errors: string[] }> {
  const dirPath = path.dirname(sourcePath);
  const errors: string[] = [];
  let created = 0;

  for (const target of aliases) {
    const targetPath = path.join(dirPath, target);
    const error = await createSymlink(sourcePath, targetPath);
    if (error) {
      errors.push(`${targetPath}: ${error}`);
    } else if (!(await pathExists(targetPath))) {
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
      const { created, errors } = await createSymlinksInDirectory(sourcePath, mapping.aliases);
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
  if (!hasEffectiveConfig(workspaceFolder)) {
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
