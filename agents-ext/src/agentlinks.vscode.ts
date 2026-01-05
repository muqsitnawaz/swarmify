// VS Code-dependent symlink suggestion for AGENTS.md

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getSymlinkTargetsForFileName,
  getMissingTargets
} from './agentlinks';

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

export async function maybePromptForAgentSymlinks(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): Promise<void> {
  const fileName = path.basename(document.uri.fsPath);
  const targets = getSymlinkTargetsForFileName(fileName);
  if (targets.length === 0) return;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;

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
