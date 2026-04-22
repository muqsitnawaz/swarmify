// VS Code integration for unified task management
// Aggregates tasks from Linear + GitHub.

import * as vscode from 'vscode';
import { TaskSource, TaskSourceSettings } from '../core/settings';
import { UnifiedTask, CycleInfo, groupTasksBySource } from '../core/tasks';
import { fetchLinearTasks, isLinearAvailable } from './linear.vscode';
import { fetchGitHubTasks, isGitHubAvailable } from './github.vscode';

export interface TaskFetchResult {
  tasks: UnifiedTask[];
  cycleInfo: CycleInfo | null;
}

// Detect which task sources are available based on MCP configuration
export async function detectAvailableSources(context: vscode.ExtensionContext): Promise<{
  linear: boolean;
  github: boolean;
}> {
  const [linear, github] = await Promise.all([
    isLinearAvailable(context),
    isGitHubAvailable(context)
  ]);

  return { linear, github };
}

// Fetch tasks from all enabled sources
export async function fetchAllTasks(
  context: vscode.ExtensionContext,
  enabledSources: TaskSourceSettings
): Promise<TaskFetchResult> {
  const tasks: UnifiedTask[] = [];
  let cycleInfo: CycleInfo | null = null;
  const fetchPromises: Promise<void>[] = [];

  // Fetch Linear tasks
  if (enabledSources.linear) {
    fetchPromises.push(
      fetchLinearTasks(context).then(result => {
        tasks.push(...result.tasks);
        if (result.cycleInfo) cycleInfo = result.cycleInfo;
      }).catch(err => {
        console.error('[TASKS] Error fetching Linear tasks:', err);
      })
    );
  }

  // Fetch GitHub tasks
  if (enabledSources.github) {
    fetchPromises.push(
      fetchGitHubTasks(context).then(ghTasks => {
        tasks.push(...ghTasks);
      }).catch(err => {
        console.error('[TASKS] Error fetching GitHub tasks:', err);
      })
    );
  }

  await Promise.all(fetchPromises);

  return { tasks, cycleInfo };
}

// Get tasks grouped by source for UI display
export async function fetchTasksGrouped(
  context: vscode.ExtensionContext,
  enabledSources: TaskSourceSettings
): Promise<Map<TaskSource, UnifiedTask[]>> {
  const { tasks } = await fetchAllTasks(context, enabledSources);
  return groupTasksBySource(tasks);
}

// Auto-enable sources that are available but not yet configured
export async function autoEnableSources(
  context: vscode.ExtensionContext,
  currentSettings: TaskSourceSettings
): Promise<TaskSourceSettings> {
  const available = await detectAvailableSources(context);
  const updated = { ...currentSettings };

  // Auto-enable Linear if available and not explicitly disabled
  if (available.linear && !currentSettings.linear) {
    updated.linear = true;
  }

  // Auto-enable GitHub if available and not explicitly disabled
  if (available.github && !currentSettings.github) {
    updated.github = true;
  }

  return updated;
}
