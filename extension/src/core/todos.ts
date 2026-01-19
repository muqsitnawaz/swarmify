export interface TodoItem {
  title: string;
  description?: string;
  completed: boolean;
  line: number;
  planFile?: string;
}

export interface TodoFile {
  path: string;
  items: TodoItem[];
}

const CHECKBOX_REGEX = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s*(.*)$/;
const H2_REGEX = /^\s*##\s+(.*)$/;
const H3_REGEX = /^\s*###\s+(.*)$/;
const DIVIDER_REGEX = /^\s*-{3,}\s*$/;
// Match "Plan: ./path" or "Plan: /abs/path" or "plan: path" (case insensitive)
const PLAN_FILE_REGEX = /^plan:\s*(.+)$/i;

export function parseTodoMd(content: string): TodoItem[] {
  const lines = content.split(/\r?\n/);
  const items: TodoItem[] = [];
  let current: TodoItem | null = null;
  let descriptionLines: string[] = [];

  const flush = () => {
    if (!current) return;
    // Extract plan file from description lines
    const filteredLines: string[] = [];
    for (const descLine of descriptionLines) {
      const planMatch = descLine.match(PLAN_FILE_REGEX);
      if (planMatch) {
        current.planFile = planMatch[1].trim();
      } else {
        filteredLines.push(descLine);
      }
    }
    const description = filteredLines.join('\n').trim();
    if (description) current.description = description;
    items.push(current);
    current = null;
    descriptionLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Checkbox style: - [ ] Task title
    const checkbox = line.match(CHECKBOX_REGEX);
    if (checkbox) {
      flush();
      const completed = checkbox[1].toLowerCase() === 'x';
      const title = (checkbox[2] || '').trim();
      current = {
        title,
        completed,
        line: i + 1
      };
      continue;
    }

    // H2 style task headers: ## Task title
    const h2 = line.match(H2_REGEX);
    if (h2) {
      const title = (h2[1] || '').trim();
      // Skip the top-level "Todo" heading commonly used as the file title
      if (items.length === 0 && !current && title.toLowerCase() === 'todo') {
        continue;
      }
      flush();
      current = {
        title,
        completed: false,
        line: i + 1
      };
      continue;
    }

    // H3 subtitle captured as part of description when inside a task
    const h3 = line.match(H3_REGEX);
    if (h3 && current) {
      descriptionLines.push((h3[1] || '').trim());
      continue;
    }

    // Divider ends the current task block
    if (DIVIDER_REGEX.test(line)) {
      flush();
      continue;
    }

    if (!current) continue;

    const trimmed = line.trim();
    if (!trimmed) {
      if (descriptionLines.length > 0) descriptionLines.push('');
      continue;
    }

    // Plain paragraph lines belong to current task (indented or not)
    descriptionLines.push(trimmed);
  }

  flush();
  return items;
}
