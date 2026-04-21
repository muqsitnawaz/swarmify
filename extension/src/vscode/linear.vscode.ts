import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { UnifiedTask, CycleInfo, linearToUnifiedTask } from '../core/tasks';

const execFileAsync = promisify(execFile);

const LINEAR_SCRIPT = path.join(
  process.env.HOME || '',
  '.agents/skills/linear/scripts/linear'
);
const LINEAR_CONFIG = path.join(
  process.env.HOME || '',
  '.agents/linear.json'
);

export async function isLinearAvailable(_context: vscode.ExtensionContext): Promise<boolean> {
  try {
    await fs.promises.access(LINEAR_SCRIPT, fs.constants.X_OK);
    await fs.promises.access(LINEAR_CONFIG, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export interface LinearFetchResult {
  tasks: UnifiedTask[];
  cycleInfo: CycleInfo | null;
}

export async function fetchLinearTasks(context: vscode.ExtensionContext): Promise<LinearFetchResult> {
  if (!(await isLinearAvailable(context))) return { tasks: [], cycleInfo: null };

  try {
    const { stdout } = await execFileAsync(LINEAR_SCRIPT, ['tasks', '--json'], {
      timeout: 15000,
    });

    const data = JSON.parse(stdout);
    const issues: any[] = data.issues || [];
    const cycle = data.cycle || null;

    const cycleInfo: CycleInfo | null = cycle && cycle.startsAt && cycle.endsAt
      ? { name: cycle.name, startsAt: cycle.startsAt, endsAt: cycle.endsAt }
      : null;

    const tasks = issues.map(issue => linearToUnifiedTask({
      id: issue.identifier,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      priority: issue.priority,
      url: issue.url || `https://linear.app/issue/${issue.identifier}`,
      labels: issue.labels,
      assignee: issue.assignee,
      createdAt: issue.createdAt,
    }));

    return { tasks, cycleInfo };
  } catch (err) {
    console.error('[LINEAR] Error fetching tasks:', err);
    return { tasks: [], cycleInfo: null };
  }
}

export async function saveLinearApiKey(key: string): Promise<void> {
  let config: Record<string, any> = {};
  try {
    const raw = await fs.promises.readFile(LINEAR_CONFIG, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // No existing config
  }
  config.apiKey = key;
  await fs.promises.mkdir(path.dirname(LINEAR_CONFIG), { recursive: true });
  await fs.promises.writeFile(LINEAR_CONFIG, JSON.stringify(config, null, 2));
}

export function clearLinearCache(): void {
  // No cache to clear with CLI approach
}
