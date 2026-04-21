/**
 * Local-disk Ledger implementation.
 *
 * Root: ~/.agents/ledger/ by default (override via `root` constructor arg).
 * Layout matches types.ts contract:
 *   teams/<team_id>/
 *     registry.json
 *     team.md
 *     sessions/<task_id>-<teammate>.jsonl
 *     artifacts/<task_id>/{diff.patch,test-output.txt,notes.md,...}
 *     bugs/<task_id>.md
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type {
  ArtifactKind,
  LedgerArtifact,
  LedgerRegistry,
  LedgerSearchHit,
  LedgerStore,
  LedgerTaskView,
} from './types.js';

const DEFAULT_ROOT = path.join(homedir(), '.agents', 'ledger');

/** Artifact kind → file name within artifacts/<task_id>/. */
function artifactFilename(kind: ArtifactKind): string {
  switch (kind) {
    case 'diff': return 'diff.patch';
    case 'test-output': return 'test-output.txt';
    case 'notes': return 'notes.md';
    default: return `${String(kind)}.txt`;
  }
}

function kindFromFilename(filename: string): ArtifactKind {
  if (filename === 'diff.patch') return 'diff';
  if (filename === 'test-output.txt') return 'test-output';
  if (filename === 'notes.md') return 'notes';
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readText(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf-8'); } catch { return null; }
}

async function statTimes(p: string): Promise<{ created: string; updated: string }> {
  const st = await fs.stat(p);
  return {
    created: (st.birthtime ?? st.mtime).toISOString(),
    updated: st.mtime.toISOString(),
  };
}

export class LocalDiskLedger implements LedgerStore {
  readonly kind = 'local' as const;
  private root: string;

  constructor(root: string | null = null) {
    this.root = root || DEFAULT_ROOT;
  }

  /** Resolve and ensure the root + team subdirs exist. */
  private async teamDir(team_id: string): Promise<string> {
    const d = path.join(this.root, 'teams', team_id);
    await fs.mkdir(path.join(d, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(d, 'artifacts'), { recursive: true });
    await fs.mkdir(path.join(d, 'bugs'), { recursive: true });
    return d;
  }

  private artifactDir(teamDir: string, task_id: string): string {
    return path.join(teamDir, 'artifacts', task_id);
  }

  private sessionPath(teamDir: string, task_id: string, teammate: string): string {
    // Teammate names are validated elsewhere; still, defensively replace separators.
    const safe = teammate.replace(/[/\\]/g, '_');
    return path.join(teamDir, 'sessions', `${task_id}-${safe}.jsonl`);
  }

  private bugPath(teamDir: string, task_id: string): string {
    return path.join(teamDir, 'bugs', `${task_id}.md`);
  }

  async putArtifact(
    team_id: string,
    task_id: string,
    kind: ArtifactKind,
    content: string,
    _teammate?: string
  ): Promise<void> {
    const teamDir = await this.teamDir(team_id);

    // Bugs live in bugs/, everything else under artifacts/<task_id>/.
    if (kind === 'bug') {
      await fs.writeFile(this.bugPath(teamDir, task_id), content);
      return;
    }

    const artDir = this.artifactDir(teamDir, task_id);
    await fs.mkdir(artDir, { recursive: true });
    await fs.writeFile(path.join(artDir, artifactFilename(kind)), content);
  }

  async appendSession(
    team_id: string,
    task_id: string,
    teammate: string,
    line: string
  ): Promise<void> {
    const teamDir = await this.teamDir(team_id);
    const p = this.sessionPath(teamDir, task_id, teammate);
    const payload = line.endsWith('\n') ? line : line + '\n';
    await fs.appendFile(p, payload);
  }

  async putRegistry(registry: LedgerRegistry): Promise<void> {
    const teamDir = await this.teamDir(registry.team_id);
    await fs.writeFile(
      path.join(teamDir, 'registry.json'),
      JSON.stringify(registry, null, 2)
    );
  }

  async getRegistry(team_id: string): Promise<LedgerRegistry | null> {
    const teamDir = await this.teamDir(team_id);
    const raw = await readText(path.join(teamDir, 'registry.json'));
    if (!raw) return null;
    try { return JSON.parse(raw) as LedgerRegistry; } catch { return null; }
  }

  async appendNarrative(team_id: string, text: string): Promise<void> {
    const teamDir = await this.teamDir(team_id);
    const p = path.join(teamDir, 'team.md');
    const line = text.endsWith('\n') ? text : text + '\n';
    await fs.appendFile(p, line);
  }

  async getNarrative(team_id: string): Promise<string | null> {
    const teamDir = await this.teamDir(team_id);
    return readText(path.join(teamDir, 'team.md'));
  }

  async note(
    team_id: string,
    task_id: string,
    teammate: string,
    text: string
  ): Promise<void> {
    const teamDir = await this.teamDir(team_id);
    const artDir = this.artifactDir(teamDir, task_id);
    await fs.mkdir(artDir, { recursive: true });
    const p = path.join(artDir, 'notes.md');
    const ts = new Date().toISOString();
    const header = `\n### ${ts} — ${teammate}\n\n`;
    const body = text.endsWith('\n') ? text : text + '\n';
    await fs.appendFile(p, header + body);
  }

  async read(
    team_id: string,
    task_id: string,
    kind?: ArtifactKind
  ): Promise<LedgerTaskView> {
    const teamDir = await this.teamDir(team_id);
    const artDir = this.artifactDir(teamDir, task_id);
    const artifacts: LedgerArtifact[] = [];

    if (kind && kind !== 'session' && kind !== 'bug') {
      const p = path.join(artDir, artifactFilename(kind));
      const content = await readText(p);
      if (content !== null) {
        const t = await statTimes(p);
        artifacts.push({
          team_id, task_id, kind, content,
          created_at: t.created, updated_at: t.updated,
        });
      }
    } else if (kind === 'bug') {
      const p = this.bugPath(teamDir, task_id);
      const content = await readText(p);
      if (content !== null) {
        const t = await statTimes(p);
        artifacts.push({
          team_id, task_id, kind: 'bug', content,
          created_at: t.created, updated_at: t.updated,
        });
      }
    } else if (kind === 'session') {
      // Collect every sessions/<task_id>-*.jsonl matching this task.
      const sessionsDir = path.join(teamDir, 'sessions');
      if (await pathExists(sessionsDir)) {
        const entries = await fs.readdir(sessionsDir);
        for (const e of entries) {
          if (!e.startsWith(`${task_id}-`) || !e.endsWith('.jsonl')) continue;
          const p = path.join(sessionsDir, e);
          const content = (await readText(p)) ?? '';
          const teammate = e.slice(task_id.length + 1, -'.jsonl'.length);
          const t = await statTimes(p);
          artifacts.push({
            team_id, task_id, teammate, kind: 'session', content,
            created_at: t.created, updated_at: t.updated,
          });
        }
      }
    } else {
      // No kind specified — gather everything under artifacts/<task_id>/ + sessions + bug.
      if (await pathExists(artDir)) {
        const entries = await fs.readdir(artDir);
        for (const e of entries) {
          const p = path.join(artDir, e);
          const st = await fs.stat(p).catch(() => null);
          if (!st || !st.isFile()) continue;
          const content = (await readText(p)) ?? '';
          artifacts.push({
            team_id, task_id,
            kind: kindFromFilename(e),
            content,
            created_at: (st.birthtime ?? st.mtime).toISOString(),
            updated_at: st.mtime.toISOString(),
          });
        }
      }
      // Sessions
      const sessionsDir = path.join(teamDir, 'sessions');
      if (await pathExists(sessionsDir)) {
        const entries = await fs.readdir(sessionsDir);
        for (const e of entries) {
          if (!e.startsWith(`${task_id}-`) || !e.endsWith('.jsonl')) continue;
          const p = path.join(sessionsDir, e);
          const content = (await readText(p)) ?? '';
          const teammate = e.slice(task_id.length + 1, -'.jsonl'.length);
          const t = await statTimes(p);
          artifacts.push({
            team_id, task_id, teammate, kind: 'session', content,
            created_at: t.created, updated_at: t.updated,
          });
        }
      }
      // Bug
      const bugP = this.bugPath(teamDir, task_id);
      const bugContent = await readText(bugP);
      if (bugContent !== null) {
        const t = await statTimes(bugP);
        artifacts.push({
          team_id, task_id, kind: 'bug', content: bugContent,
          created_at: t.created, updated_at: t.updated,
        });
      }
    }

    // Peek registry for teammate/task_type/status if available.
    const reg = await this.getRegistry(team_id);
    const teammateEntry = reg?.teammates.find((t) => t.agent_id === task_id);

    return {
      team_id,
      task_id,
      teammate: teammateEntry?.name ?? null,
      task_type: teammateEntry?.task_type ?? null,
      status: teammateEntry?.status ?? null,
      artifacts,
      completed_at: teammateEntry?.completed_at ?? null,
    };
  }

  async recent(team_id: string, n: number = 5): Promise<LedgerTaskView[]> {
    const reg = await this.getRegistry(team_id);
    if (!reg) return [];
    const done = reg.teammates
      .filter((t) => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => {
        const at = a.completed_at ?? a.started_at;
        const bt = b.completed_at ?? b.started_at;
        return new Date(bt).getTime() - new Date(at).getTime();
      })
      .slice(0, n);

    const views: LedgerTaskView[] = [];
    for (const t of done) {
      views.push(await this.read(team_id, t.agent_id));
    }
    return views;
  }

  async search(
    team_id: string,
    query: string,
    limit: number = 50
  ): Promise<LedgerSearchHit[]> {
    const teamDir = await this.teamDir(team_id);
    const needle = query.toLowerCase();
    const hits: LedgerSearchHit[] = [];

    const scanFile = async (p: string, kind: ArtifactKind, task_id: string, teammate: string | null) => {
      const content = await readText(p);
      if (content === null) return;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            team_id, task_id, teammate, kind,
            line_number: i + 1,
            line: lines[i].slice(0, 500),
            path: p,
          });
          if (hits.length >= limit) return;
        }
      }
    };

    // Sessions
    const sessionsDir = path.join(teamDir, 'sessions');
    if (await pathExists(sessionsDir)) {
      for (const e of await fs.readdir(sessionsDir)) {
        if (hits.length >= limit) break;
        if (!e.endsWith('.jsonl')) continue;
        const dash = e.lastIndexOf('-');
        const task_id = dash > 0 ? e.slice(0, dash) : e.replace('.jsonl', '');
        const teammate = dash > 0 ? e.slice(dash + 1, -'.jsonl'.length) : null;
        await scanFile(path.join(sessionsDir, e), 'session', task_id, teammate);
      }
    }

    // Artifacts (notes.md in particular, but also diffs/test-output)
    const artifactsRoot = path.join(teamDir, 'artifacts');
    if (await pathExists(artifactsRoot)) {
      for (const task_id of await fs.readdir(artifactsRoot)) {
        if (hits.length >= limit) break;
        const sub = path.join(artifactsRoot, task_id);
        const st = await fs.stat(sub).catch(() => null);
        if (!st?.isDirectory()) continue;
        for (const f of await fs.readdir(sub)) {
          if (hits.length >= limit) break;
          await scanFile(path.join(sub, f), kindFromFilename(f), task_id, null);
        }
      }
    }

    // Bugs
    const bugsDir = path.join(teamDir, 'bugs');
    if (await pathExists(bugsDir)) {
      for (const e of await fs.readdir(bugsDir)) {
        if (hits.length >= limit) break;
        if (!e.endsWith('.md')) continue;
        const task_id = e.slice(0, -'.md'.length);
        await scanFile(path.join(bugsDir, e), 'bug', task_id, null);
      }
    }

    // Narrative
    if (hits.length < limit) {
      await scanFile(path.join(teamDir, 'team.md'), 'narrative', '_team', null);
    }

    return hits.slice(0, limit);
  }
}
