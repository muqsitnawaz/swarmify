import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type { Dirent, Stats } from 'fs';
import { AgentSession } from './sessions';

const SESSION_EXTENSIONS = new Set(['.jsonl', '.json', '.txt']);
const MAX_PREVIEW_BYTES = 12 * 1024;
const MAX_PREVIEW_LINES = 3;
const MAX_PREVIEW_CHARS = 240;

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readFileHead(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

function normalizePreview(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PREVIEW_CHARS - 3)}...`;
}

function extractTextFromJson(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  const keys = ['content', 'text', 'message', 'prompt', 'input'];
  for (const key of keys) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      const parts = candidate
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object' && 'text' in entry) {
            const text = (entry as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }
  }

  if (obj.delta && typeof obj.delta === 'object' && obj.delta) {
    const delta = obj.delta as Record<string, unknown>;
    if (typeof delta.text === 'string' && delta.text.trim()) return delta.text;
  }

  return null;
}

function extractPreviewLines(head: string): string | undefined {
  const lines = head.split(/\r?\n/);
  const collected: string[] = [];

  for (const line of lines) {
    if (collected.length >= MAX_PREVIEW_LINES) break;
    if (!line.trim()) continue;

    let text: string | null = null;
    const trimmed = line.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        text = extractTextFromJson(parsed);
      } catch {
        text = trimmed;
      }
    } else {
      text = trimmed;
    }

    if (text) collected.push(text);
  }

  return normalizePreview(collected.join('\n'));
}

async function getPreview(filePath: string): Promise<string | undefined> {
  try {
    const head = await readFileHead(filePath, MAX_PREVIEW_BYTES);
    return extractPreviewLines(head);
  } catch {
    return undefined;
  }
}

async function collectSessionFiles(dir: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await safeReaddir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSessionFiles(fullPath, depth - 1));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SESSION_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseCodexTimestamp(sessionId: string): Date | null {
  const match = sessionId.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

async function buildSession(
  agentType: AgentSession['agentType'],
  filePath: string,
  timestampOverride?: Date | null
): Promise<AgentSession | null> {
  const stats = await safeStat(filePath);
  if (!stats) return null;

  const sessionId = path.basename(filePath, path.extname(filePath));
  const hasOverride = timestampOverride && !Number.isNaN(timestampOverride.getTime());
  const timestamp = hasOverride ? timestampOverride : (stats.mtime ?? stats.birthtime);
  const preview = await getPreview(filePath);

  return {
    agentType,
    sessionId,
    timestamp,
    path: filePath,
    preview
  };
}

async function discoverClaudeSessions(): Promise<AgentSession[]> {
  const root = path.join(homedir(), '.claude', 'projects');
  const projects = await safeReaddir(root);
  const sessions: AgentSession[] = [];

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);

    const projectFiles = await safeReaddir(projectPath);
    for (const entry of projectFiles) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SESSION_EXTENSIONS.has(ext)) {
          const session = await buildSession('claude', path.join(projectPath, entry.name));
          if (session) sessions.push(session);
        }
      } else if (entry.isDirectory() && entry.name !== 'sessions') {
        const nestedFiles = await collectSessionFiles(path.join(projectPath, entry.name), 1);
        for (const nestedFile of nestedFiles) {
          const session = await buildSession('claude', nestedFile);
          if (session) sessions.push(session);
        }
      }
    }

    const sessionsDir = path.join(projectPath, 'sessions');
    const sessionFiles = await collectSessionFiles(sessionsDir, 2);
    for (const sessionFile of sessionFiles) {
      const session = await buildSession('claude', sessionFile);
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

async function discoverCodexSessions(): Promise<AgentSession[]> {
  const root = path.join(homedir(), '.codex', 'sessions');
  const files = await collectSessionFiles(root, 4);
  const sessions: AgentSession[] = [];

  for (const filePath of files) {
    const sessionId = path.basename(filePath, path.extname(filePath));
    const timestamp = parseCodexTimestamp(sessionId);
    const session = await buildSession('codex', filePath, timestamp);
    if (session) sessions.push(session);
  }

  return sessions;
}

async function discoverGeminiSessions(): Promise<AgentSession[]> {
  const root = path.join(homedir(), '.gemini', 'sessions');
  const files = await collectSessionFiles(root, 3);
  const sessions: AgentSession[] = [];

  for (const filePath of files) {
    const session = await buildSession('gemini', filePath);
    if (session) sessions.push(session);
  }

  return sessions;
}

export async function discoverRecentSessions(limit: number = 50): Promise<AgentSession[]> {
  const [claudeSessions, codexSessions, geminiSessions] = await Promise.all([
    discoverClaudeSessions(),
    discoverCodexSessions(),
    discoverGeminiSessions()
  ]);

  const all = [...claudeSessions, ...codexSessions, ...geminiSessions];
  all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return all.slice(0, limit);
}

export async function getSessionContent(session: AgentSession): Promise<string> {
  try {
    const content = await fs.readFile(session.path, 'utf-8');
    return content.toString();
  } catch (error) {
    console.error(`[SESSIONS] Failed to read ${session.path}`, error);
    return '';
  }
}
