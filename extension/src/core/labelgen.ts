import { spawn } from 'child_process';

const MAX_INPUT_CHARS = 4000;
const MAX_LABEL_CHARS = 50;
const DEFAULT_TIMEOUT_MS = 4000;

export async function generateLabelWithLLM(
  text: string | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const input = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;
  const prompt =
    'Generate a concise 3-5 word title for the following task or conversation. ' +
    'Output ONLY the title text, no quotes, no trailing punctuation, no explanation.\n\n' +
    '---\n' +
    input +
    '\n---';

  return new Promise<string | null>((resolve) => {
    let stdout = '';
    let resolved = false;

    const child = spawn('claude -p --model claude-haiku-4-5', [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('exit', (code) => {
      if (code !== 0) return finish(null);
      finish(sanitizeLabel(stdout));
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {
      finish(null);
    }
  });
}

function sanitizeLabel(raw: string): string | null {
  const firstLine = raw.trim().split('\n')[0]?.trim();
  if (!firstLine) return null;
  const stripped = firstLine.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();
  if (!stripped) return null;
  return stripped.length > MAX_LABEL_CHARS ? stripped.slice(0, MAX_LABEL_CHARS).trim() : stripped;
}
