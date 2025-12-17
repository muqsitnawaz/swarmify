import { AgentType } from './parsers.js';

function extractErrorFromRawEvents(events: any[], maxChars: number = 500): string | null {
  const errorKeywords = ['error', 'Error', 'ERROR', 'failed', 'Failed', 'FAILED', 'exception', 'Exception'];

  for (let i = events.length - 1; i >= Math.max(0, events.length - 20); i--) {
    const event = events[i];
    if (event.type === 'raw') {
      const content = event.content || '';
      if (typeof content === 'string') {
        const contentLower = content.toLowerCase();
        if (errorKeywords.some(keyword => contentLower.includes(keyword.toLowerCase()))) {
          let errorMsg = content.trim();
          if (errorMsg.length > maxChars) {
            errorMsg = errorMsg.substring(0, maxChars - 3) + '...';
          }
          return errorMsg;
        }
      }
    }
  }
  return null;
}

function extractFileOpsFromBash(command: string): [string[], string[]] {
  const filesRead: string[] = [];
  const filesWritten: string[] = [];

  let unwrappedCommand = command;
  const shellWrapperMatch = command.match(/-[lc]+\s+["'](.+)["']$/);
  if (shellWrapperMatch) {
    unwrappedCommand = shellWrapperMatch[1];
  }

  const writePatterns = [
    /(?:cat|echo|printf)\s+.*?>\s*["']?([^\s"'|;&]+)/,
    /tee\s+(?:-a\s+)?["']?([^\s"'|;&]+)/,
    /sed\s+-i[^\s]*\s+.*?["']?([^\s"']+)$/,
  ];

  for (const pattern of writePatterns) {
    const matches = unwrappedCommand.matchAll(new RegExp(pattern, 'g'));
    for (const match of matches) {
      const path = match[1];
      if (path && !path.startsWith('-')) {
        filesWritten.push(path);
      }
    }
  }

  const readPatterns = [
    /sed\s+-n\s+["'][^"']+["']\s+["']?([^\s"'|;&>]+)/,
    /(?:head|tail)\s+(?:-\w+\s+)*(?:\d+\s+)?([^\s"'|;&-][^\s"'|;&]*)/,
  ];

  for (const pattern of readPatterns) {
    const matches = unwrappedCommand.matchAll(new RegExp(pattern, 'g'));
    for (const match of matches) {
      const path = match[1];
      if (path && !path.startsWith('-')) {
        filesRead.push(path);
      }
    }
  }

  return [filesRead, filesWritten];
}

export const PRIORITY: Record<string, string[]> = {
  critical: [
    'error',
    'result',
    'file_write',
    'file_delete',
    'file_create',
  ],
  important: [
    'tool_use',
    'bash',
    'file_read',
    'thinking',
    'message',
  ],
  verbose: [
    'thinking_delta',
    'message_delta',
    'init',
    'turn_start',
    'user_message',
    'raw',
  ],
};

export class AgentSummary {
  agentId: string;
  agentType: string;
  status: string;
  duration: string | null = null;

  filesModified: Set<string> = new Set();
  filesCreated: Set<string> = new Set();
  filesRead: Set<string> = new Set();
  filesDeleted: Set<string> = new Set();

  toolsUsed: Set<string> = new Set();
  toolCallCount: number = 0;
  bashCommands: string[] = [];

  errors: string[] = [];
  warnings: string[] = [];
  finalMessage: string | null = null;

  eventCount: number = 0;
  lastActivity: string | null = null;

  eventsCache: any[] = [];

  constructor(
    agentId: string,
    agentType: string,
    status: string,
    duration: string | null = null,
    eventCount: number = 0
  ) {
    this.agentId = agentId;
    this.agentType = agentType;
    this.status = status;
    this.duration = duration;
    this.eventCount = eventCount;
  }

  toDict(detailLevel: 'brief' | 'standard' | 'detailed' = 'standard'): any {
    const base: any = {
      agent_id: this.agentId,
      agent_type: this.agentType,
      status: this.status,
    };

    if (detailLevel === 'brief') {
      return {
        ...base,
        duration: this.duration,
        tool_call_count: this.toolCallCount,
        last_activity: this.lastActivity,
        files_modified: Array.from(this.filesModified).slice(0, 5),
        files_created: Array.from(this.filesCreated).slice(0, 5),
        has_errors: this.errors.length > 0,
      };
    } else if (detailLevel === 'standard') {
      return {
        ...base,
        duration: this.duration,
        files_modified: Array.from(this.filesModified),
        files_created: Array.from(this.filesCreated),
        tools_used: Array.from(this.toolsUsed),
        tool_call_count: this.toolCallCount,
        errors: this.errors.slice(0, 3),
        final_message: this.truncate(this.finalMessage, 2000),
      };
    } else {
      return {
        ...base,
        duration: this.duration,
        files_modified: Array.from(this.filesModified),
        files_created: Array.from(this.filesCreated),
        files_read: Array.from(this.filesRead),
        files_deleted: Array.from(this.filesDeleted),
        tools_used: Array.from(this.toolsUsed),
        tool_call_count: this.toolCallCount,
        bash_commands: this.bashCommands.slice(-10),
        errors: this.errors,
        warnings: this.warnings,
        final_message: this.finalMessage,
        event_count: this.eventCount,
        last_activity: this.lastActivity,
      };
    }
  }

  private truncate(text: string | null, maxLen: number): string | null {
    if (!text) return null;
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  }
}

export function summarizeEvents(
  agentId: string,
  agentType: string,
  status: string,
  events: any[],
  duration: string | null = null
): AgentSummary {
  const summary = new AgentSummary(agentId, agentType, status, duration, events.length);
  summary.eventsCache = events;
  summary.agentId = agentId;
  summary.agentType = agentType;
  summary.status = status;

  for (const event of events) {
    const eventType = event.type || 'unknown';
    summary.lastActivity = eventType;

    if (eventType === 'file_write') {
      const path = event.path || '';
      if (path) {
        summary.filesModified.add(path);
        summary.toolCallCount++;
      }
    } else if (eventType === 'file_create') {
      const path = event.path || '';
      if (path) {
        summary.filesCreated.add(path);
        summary.toolCallCount++;
      }
    } else if (eventType === 'file_read') {
      const path = event.path || '';
      if (path) {
        summary.filesRead.add(path);
        summary.toolCallCount++;
      }
    } else if (eventType === 'file_delete') {
      const path = event.path || '';
      if (path) {
        summary.filesDeleted.add(path);
        summary.toolCallCount++;
      }
    } else if (eventType === 'tool_use') {
      const tool = event.tool || 'unknown';
      summary.toolsUsed.add(tool);
      summary.toolCallCount++;
    } else if (eventType === 'bash') {
      const command = event.command || '';
      summary.toolsUsed.add('bash');
      if (command) {
        summary.bashCommands.push(command);
        const [filesRead, filesWritten] = extractFileOpsFromBash(command);
        for (const path of filesRead) {
          summary.filesRead.add(path);
        }
        for (const path of filesWritten) {
          summary.filesModified.add(path);
        }
      }
      summary.toolCallCount++;
    } else if (eventType === 'message') {
      const content = event.content || '';
      if (content) {
        summary.finalMessage = content;
      }
    } else if (eventType === 'error') {
      let errorMsg: string | null = null;
      for (const key of ['message', 'content', 'error', 'error_message', 'details']) {
        if (event[key]) {
          errorMsg = String(event[key]);
          break;
        }
      }

      if (!errorMsg) {
        errorMsg = extractErrorFromRawEvents(summary.eventsCache);
      }

      if (errorMsg) {
        if (errorMsg.length > 500) {
          errorMsg = errorMsg.substring(0, 497) + '...';
        }
        summary.errors.push(errorMsg);
      }
    } else if (eventType === 'warning') {
      const warningMsg = event.message || event.content || '';
      if (warningMsg) {
        summary.warnings.push(warningMsg);
      }
    } else if (eventType === 'result') {
      if (event.status === 'error') {
        let errorMsg: string | null = null;
        for (const key of ['message', 'error', 'error_message', 'error_details', 'details']) {
          if (event[key]) {
            errorMsg = String(event[key]);
            break;
          }
        }

        if (!errorMsg) {
          errorMsg = extractErrorFromRawEvents(summary.eventsCache);
        }

        if (errorMsg) {
          if (errorMsg.length > 500) {
            errorMsg = errorMsg.substring(0, 497) + '...';
          }
          summary.errors.push(errorMsg);
        }
      }
      if (!summary.duration && event.duration_ms) {
        const durationMs = event.duration_ms;
        const seconds = durationMs / 1000;
        if (seconds < 60) {
          if (seconds % 1 === 0) {
            summary.duration = `${Math.floor(seconds)} seconds`;
          } else {
            summary.duration = `${seconds.toFixed(1)} seconds`;
          }
        } else {
          const minutes = seconds / 60;
          summary.duration = `${minutes.toFixed(1)} minutes`;
        }
      }
    }
  }

  return summary;
}

export function getDelta(
  agentId: string,
  agentType: string,
  status: string,
  events: any[],
  sinceEvent: number = 0
): any {
  const newEvents = events.slice(sinceEvent);
  if (newEvents.length === 0) {
    return {
      agent_id: agentId,
      status: status,
      since_event: sinceEvent,
      new_events_count: 0,
      has_changes: false,
    };
  }

  const summary = summarizeEvents(agentId, agentType, status, newEvents);

  return {
    agent_id: agentId,
    agent_type: agentType,
    status: status,
    since_event: sinceEvent,
    new_events_count: newEvents.length,
    current_event_count: sinceEvent + newEvents.length,
    has_changes: true,
    new_files_modified: Array.from(summary.filesModified),
    new_files_created: Array.from(summary.filesCreated),
    new_tool_calls: newEvents
      .filter((e: any) => ['tool_use', 'bash', 'file_write'].includes(e.type))
      .slice(-5)
      .map((e: any) => `${e.tool || 'unknown'}: ${e.command || e.path || ''}`),
    latest_message: summary.finalMessage,
    new_errors: summary.errors,
  };
}

export function filterEventsByPriority(
  events: any[],
  includeLevels: string[] | null = null
): any[] {
  if (!includeLevels) {
    includeLevels = ['critical', 'important'];
  }

  const allowedTypes = new Set<string>();
  for (const level of includeLevels) {
    const types = PRIORITY[level] || [];
    for (const type of types) {
      allowedTypes.add(type);
    }
  }

  return events.filter(e => allowedTypes.has(e.type));
}

export function getLastTool(events: any[]): string | null {
  if (events.length === 0) return null;

  const lastEvent = events[events.length - 1];
  const eventType = lastEvent.type || '';

  const validTypes = ['tool_use', 'bash', 'file_write', 'file_create', 'file_read', 'file_delete', 'message', 'error', 'result'];
  if (validTypes.includes(eventType)) {
    return eventType;
  }

  return null;
}

export interface QuickStatus {
  agent_id: string;
  agent_type: string;
  status: string;
  files_created: number;
  files_modified: number;
  tool_count: number;
  last_commands: string[];
  has_errors: boolean;
}

export function getQuickStatus(
  agentId: string,
  agentType: string,
  status: string,
  events: any[]
): QuickStatus {
  let filesCreated = 0;
  let filesModified = 0;
  let toolCount = 0;
  let hasErrors = false;
  const commands: string[] = [];

  for (const event of events) {
    const eventType = event.type || '';

    if (eventType === 'file_create') {
      filesCreated++;
      toolCount++;
    } else if (eventType === 'file_write') {
      filesModified++;
      toolCount++;
    } else if (eventType === 'bash') {
      toolCount++;
      const cmd = event.command || '';
      if (cmd) {
        commands.push(cmd.length > 100 ? cmd.substring(0, 97) + '...' : cmd);
      }
    } else if (['tool_use', 'file_read', 'file_delete'].includes(eventType)) {
      toolCount++;
    } else if (eventType === 'error' || (eventType === 'result' && event.status === 'error')) {
      hasErrors = true;
    }
  }

  return {
    agent_id: agentId,
    agent_type: agentType,
    status: status,
    files_created: filesCreated,
    files_modified: filesModified,
    tool_count: toolCount,
    last_commands: commands.slice(-3),
    has_errors: hasErrors,
  };
}

export function getStatusSummary(
  agentId: string,
  agentType: string,
  status: string,
  events: any[],
  duration: string | null = null
): string {
  if (events.length === 0) {
    if (status === 'running') {
      return 'Just started, no activity yet';
    }
    return 'No activity';
  }

  let fileCount = 0;
  let bashCount = 0;
  let toolCount = 0;
  let hasErrors = false;

  for (const event of events) {
    const eventType = event.type || '';

    if (['file_write', 'file_create', 'file_delete'].includes(eventType)) {
      fileCount++;
    } else if (eventType === 'bash') {
      bashCount++;
    } else if (['tool_use', 'file_read'].includes(eventType)) {
      toolCount++;
    } else if (['error', 'result'].includes(eventType)) {
      if (event.status === 'error') {
        hasErrors = true;
      }
    }
  }

  const totalTools = bashCount + toolCount;
  const parts: string[] = [];

  if (status === 'running') {
    parts.push('Running');
  } else if (status === 'completed') {
    if (hasErrors) {
      parts.push('Completed with errors');
    } else {
      parts.push('Completed successfully');
    }
  } else if (status === 'failed') {
    parts.push('Failed');
  } else if (status === 'stopped') {
    parts.push('Stopped');
  }

  if (fileCount > 0) {
    parts.push(`modified ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
  }

  if (bashCount > 0) {
    parts.push(`used bash ${bashCount} time${bashCount !== 1 ? 's' : ''}`);
  }

  if (toolCount > 0 && bashCount === 0) {
    parts.push(`used ${toolCount} tool${toolCount !== 1 ? 's' : ''}`);
  }

  if (totalTools > 0 && bashCount > 0) {
    parts.push(`used ${totalTools} tool${totalTools !== 1 ? 's' : ''}`);
  }

  if (hasErrors && status === 'running') {
    parts.push('has errors');
  }

  if (parts.length === 0) {
    if (status === 'running') {
      return `Running, ${events.length} event${events.length !== 1 ? 's' : ''} so far`;
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  return parts.join(', ');
}
