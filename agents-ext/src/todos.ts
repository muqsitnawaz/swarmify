export interface TodoItem {
  title: string;
  description?: string;
  completed: boolean;
  line: number;
}

export interface TodoFile {
  path: string;
  items: TodoItem[];
}

const CHECKBOX_REGEX = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s*(.*)$/;

export function parseTodoMd(content: string): TodoItem[] {
  const lines = content.split(/\r?\n/);
  const items: TodoItem[] = [];
  let current: TodoItem | null = null;
  let descriptionLines: string[] = [];

  const flush = () => {
    if (!current) return;
    const description = descriptionLines.join('\n').trim();
    if (description) current.description = description;
    items.push(current);
    current = null;
    descriptionLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(CHECKBOX_REGEX);
    if (match) {
      flush();
      const completed = match[1].toLowerCase() === 'x';
      const title = (match[2] || '').trim();
      current = {
        title,
        completed,
        line: i + 1
      };
      continue;
    }

    if (!current) continue;

    const trimmed = line.trim();
    if (!trimmed) {
      if (descriptionLines.length > 0) descriptionLines.push('');
      continue;
    }

    if (/^\s{2,}|\t/.test(line)) {
      descriptionLines.push(trimmed);
    }
  }

  flush();
  return items;
}
