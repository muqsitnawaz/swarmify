import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type { Dirent, Stats } from 'fs';
import { AgentSession } from '../core/sessions';
import type { SqlJsStatic } from 'sql.js';

// Cached SQL.js instance (lazy-loaded)
let sqlJsPromise: Promise<SqlJsStatic | null> | null = null;

async function getSqlJs(): Promise<SqlJsStatic | null> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      try {
        const initSqlJs = (await import('sql.js')).default;
        return await initSqlJs();
      } catch {
        return null;
      }
    })();
  }
  return sqlJsPromise;
}

const SESSION_EXTENSIONS = new Set(['.jsonl', '.json', '.txt']);
const MAX_PREVIEW_BYTES = 12 * 1024;
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

function extractCandidatesFromValue(value: unknown): Array<{ role?: string; text: string }> {
  if (!value) return [];
  if (typeof value === 'string') return [{ text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractCandidatesFromValue(entry));
  }
  if (typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;

  if (Array.isArray(obj.messages)) {
    return extractCandidatesFromValue(obj.messages);
  }

  if (Array.isArray(obj.content)) {
    return extractCandidatesFromValue(obj.content);
  }

  const text = extractTextFromJson(obj);
  if (!text) return [];
  const role = typeof obj.role === 'string' ? obj.role : undefined;
  return [{ role, text }];
}

interface ExtractedPreview {
  text?: string;
  timestamp?: string;
}

function extractPreviewLines(head: string): ExtractedPreview {
  const lines = head.split(/\r?\n/);
  let firstAny: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;
    const trimmed = line.trim();
    let candidates: Array<{ role?: string; text: string; timestamp?: string }> = [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        candidates = extractCandidatesFromValue(parsed);

        // Extract timestamp from the parsed event for user messages
        // Claude: event.timestamp, Codex: event.timestamp, Gemini: event.timestamp
        if (parsed && typeof parsed === 'object') {
          const eventTimestamp = parsed.timestamp;
          if (eventTimestamp && typeof eventTimestamp === 'string') {
            for (const candidate of candidates) {
              candidate.timestamp = eventTimestamp;
            }
          }
        }
      } catch {
        candidates = [];
      }
    } else {
      candidates = [{ text: trimmed }];
    }

    for (const candidate of candidates) {
      const text = candidate.text?.trim();
      if (!text) continue;
      const role = candidate.role?.toLowerCase();
      if (role === 'user' || role === 'human') {
        return { text: normalizePreview(text), timestamp: candidate.timestamp };
      }
      if (!firstAny) firstAny = text;
    }
  }

  if (!firstAny) return {};
  return { text: normalizePreview(firstAny) };
}

async function getPreview(filePath: string): Promise<string | undefined> {
  try {
    const head = await readFileHead(filePath, MAX_PREVIEW_BYTES);
    return extractPreviewLines(head).text;
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

// Convert workspace path to Claude's project folder name format
// e.g., /Users/muqsit/src/project -> -Users-muqsit-src-project
function workspaceToClaudeFolder(workspacePath: string): string {
  return workspacePath.replace(/\//g, '-');
}

async function discoverClaudeProjectSessions(projectPath: string): Promise<AgentSession[]> {
  const sessions: AgentSession[] = [];

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

  return sessions;
}

async function discoverClaudeSessions(workspacePath?: string): Promise<AgentSession[]> {
  const root = path.join(homedir(), '.claude', 'projects');

  // If workspace provided, only scan that project folder
  if (workspacePath) {
    const projectFolder = workspaceToClaudeFolder(workspacePath);
    const projectPath = path.join(root, projectFolder);
    return await discoverClaudeProjectSessions(projectPath);
  }

  // No filter - scan all projects
  const projects = await safeReaddir(root);
  const sessions: AgentSession[] = [];

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);
    const projectSessions = await discoverClaudeProjectSessions(projectPath);
    sessions.push(...projectSessions);
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

export async function discoverRecentSessions(
  limit: number = 50,
  workspacePath?: string
): Promise<AgentSession[]> {
  const [claudeSessions, codexSessions, geminiSessions] = await Promise.all([
    discoverClaudeSessions(workspacePath),
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

// --- Session path resolution by sessionId ---

async function findFileBySessionId(dir: string, sessionId: string, depth: number): Promise<string | undefined> {
  if (depth < 0) return undefined;
  const entries = await safeReaddir(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFileBySessionId(fullPath, sessionId, depth - 1);
      if (found) return found;
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SESSION_EXTENSIONS.has(ext)) {
      const fileSessionId = path.basename(entry.name, ext);
      if (fileSessionId === sessionId) return fullPath;
    }
  }

  return undefined;
}

export async function getSessionPathBySessionId(
  sessionId: string,
  agentType: 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor',
  workspacePath?: string
): Promise<string | undefined> {
  switch (agentType) {
    case 'claude': {
      const root = path.join(homedir(), '.claude', 'projects');
      if (workspacePath) {
        const projectFolder = workspaceToClaudeFolder(workspacePath);
        const projectPath = path.join(root, projectFolder);
        // Check direct file first, then sessions subfolder
        for (const ext of SESSION_EXTENSIONS) {
          const directPath = path.join(projectPath, `${sessionId}${ext}`);
          if (await safeStat(directPath)) return directPath;
        }
        // Search in sessions directory
        return await findFileBySessionId(path.join(projectPath, 'sessions'), sessionId, 2);
      }
      // No workspace - search all projects
      const projects = await safeReaddir(root);
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const projectPath = path.join(root, project.name);
        for (const ext of SESSION_EXTENSIONS) {
          const directPath = path.join(projectPath, `${sessionId}${ext}`);
          if (await safeStat(directPath)) return directPath;
        }
        const found = await findFileBySessionId(path.join(projectPath, 'sessions'), sessionId, 2);
        if (found) return found;
      }
      return undefined;
    }
    case 'codex': {
      const root = path.join(homedir(), '.codex', 'sessions');
      return await findFileBySessionId(root, sessionId, 4);
    }
    case 'gemini': {
      const root = path.join(homedir(), '.gemini', 'sessions');
      return await findFileBySessionId(root, sessionId, 3);
    }
    case 'opencode': {
      // OpenCode stores messages in ~/.local/share/opencode/storage/message/{sessionId}/
      // with content in part/{messageId}/ - return the message directory path
      const messageDir = path.join(homedir(), '.local', 'share', 'opencode', 'storage', 'message', sessionId);
      if (await safeStat(messageDir)) return messageDir;
      return undefined;
    }
    case 'cursor': {
      // Cursor stores chats in ~/.cursor/chats/{workspaceHash}/{chatId}/store.db (SQLite)
      // sessionId is the chatId (UUID format like 52183600-90ca-4703-aeb7-f9017aab808e)
      const chatsRoot = path.join(homedir(), '.cursor', 'chats');
      const workspaceHashes = await safeReaddir(chatsRoot);
      for (const wsHash of workspaceHashes) {
        if (!wsHash.isDirectory()) continue;
        const chatPath = path.join(chatsRoot, wsHash.name, sessionId, 'store.db');
        if (await safeStat(chatPath)) return chatPath;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// --- Session preview info (last user message + message count) ---

export interface SessionPreviewInfo {
  firstUserMessage?: string;
  firstUserMessageTimestamp?: string;
  lastUserMessage?: string;
  messageCount: number;
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  const stats = await safeStat(filePath);
  if (!stats) return '';
  const start = Math.max(0, stats.size - maxBytes);
  const handle = await fs.open(filePath, 'r');
  try {
    const readSize = Math.min(maxBytes, stats.size);
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, start);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

function extractLastUserMessage(tail: string): string | undefined {
  const lines = tail.split(/\r?\n/).filter(l => l.trim()).reverse();

  for (const line of lines) {
    const trimmed = line.trim();
    let candidates: Array<{ role?: string; text: string }> = [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        candidates = extractCandidatesFromValue(parsed);
      } catch {
        candidates = [];
      }
    } else {
      candidates = [{ text: trimmed }];
    }

    for (const candidate of candidates) {
      const text = candidate.text?.trim();
      if (!text) continue;
      const role = candidate.role?.toLowerCase();
      if (role === 'user' || role === 'human') {
        return normalizePreview(text);
      }
    }
  }

  return undefined;
}

async function countNonEmptyLines(filePath: string): Promise<number> {
  const MAX_FULL_READ_BYTES = 512 * 1024; // 512KB - read fully below this
  const SAMPLE_BYTES = 64 * 1024; // 64KB sample for large files
  try {
    const stats = await safeStat(filePath);
    if (!stats) return 0;

    // For large files, sample and extrapolate to avoid loading entire file
    if (stats.size > MAX_FULL_READ_BYTES) {
      const sample = await readFileHead(filePath, SAMPLE_BYTES);
      const sampleLines = sample.split(/\r?\n/).filter(l => l.trim()).length;
      const ratio = stats.size / SAMPLE_BYTES;
      return Math.round(sampleLines * ratio);
    }

    // Small files - read fully
    const content = await fs.readFile(filePath, 'utf-8');
    return content.split(/\r?\n/).filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

export async function getSessionPreviewInfo(filePath: string): Promise<SessionPreviewInfo> {
  const [head, tail, messageCount] = await Promise.all([
    readFileHead(filePath, MAX_PREVIEW_BYTES),
    readFileTail(filePath, MAX_PREVIEW_BYTES),
    countNonEmptyLines(filePath)
  ]);

  const extracted = extractPreviewLines(head);
  const lastUserMessage = extractLastUserMessage(tail);

  return {
    firstUserMessage: extracted.text,
    firstUserMessageTimestamp: extracted.timestamp,
    lastUserMessage,
    messageCount
  };
}

/**
 * Get session preview info for OpenCode sessions.
 * OpenCode stores messages in separate JSON files with content in part/ directory.
 * Structure: message/{sessionId}/msg_xxx.json -> part/{messageId}/prt_xxx.json
 */
export async function getOpenCodeSessionPreviewInfo(messageDir: string): Promise<SessionPreviewInfo> {
  try {
    const entries = await safeReaddir(messageDir);
    const msgFiles = entries
      .filter(e => e.isFile() && e.name.startsWith('msg_') && e.name.endsWith('.json'))
      .map(e => e.name)
      .sort(); // Sort to get chronological order (IDs are time-based)

    if (msgFiles.length === 0) {
      return { messageCount: 0 };
    }

    // Find first user message
    let firstUserMessage: string | undefined;
    for (const msgFile of msgFiles) {
      try {
        const msgPath = path.join(messageDir, msgFile);
        const msgContent = await fs.readFile(msgPath, 'utf-8');
        const msg = JSON.parse(msgContent);

        if (msg.role === 'user') {
          // Try to get actual text from part file
          const messageId = msg.id;
          const partDir = path.join(homedir(), '.local', 'share', 'opencode', 'storage', 'part', messageId);
          const partEntries = await safeReaddir(partDir);
          const partFile = partEntries.find(e => e.isFile() && e.name.startsWith('prt_') && e.name.endsWith('.json'));

          if (partFile) {
            const partPath = path.join(partDir, partFile.name);
            const partContent = await fs.readFile(partPath, 'utf-8');
            const part = JSON.parse(partContent);
            if (part.text && typeof part.text === 'string') {
              firstUserMessage = normalizePreview(part.text);
              break;
            }
          }

          // Fallback to summary.title if no part file
          if (msg.summary?.title) {
            firstUserMessage = normalizePreview(msg.summary.title);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return {
      firstUserMessage,
      messageCount: msgFiles.length
    };
  } catch {
    return { messageCount: 0 };
  }
}

/**
 * Get session preview info for Cursor Agent sessions.
 * Cursor stores chats in SQLite databases at ~/.cursor/chats/{hash}/{chatId}/store.db
 * Structure: blobs table contains JSON messages with role and content fields
 * Uses sql.js (WebAssembly SQLite) for cross-platform compatibility.
 */
export async function getCursorSessionPreviewInfo(dbPath: string): Promise<SessionPreviewInfo> {
  try {
    const SQL = await getSqlJs();
    if (!SQL) {
      return { messageCount: 0 };
    }

    // Read the database file
    const fsSync = await import('fs');
    const fileBuffer = fsSync.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    try {
      // Get all blobs
      const results = db.exec('SELECT data FROM blobs');
      if (!results.length || !results[0].values.length) {
        return { messageCount: 0 };
      }

      let firstUserMessage: string | undefined;
      let messageCount = 0;

      for (const row of results[0].values) {
        try {
          // sql.js returns blob data as Uint8Array
          const data = row[0];
          if (!(data instanceof Uint8Array)) continue;
          if (data.length === 0 || data[0] !== 0x7B) continue; // Skip non-JSON blobs

          const dataStr = new TextDecoder().decode(data);
          const msg = JSON.parse(dataStr);

          if (msg.role === 'user') {
            messageCount++;
            if (!firstUserMessage && msg.content) {
              // Extract text from content array
              // Format: [{type: "text", text: "..."}, ...]
              const content = Array.isArray(msg.content) ? msg.content : [msg.content];
              for (const part of content) {
                if (typeof part === 'string') {
                  if (!part.startsWith('<')) {
                    firstUserMessage = normalizePreview(part);
                    break;
                  }
                }
                if (part && typeof part === 'object' && part.type === 'text' && part.text) {
                  const text = part.text as string;
                  // Extract text from <user_query> tags if present
                  const queryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*(?:<\/user_query>|$)/);
                  if (queryMatch) {
                    firstUserMessage = normalizePreview(queryMatch[1].trim());
                    break;
                  }
                  if (!text.startsWith('<')) {
                    firstUserMessage = normalizePreview(text);
                    break;
                  }
                }
              }
            }
          } else if (msg.role === 'assistant') {
            messageCount++;
          }
        } catch {
          continue;
        }
      }

      return {
        firstUserMessage,
        messageCount
      };
    } finally {
      db.close();
    }
  } catch {
    return { messageCount: 0 };
  }
}
