import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'readline';
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

async function readHeadLines(filePath: string, maxLines: number): Promise<string[]> {
  const lines: string[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.trim()) {
        lines.push(line);
        if (lines.length >= maxLines) break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return lines;
}

// Read the last `maxLines` non-empty lines without loading the whole file.
// Opens the file, seeks backward in 64KB chunks from EOF until enough lines collected.
export async function readTailLines(filePath: string, maxLines: number): Promise<string[]> {
  const CHUNK_SIZE = 64 * 1024;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const { size: fileSize } = await handle.stat();
    if (fileSize === 0) return [];

    let position = fileSize;
    let buffer = '';
    let collected: string[] = [];

    while (position > 0 && collected.length <= maxLines) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;
      const chunk = Buffer.alloc(readSize);
      await handle.read(chunk, 0, readSize, position);
      buffer = chunk.toString('utf-8') + buffer;
      collected = buffer.split(/\r?\n/).filter(l => l.trim());
    }

    return collected.slice(-maxLines);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

function normalizePreview(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PREVIEW_CHARS - 3)}...`;
}

const SYNTHETIC_TAG_PREFIXES = [
  '<local-command-caveat',
  '<local-command-stdout',
  '<local-command-stderr',
  '<command-name',
  '<command-message',
  '<command-args',
  '<bash-input',
  '<bash-stdout',
  '<bash-stderr',
  '<system-reminder',
  '<user-prompt-submit-hook',
  '<task-notification',
  '<persisted-output',
];

function isSyntheticCommandText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  for (const prefix of SYNTHETIC_TAG_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  const stripped = trimmed.replace(/<[^>]*>/g, '').trim();
  if (!stripped) return true;
  if (lower.startsWith('caveat: the messages below')) return true;
  return false;
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

  if (obj.message && typeof obj.message === 'object' && !Array.isArray(obj.message)) {
    return extractCandidatesFromValue(obj.message);
  }

  if (obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)) {
    return extractCandidatesFromValue(obj.payload);
  }

  if (Array.isArray(obj.content)) {
    const candidates = extractCandidatesFromValue(obj.content);
    const parentRole = typeof obj.role === 'string' ? obj.role : undefined;
    if (parentRole) {
      return candidates.map(c => ({ ...c, role: c.role || parentRole }));
    }
    return candidates;
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
        if (parsed && typeof parsed === 'object' && (parsed as { isMeta?: unknown }).isMeta === true) {
          continue;
        }
        candidates = extractCandidatesFromValue(parsed);

        // Extract timestamp from the parsed event for user messages
        // Claude: event.timestamp, Codex: event.timestamp, Gemini: event.timestamp
        if (parsed && typeof parsed === 'object') {
          const eventTimestamp = (parsed as { timestamp?: unknown }).timestamp;
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
      if (isSyntheticCommandText(text)) continue;
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
    const lines = await readHeadLines(filePath, 60);
    return extractPreviewLines(lines.join('\n')).text;
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
// Claude replaces both slashes AND periods with dashes
// e.g., /Users/muqsit/src/github.com/project -> -Users-muqsit-src-github-com-project
function workspaceToClaudeFolder(workspacePath: string): string {
  return workspacePath.replace(/[\/\.]/g, '-');
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

export async function findFileBySessionId(dir: string, sessionId: string, depth: number): Promise<string | undefined> {
  if (depth < 0) return undefined;
  const entries = await safeReaddir(dir);

  // If sessionId is short (8 chars = session chunk), do prefix match
  const isChunk = sessionId.length === 8;

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
      // Exact match or prefix match for session chunks
      if (fileSessionId === sessionId || fileSessionId.endsWith(sessionId) || (isChunk && fileSessionId.startsWith(sessionId))) {
        return fullPath;
      }
    }
  }

  return undefined;
}

export async function getClaudeProjectRoots(homeDir: string = homedir()): Promise<string[]> {
  const roots: string[] = [path.join(homeDir, '.claude', 'projects')];
  const versionHomes = [
    path.join(homeDir, '.agents-system', 'versions', 'claude'),
    path.join(homeDir, '.agents', 'versions', 'claude'),
  ];
  for (const versionsDir of versionHomes) {
    const versions = await safeReaddir(versionsDir);
    for (const ver of versions) {
      if (!ver.isDirectory()) continue;
      roots.push(path.join(versionsDir, ver.name, 'home', '.claude', 'projects'));
    }
  }
  return roots;
}

export async function getSessionPathBySessionId(
  sessionId: string,
  agentType: 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor',
  workspacePath?: string,
  homeDir: string = homedir(),
): Promise<string | undefined> {
  switch (agentType) {
    case 'claude': {
      // We know the exact filename: {sessionId}.jsonl
      // Just find it under ~/.claude/projects/*/ or shim paths
      const filename = `${sessionId}.jsonl`;
      const roots = await getClaudeProjectRoots(homeDir);

      // Search each root's project subdirectories for the file
      for (const root of roots) {
        const projects = await safeReaddir(root);
        for (const project of projects) {
          if (!project.isDirectory()) continue;
          const filePath = path.join(root, project.name, filename);
          if (await safeStat(filePath)) return filePath;
        }
      }
      return undefined;
    }
    case 'codex': {
      const root = path.join(homedir(), '.codex', 'sessions');
      return await findFileBySessionId(root, sessionId, 4);
    }
    case 'gemini': {
      // Gemini stores chats at ~/.gemini/tmp/{projectHash}/chats/session-*.json.
      // Filenames embed the first 8 chars of sessionId; fall back to JSON scan
      // if the shorthand doesn't match (e.g. duplicate suffixes across projects).
      const tmpRoot = path.join(homedir(), '.gemini', 'tmp');
      const projects = await safeReaddir(tmpRoot);
      const shortId = sessionId.slice(0, 8);
      const candidates: string[] = [];
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const chatsDir = path.join(tmpRoot, project.name, 'chats');
        const entries = await safeReaddir(chatsDir);
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          const filePath = path.join(chatsDir, entry.name);
          if (entry.name.endsWith(`-${shortId}.json`)) return filePath;
          candidates.push(filePath);
        }
      }
      for (const filePath of candidates) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed?.sessionId === sessionId) return filePath;
        } catch { }
      }
      return undefined;
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
  lastActivityMs?: number;
  messageCount: number;
}


function extractLastUserMessage(tail: string): string | undefined {
  const lines = tail.split(/\r?\n/).filter(l => l.trim()).reverse();

  for (const line of lines) {
    const trimmed = line.trim();
    let candidates: Array<{ role?: string; text: string }> = [];

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && (parsed as { isMeta?: unknown }).isMeta === true) {
          continue;
        }
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
      if (isSyntheticCommandText(text)) continue;
      const role = candidate.role?.toLowerCase();
      if (role === 'user' || role === 'human') {
        return normalizePreview(text);
      }
    }
  }

  return undefined;
}

async function countNonEmptyLines(filePath: string): Promise<number> {
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let count = 0;
    for await (const line of rl) {
      if (line.trim()) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// Cache of full SessionPreviewInfo, invalidated by file mtime/size.
interface PreviewCacheEntry {
  mtimeMs: number;
  size: number;
  preview: SessionPreviewInfo;
}
const PREVIEW_CACHE = new Map<string, PreviewCacheEntry>();
const PREVIEW_CACHE_MAX = 200;

// The first user message of a session file is immutable once written.
// Cache it permanently (per filePath) so the hot "fetch label on focus"
// path never re-reads the file once the label has been extracted.
interface FirstMessageCacheEntry {
  text?: string;
  timestamp?: string;
}
const FIRST_MSG_CACHE = new Map<string, FirstMessageCacheEntry>();
const FIRST_MSG_CACHE_MAX = 500;

function evictLRU<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export async function getSessionPreviewInfo(filePath: string): Promise<SessionPreviewInfo> {
  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { messageCount: 0 };
  }

  const cached = PREVIEW_CACHE.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    PREVIEW_CACHE.delete(filePath);
    PREVIEW_CACHE.set(filePath, cached);
    return cached.preview;
  }

  let firstMsgEntry = FIRST_MSG_CACHE.get(filePath);

  const [headLines, tailLines, messageCount] = await Promise.all([
    firstMsgEntry ? Promise.resolve<string[]>([]) : readHeadLines(filePath, 60),
    readTailLines(filePath, 20),
    countNonEmptyLines(filePath),
  ]);

  if (!firstMsgEntry) {
    const extracted = extractPreviewLines(headLines.join('\n'));
    firstMsgEntry = { text: extracted.text, timestamp: extracted.timestamp };
    FIRST_MSG_CACHE.set(filePath, firstMsgEntry);
    evictLRU(FIRST_MSG_CACHE, FIRST_MSG_CACHE_MAX);
  }

  const lastUserMessage = extractLastUserMessage(tailLines.join('\n'));

  const preview: SessionPreviewInfo = {
    firstUserMessage: firstMsgEntry.text,
    firstUserMessageTimestamp: firstMsgEntry.timestamp,
    lastUserMessage,
    lastActivityMs: stat.mtimeMs,
    messageCount,
  };

  PREVIEW_CACHE.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, preview });
  evictLRU(PREVIEW_CACHE, PREVIEW_CACHE_MAX);

  return preview;
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
