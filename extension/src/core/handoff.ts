import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface HandoffMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HandoffContext {
  fromAgent: string;
  messages: HandoffMessage[];
  planContent?: string;
  planPath?: string;
}

const CLAUDE_PLANS_DIR = path.join(homedir(), '.claude', 'plans');

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function findFileInProjects(sessionId: string): Promise<string | null> {
  const projectsDir = path.join(homedir(), '.claude', 'projects');

  try {
    const projects = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const project of projects) {
      if (!project.isDirectory()) continue;

      const projectPath = path.join(projectsDir, project.name);

      try {
        const files = await fs.readdir(projectPath, { withFileTypes: true });

        for (const file of files) {
          if (!file.isFile()) continue;

          const ext = path.extname(file.name);
          const fileSessionId = path.basename(file.name, ext);

          if (fileSessionId === sessionId) {
            return path.join(projectPath, file.name);
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function getFileStats(filePath: string): Promise<{ path: string; mtime: Date } | null> {
  try {
    const stats = await fs.stat(filePath);
    return { path: filePath, mtime: stats.mtime };
  } catch {
    return null;
  }
}

export async function findRecentClaudePlan(): Promise<{ path: string; content: string } | null> {
  const files = await safeReaddir(CLAUDE_PLANS_DIR);
  if (files.length === 0) return null;

  const stats = await Promise.all(files.map(getFileStats));
  const validStats = stats.filter((s): s is { path: string; mtime: Date } => s !== null);

  if (validStats.length === 0) return null;

  validStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const mostRecent = validStats[0];

  try {
    const content = await fs.readFile(mostRecent.path, 'utf-8');
    return { path: mostRecent.path, content };
  } catch {
    return null;
  }
}

export async function getSessionMessages(
  sessionPath: string,
  maxMessages: number = 10
): Promise<HandoffMessage[]> {
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    const messages: HandoffMessage[] = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      if (messages.length >= maxMessages) break;

      try {
        const line = lines[i];
        const parsed = JSON.parse(line);

        const message = extractMessageFromLine(parsed);
        if (message) {
          messages.unshift(message);
        }
      } catch {
        continue;
      }
    }

    return messages;
  } catch {
    return [];
  }
}

function extractMessageFromLine(parsed: any): HandoffMessage | null {
  if (!parsed) return null;

  const eventType = parsed?.type;

  if (eventType === 'user') {
    const message = parsed?.message || {};
    const contentBlocks = message?.content || [];

    for (const block of contentBlocks) {
      if (block?.type === 'text' && block?.text?.trim()) {
        return { role: 'user', content: block.text };
      }
    }

    if (typeof message?.text === 'string' && message.text.trim()) {
      return { role: 'user', content: message.text };
    }

    if (typeof parsed?.content === 'string' && parsed.content.trim()) {
      return { role: 'user', content: parsed.content };
    }
  }

  if (eventType === 'assistant') {
    const message = parsed?.message || {};
    const contentBlocks = message?.content || [];

    for (const block of contentBlocks) {
      if (block?.type === 'text' && block?.text?.trim()) {
        return { role: 'assistant', content: block.text };
      }
    }

    if (typeof message?.text === 'string' && message.text.trim()) {
      return { role: 'assistant', content: message.text };
    }

    if (typeof parsed?.content === 'string' && parsed.content.trim()) {
      return { role: 'assistant', content: parsed.content };
    }
  }

  if (eventType === 'user_message' || eventType === 'human_message') {
    const content = parsed?.message?.text || parsed?.content || parsed?.text || '';
    if (content) {
      return { role: 'user', content };
    }
  }

  if (eventType === 'assistant_message') {
    const message = parsed?.message || {};
    const contentBlocks = message?.content || [];

    for (const block of contentBlocks) {
      if (block?.type === 'text' && block?.text?.trim()) {
        return { role: 'assistant', content: block.text };
      }
    }

    if (typeof message?.text === 'string' && message.text.trim()) {
      return { role: 'assistant', content: message.text };
    }

    if (typeof parsed?.content === 'string' && parsed.content.trim()) {
      return { role: 'assistant', content: parsed.content };
    }
  }

  return null;
}

export async function getFirstUserMessage(
  sessionPath: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const message = extractMessageFromLine(parsed);
        if (message && message.role === 'user') {
          return message.content;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function getLastAssistantMessage(
  sessionPath: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        const message = extractMessageFromLine(parsed);
        if (message && message.role === 'assistant') {
          return message.content;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export interface ContinueContext {
  originalTask: string | null;
  lastResponse: string | null;
  filesEdited: string[];
  filesRead: string[];
  recentTools: string[];
  toolCalls: number;
}

export function formatContinuePrompt(ctx: ContinueContext): string {
  const parts: string[] = [];

  parts.push('Continue working on this task from a previous session.');

  if (ctx.originalTask) {
    const task = ctx.originalTask.length > 500
      ? ctx.originalTask.slice(0, 500) + '...'
      : ctx.originalTask;
    parts.push('');
    parts.push('<original_task>');
    parts.push(task);
    parts.push('</original_task>');
  }

  if (ctx.filesEdited.length > 0 || ctx.filesRead.length > 0 || ctx.toolCalls > 0) {
    parts.push('');
    parts.push('<session_activity>');
    if (ctx.filesEdited.length > 0) {
      parts.push(`Files edited: ${ctx.filesEdited.join(', ')}`);
    }
    if (ctx.filesRead.length > 0) {
      const readOnly = ctx.filesRead.filter(f => !ctx.filesEdited.includes(f));
      if (readOnly.length > 0) {
        parts.push(`Files read: ${readOnly.slice(0, 15).join(', ')}`);
      }
    }
    parts.push(`Tool calls: ${ctx.toolCalls}`);
    parts.push('</session_activity>');
  }

  if (ctx.lastResponse) {
    const response = ctx.lastResponse.length > 2000
      ? ctx.lastResponse.slice(0, 2000) + '...'
      : ctx.lastResponse;
    parts.push('');
    parts.push('<last_response>');
    parts.push(response);
    parts.push('</last_response>');
  }

  parts.push('');
  parts.push('Read the files that were edited to understand current state, then continue where the previous session left off.');

  return parts.join('\n');
}

export function formatHandoffPrompt(context: HandoffContext): string {
  const parts: string[] = [];

  parts.push(`Please take over this task from ${context.fromAgent}.`);

  if (context.messages.length > 0) {
    parts.push('\n\n<recent_messages>');
    for (const msg of context.messages) {
      const roleName = msg.role === 'user' ? 'User' : 'Assistant';
      const truncated = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
      parts.push(`${roleName}: ${truncated}`);
    }
    parts.push('</recent_messages>');
  }

  if (context.planContent) {
    parts.push('\n\n<current_plan>');
    parts.push(context.planContent);
    parts.push('</current_plan>');
  }

  return parts.join('\n');
}
