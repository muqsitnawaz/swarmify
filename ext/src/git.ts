// Git commit generation - pure functions (testable)

// Get API endpoint for provider
export function getApiEndpoint(provider: string): string {
  if (provider === 'openai') {
    return 'https://api.openai.com/v1/chat/completions';
  } else if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1/chat/completions';
  } else if (provider.startsWith('http')) {
    return provider;
  }
  return 'https://api.openai.com/v1/chat/completions';
}

// Parse ignore patterns from comma-separated string
export function parseIgnorePatterns(ignoreFilesRaw: string): string[] {
  if (!ignoreFilesRaw) return [];
  return ignoreFilesRaw.split(',').map(p => p.trim()).filter(Boolean);
}

// Check if a file path should be ignored based on patterns
export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some(pattern => {
    if (pattern.startsWith('*.')) {
      return filePath.endsWith(pattern.slice(1));
    }
    return filePath.includes(`/${pattern}/`) || filePath.includes(`/${pattern}`) || filePath.endsWith(`/${pattern}`);
  });
}

// Build system prompt for commit message generation
export function buildSystemPrompt(commitMessageExamples: string[]): string {
  let systemPrompt = "You are a helpful assistant that generates commit messages based on the provided git diffs. ";

  if (commitMessageExamples.length > 0) {
    let maxMessageLen = 50;
    for (const example of commitMessageExamples) {
      if (example.length > maxMessageLen) {
        maxMessageLen = example.length;
      }
    }
    systemPrompt += `Please generate the commit message following the style in these ${commitMessageExamples.length} examples: - ${commitMessageExamples.join('\n- ')}\n`;
    systemPrompt += `The commit message should be no longer than ${maxMessageLen} characters.\n`;
  }

  systemPrompt += "You should only output the commit message and nothing else.";
  return systemPrompt;
}

// Format git status for a change
export function formatChangeStatus(status: number, staged: boolean): string {
  const statusText = status === 7 ? 'New' :
    status === 5 ? 'Modified' :
      status === 6 ? 'Deleted' : 'Changed';
  return staged ? `Staged ${statusText}` : `Unstaged ${statusText}`;
}

export interface DirectoryMove {
  fromPrefix: string;
  toPrefix: string;
  fileCount: number;
  dirName: string;
}

export function detectDirectoryMoves(
  deletedPaths: string[],
  addedPaths: string[],
  minMatchThreshold: number = 5
): DirectoryMove | null {
  if (deletedPaths.length < minMatchThreshold || addedPaths.length < minMatchThreshold) {
    return null;
  }

  const addedSet = new Set(addedPaths);
  const deletedByPrefix = new Map<string, string[]>();

  for (const deletedPath of deletedPaths) {
    const parts = deletedPath.split('/').filter(Boolean);
    if (parts.length < 2) continue;

    for (let i = 1; i <= parts.length - 1; i++) {
      const prefix = parts.slice(0, i).join('/') + '/';
      if (!deletedByPrefix.has(prefix)) {
        deletedByPrefix.set(prefix, []);
      }
      deletedByPrefix.get(prefix)!.push(deletedPath);
    }
  }

  for (const [prefix, deletedFiles] of deletedByPrefix.entries()) {
    if (deletedFiles.length < minMatchThreshold) continue;

    const relativePaths = deletedFiles.map(path => {
      if (path.startsWith(prefix)) {
        return path.slice(prefix.length);
      }
      return path;
    });

    let matchCount = 0;
    for (const relPath of relativePaths) {
      if (addedSet.has(relPath)) {
        matchCount++;
      }
    }

    if (matchCount >= minMatchThreshold) {
      const prefixParts = prefix.split('/').filter(Boolean);
      const dirName = prefixParts[prefixParts.length - 1];
      return {
        fromPrefix: prefix,
        toPrefix: '',
        fileCount: matchCount,
        dirName: dirName
      };
    }

    const prefixParts = prefix.split('/').filter(Boolean);
    if (prefixParts.length >= 2) {
      const parentPrefix = prefixParts.slice(0, -1).join('/') + '/';
      matchCount = 0;

      for (const relPath of relativePaths) {
        const parentPath = parentPrefix + relPath;
        if (addedSet.has(parentPath)) {
          matchCount++;
        }
      }

      if (matchCount >= minMatchThreshold) {
        const dirName = prefixParts[prefixParts.length - 1];
        return {
          fromPrefix: prefix,
          toPrefix: parentPrefix,
          fileCount: matchCount,
          dirName: dirName
        };
      }
    }
  }

  return null;
}

export interface CommitContext {
  context: string;
  userPrompt: string;
  isMove: boolean;
  moveInfo?: DirectoryMove;
}

const MAX_CONTEXT_SIZE = 50 * 1024;
const MAX_STATUS_FILES = 100;

export function prepareCommitContext(
  statusChanges: string,
  deletedPaths: string[],
  addedPaths: string[],
  diffChanges?: string
): CommitContext {
  const directoryMove = detectDirectoryMoves(deletedPaths, addedPaths);
  const statusLines = statusChanges.split('\n').filter(Boolean);

  let context: string;
  let userPrompt: string;

  if (directoryMove) {
    const moveSummary = `${directoryMove.fileCount} files in dir ${directoryMove.dirName} moved from ${directoryMove.fromPrefix} to ${directoryMove.toPrefix || 'root'}`;

    let truncatedStatus = statusChanges;
    if (statusLines.length > MAX_STATUS_FILES) {
      const truncatedLines = statusLines.slice(0, MAX_STATUS_FILES);
      const remaining = statusLines.length - MAX_STATUS_FILES;
      truncatedStatus = truncatedLines.join('\n') + `\n... and ${remaining} more files`;
    }

    context = `Status:\n${truncatedStatus}\n\nMove detected: ${moveSummary}`;
    userPrompt = `Review the following git status and generate a concise commit message:\n\n${context}`;
  } else {
    let truncatedStatus = statusChanges;
    if (statusLines.length > MAX_STATUS_FILES) {
      const truncatedLines = statusLines.slice(0, MAX_STATUS_FILES);
      const remaining = statusLines.length - MAX_STATUS_FILES;
      truncatedStatus = truncatedLines.join('\n') + `\n... and ${remaining} more files`;
    }

    const fullChanges = `Status:\n${truncatedStatus}${diffChanges ? `\n\nDiff:\n${diffChanges}` : ''}`;

    if (fullChanges.length > MAX_CONTEXT_SIZE && diffChanges) {
      const statusPart = `Status:\n${truncatedStatus}`;
      const maxDiffSize = MAX_CONTEXT_SIZE - statusPart.length - 200;
      const truncatedDiff = diffChanges.length > maxDiffSize
        ? diffChanges.slice(0, maxDiffSize) + '\n... (diff truncated)'
        : diffChanges;
      context = `${statusPart}\n\nDiff:\n${truncatedDiff}`;
    } else {
      context = fullChanges;
    }

    userPrompt = `Review the following git status + diff and generate a concise commit message:\n\n${context}`;
  }

  if (context.length > MAX_CONTEXT_SIZE) {
    const truncated = context.slice(0, MAX_CONTEXT_SIZE - 100) + '\n... (context truncated)';
    context = truncated;
    userPrompt = `Review the following git status + diff and generate a concise commit message:\n\n${context}`;
  }

  return {
    context,
    userPrompt,
    isMove: !!directoryMove,
    moveInfo: directoryMove || undefined
  };
}
