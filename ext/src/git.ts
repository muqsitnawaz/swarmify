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
