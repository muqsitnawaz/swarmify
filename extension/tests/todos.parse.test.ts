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

  test('extracts plan file links from description', () => {
    const content = `
- [ ] Implement auth feature
  This task requires careful planning.
  Plan: ./plans/auth-feature.md
  Additional notes here.
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Implement auth feature',
      completed: false,
      planFile: './plans/auth-feature.md',
      line: 2
    });
    // Plan line should be removed from description
    expect(items[0].description).toBe(`This task requires careful planning.
Additional notes here.`);
  });

  test('extracts absolute plan file paths', () => {
    const content = `
## Build CI pipeline
Plan: /Users/dev/.claude/plans/ci-pipeline.md
Setup the pipeline.
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(1);
    expect(items[0].planFile).toBe('/Users/dev/.claude/plans/ci-pipeline.md');
    expect(items[0].description).toBe('Setup the pipeline.');
  });

  test('handles plan: prefix case-insensitively', () => {
    const content = `
- [ ] Task one
  PLAN: ./uppercase.md
- [ ] Task two
  plan: ./lowercase.md
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(2);
    expect(items[0].planFile).toBe('./uppercase.md');
    expect(items[1].planFile).toBe('./lowercase.md');
  });

  test('task without plan file has undefined planFile', () => {
    const content = `
- [ ] Simple task
  Just a description, no plan.
`;

    const items = parseTodoMd(content);
    expect(items).toHaveLength(1);
    expect(items[0].planFile).toBeUndefined();
  });
});
