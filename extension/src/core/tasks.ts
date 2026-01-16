// Pure types for unified task management across multiple sources
// No VS Code dependencies - testable

import { TaskSource } from './settings';

// Unified task interface for aggregating tasks from multiple sources
export interface UnifiedTask {
  id: string;                    // Unique identifier
  source: TaskSource;            // Where this task came from
  title: string;                 // Task title/summary
  description?: string;          // Optional description/body
  status: 'todo' | 'in_progress' | 'done';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  metadata: TaskMetadata;        // Source-specific data
}

// Source-specific metadata
export interface TaskMetadata {
  // Markdown source
  file?: string;                 // File path for markdown tasks
  line?: number;                 // Line number in file

  // Linear/GitHub source
  identifier?: string;           // Linear: PROJ-123, GitHub: #42
  url?: string;                  // Web URL to task
  labels?: string[];             // Labels/tags
  assignee?: string;             // Assigned user
  state?: string;                // Raw state from source
}

// Source badge display info
export const SOURCE_BADGES: Record<TaskSource, { label: string; color: string }> = {
  markdown: { label: 'MD', color: '#6366f1' },  // Indigo
  linear: { label: 'LN', color: '#5e6ad2' },    // Linear purple
  github: { label: 'GH', color: '#238636' }     // GitHub green
};

// Convert markdown todo item to UnifiedTask
export function markdownToUnifiedTask(
  item: {
    title: string;
    completed: boolean;
    description?: string;
    line: number;
  },
  filePath: string
): UnifiedTask {
  return {
    id: `md:${filePath}:${item.line}`,
    source: 'markdown',
    title: item.title,
    description: item.description,
    status: item.completed ? 'done' : 'todo',
    metadata: {
      file: filePath,
      line: item.line
    }
  };
}

// Convert Linear issue to UnifiedTask
export function linearToUnifiedTask(issue: {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string; type: string };
  priority: number;
  url: string;
  labels?: { nodes: { name: string }[] };
  assignee?: { name: string };
}): UnifiedTask {
  // Map Linear priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)
  const priorityMap: Record<number, UnifiedTask['priority']> = {
    1: 'urgent',
    2: 'high',
    3: 'medium',
    4: 'low'
  };

  // Map Linear state type to our status
  const statusMap: Record<string, UnifiedTask['status']> = {
    backlog: 'todo',
    unstarted: 'todo',
    started: 'in_progress',
    completed: 'done',
    canceled: 'done'
  };

  return {
    id: `linear:${issue.id}`,
    source: 'linear',
    title: issue.title,
    description: issue.description,
    status: statusMap[issue.state.type] || 'todo',
    priority: priorityMap[issue.priority],
    metadata: {
      identifier: issue.identifier,
      url: issue.url,
      labels: issue.labels?.nodes.map(l => l.name),
      assignee: issue.assignee?.name,
      state: issue.state.name
    }
  };
}

// Convert GitHub issue to UnifiedTask
export function githubToUnifiedTask(issue: {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url: string;
  labels?: { name: string }[];
  assignee?: { login: string };
}): UnifiedTask {
  return {
    id: `github:${issue.id}`,
    source: 'github',
    title: issue.title,
    description: issue.body,
    status: issue.state === 'closed' ? 'done' : 'todo',
    metadata: {
      identifier: `#${issue.number}`,
      url: issue.html_url,
      labels: issue.labels?.map(l => l.name),
      assignee: issue.assignee?.login,
      state: issue.state
    }
  };
}

// Group tasks by source
export function groupTasksBySource(tasks: UnifiedTask[]): Map<TaskSource, UnifiedTask[]> {
  const groups = new Map<TaskSource, UnifiedTask[]>();
  for (const task of tasks) {
    const existing = groups.get(task.source) || [];
    existing.push(task);
    groups.set(task.source, existing);
  }
  return groups;
}

// Filter tasks by status
export function filterTasksByStatus(
  tasks: UnifiedTask[],
  statuses: UnifiedTask['status'][]
): UnifiedTask[] {
  return tasks.filter(t => statuses.includes(t.status));
}
