export type AgentType = 'codex' | 'gemini' | 'cursor' | 'claude';

export function normalizeEvents(agentType: AgentType, raw: any): any[] {
  if (agentType === 'codex') {
    return normalizeCodex(raw);
  } else if (agentType === 'cursor') {
    return normalizeCursor(raw);
  } else if (agentType === 'gemini') {
    return normalizeGemini(raw);
  } else if (agentType === 'claude') {
    return normalizeClaude(raw);
  }

  const timestamp = new Date().toISOString();
  return [{
    type: raw.type || 'unknown',
    agent: agentType,
    raw: raw,
    timestamp: timestamp,
  }];
}

export function normalizeEvent(agentType: AgentType, raw: any): any {
  const events = normalizeEvents(agentType, raw);
  if (events.length > 0) {
    return events[0];
  }

  return {
    type: raw.type || 'unknown',
    agent: agentType,
    raw: raw,
    timestamp: new Date().toISOString(),
  };
}

function normalizeCodex(raw: any): any[] {
  const eventType = raw.type || 'unknown';
  const timestamp = new Date().toISOString();

  if (eventType === 'thread.started') {
    return [{
      type: 'init',
      agent: 'codex',
      session_id: raw.thread_id,
      timestamp: timestamp,
    }];
  } else if (eventType === 'turn.started') {
    return [{
      type: 'turn_start',
      agent: 'codex',
      timestamp: timestamp,
    }];
  } else if (eventType === 'item.completed') {
    const item = raw.item || {};
    const itemType = item.type;

    if (itemType === 'agent_message') {
      return [{
        type: 'message',
        agent: 'codex',
        content: item.text || '',
        complete: true,
        timestamp: timestamp,
      }];
    } else if (itemType === 'command_execution') {
      const command = item.command || '';
      return [{
        type: 'bash',
        agent: 'codex',
        tool: 'command_execution',
        command: command,
        timestamp: timestamp,
      }];
    } else if (itemType === 'tool_call') {
      const toolName = item.name || 'unknown';
      const toolArgs = item.arguments || {};

      if (toolName === 'write_file' || toolName === 'create_file' || toolName === 'edit_file') {
        return [{
          type: 'file_write',
          agent: 'codex',
          tool: toolName,
          path: toolArgs.path || toolArgs.file_path || '',
          timestamp: timestamp,
        }];
      } else if (toolName === 'read_file') {
        return [{
          type: 'file_read',
          agent: 'codex',
          tool: toolName,
          path: toolArgs.path || toolArgs.file_path || '',
          timestamp: timestamp,
        }];
      } else if (toolName === 'shell' || toolName === 'bash' || toolName === 'execute') {
        return [{
          type: 'bash',
          agent: 'codex',
          tool: toolName,
          command: toolArgs.command || '',
          timestamp: timestamp,
        }];
      } else {
        return [{
          type: 'tool_use',
          agent: 'codex',
          tool: toolName,
          args: toolArgs,
          timestamp: timestamp,
        }];
      }
    }
  } else if (eventType === 'turn.completed') {
    const usage = raw.usage || {};
    return [{
      type: 'result',
      agent: 'codex',
      status: 'success',
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
      },
      timestamp: timestamp,
    }];
  }

  return [{
    type: eventType,
    agent: 'codex',
    raw: raw,
    timestamp: timestamp,
  }];
}

function normalizeCursor(raw: any): any[] {
  const eventType = raw.type || 'unknown';
  const subtype = raw.subtype;
  const timestamp = new Date().toISOString();

  if (eventType === 'system' && subtype === 'init') {
    return [{
      type: 'init',
      agent: 'cursor',
      model: raw.model,
      session_id: raw.session_id,
      timestamp: timestamp,
    }];
  } else if (eventType === 'thinking') {
    return [{
      type: 'thinking',
      agent: 'cursor',
      content: raw.text || '',
      complete: subtype === 'completed',
      timestamp: timestamp,
    }];
  } else if (eventType === 'assistant') {
    const message = raw.message || {};
    const contentBlocks = message.content || [];
    const events: any[] = [];
    let textContent = '';

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool_use',
          agent: 'cursor',
          tool: block.name || 'unknown',
          args: block.input || {},
          timestamp: timestamp,
        });
      }
    }

    if (textContent) {
      events.push({
        type: 'message',
        agent: 'cursor',
        content: textContent,
        complete: true,
        timestamp: timestamp,
      });
    }

    if (events.length === 0) {
      events.push({
        type: 'message',
        agent: 'cursor',
        content: '',
        complete: true,
        timestamp: timestamp,
      });
    }

    return events;
  } else if (eventType === 'result') {
    return [{
      type: 'result',
      agent: 'cursor',
      status: subtype || 'success',
      duration_ms: raw.duration_ms,
      timestamp: timestamp,
    }];
  } else if (eventType === 'tool_result') {
    return [{
      type: 'tool_result',
      agent: 'cursor',
      tool: raw.tool_name || 'unknown',
      success: raw.success !== false,
      timestamp: timestamp,
    }];
  } else if (eventType === 'tool_call' && subtype === 'completed') {
    const toolCall = raw.tool_call;

    if (toolCall?.shellToolCall) {
      const command = toolCall.shellToolCall.args?.command || '';
      return [{
        type: 'bash',
        agent: 'cursor',
        tool: 'shell',
        command: command,
        timestamp: timestamp,
      }];
    } else if (toolCall?.editToolCall) {
      const filePath = toolCall.editToolCall.args?.path || '';
      return [{
        type: 'file_write',
        agent: 'cursor',
        tool: 'edit',
        path: filePath,
        timestamp: timestamp,
      }];
    } else if (toolCall?.readToolCall) {
      const filePath = toolCall.readToolCall.args?.path || '';
      return [{
        type: 'file_read',
        agent: 'cursor',
        tool: 'read',
        path: filePath,
        timestamp: timestamp,
      }];
    }

    return [{
      type: 'tool_use',
      agent: 'cursor',
      tool: Object.keys(toolCall || {})[0] || 'unknown',
      timestamp: timestamp,
    }];
  }

  return [{
    type: eventType,
    agent: 'cursor',
    raw: raw,
    timestamp: timestamp,
  }];
}

function normalizeGemini(raw: any): any[] {
  const eventType = raw.type || 'unknown';
  const timestamp = raw.timestamp || new Date().toISOString();

  if (eventType === 'init') {
    return [{
      type: 'init',
      agent: 'gemini',
      model: raw.model,
      session_id: raw.session_id,
      timestamp: timestamp,
    }];
  } else if (eventType === 'message') {
    const role = raw.role || 'assistant';
    if (role === 'assistant') {
      return [{
        type: 'message',
        agent: 'gemini',
        content: raw.content || '',
        complete: !raw.delta,
        timestamp: timestamp,
      }];
    } else {
      return [{
        type: 'user_message',
        agent: 'gemini',
        content: raw.content || '',
        timestamp: timestamp,
      }];
    }
  } else if (eventType === 'tool_call' || eventType === 'tool_use') {
    const toolNameRaw = raw.tool_name || raw.name || 'unknown';
    const toolName = String(toolNameRaw);

    let toolArgsRaw = raw.parameters;
    if (toolArgsRaw === null || toolArgsRaw === undefined) {
      toolArgsRaw = raw.args;
    }
    const toolArgs = (typeof toolArgsRaw === 'object' && toolArgsRaw !== null) ? toolArgsRaw : {};
    const toolNameLower = toolName.toLowerCase();

    const filePath = toolArgs.file_path || toolArgs.path || '';

    if (toolNameLower.includes('write') && toolNameLower.includes('file')) {
      return [{
        type: 'file_write',
        agent: 'gemini',
        tool: toolName,
        path: filePath,
        timestamp: timestamp,
      }];
    } else if (toolNameLower.includes('read') && toolNameLower.includes('file')) {
      return [{
        type: 'file_read',
        agent: 'gemini',
        tool: toolName,
        path: filePath,
        timestamp: timestamp,
      }];
    } else if (['shell', 'bash', 'execute', 'run_command'].includes(toolNameLower)) {
      return [{
        type: 'bash',
        agent: 'gemini',
        tool: toolName,
        command: toolArgs.command || '',
        timestamp: timestamp,
      }];
    }

    return [{
      type: 'tool_use',
      agent: 'gemini',
      tool: toolName,
      args: toolArgs,
      timestamp: timestamp,
    }];
  } else if (eventType === 'result') {
    const stats = raw.stats || {};
    return [{
      type: 'result',
      agent: 'gemini',
      status: raw.status || 'success',
      duration_ms: stats.duration_ms,
      usage: {
        total_tokens: stats.total_tokens || 0,
      },
      timestamp: timestamp,
    }];
  }

  return [{
    type: eventType,
    agent: 'gemini',
    raw: raw,
    timestamp: timestamp,
  }];
}

function normalizeClaude(raw: any): any[] {
  const events = normalizeCursor(raw);
  for (const event of events) {
    event.agent = 'claude';
  }
  return events;
}

export function parseEvent(agentType: AgentType, line: string): any[] | null {
  try {
    const raw = JSON.parse(line);
    return normalizeEvents(agentType, raw);
  } catch {
    return null;
  }
}
