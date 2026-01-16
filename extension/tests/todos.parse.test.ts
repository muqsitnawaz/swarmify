import { describe, expect, test } from 'bun:test';
import { parseTodoMd } from '../src/core/todos';

describe('parseTodoMd', () => {
  test('parses checkbox tasks with completion states and descriptions', () => {
    const content = `
- [ ] Open task
  Indented description line
- [x] Done task
    another line
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Open task',
      completed: false,
      description: 'Indented description line',
      line: 2
    });
    expect(items[1]).toMatchObject({
      title: 'Done task',
      completed: true,
      description: 'another line',
      line: 4
    });
  });

  test('parses H2/H3/paragraph tasks separated by dividers like TODO.md', () => {
    const content = `
## Todo

## First task title
### Subtitle for first
Initial research: something here
Another line.

---

## Second task
### Short desc
Body text line one.
Body line two.
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      title: 'First task title',
      completed: false,
      line: 4
    });
    expect(items[0].description).toBe(`Subtitle for first
Initial research: something here
Another line.`);

    expect(items[1]).toMatchObject({
      title: 'Second task',
      completed: false,
      line: 11
    });
    expect(items[1].description).toBe(`Short desc
Body text line one.
Body line two.`);
  });
});
