import * as os from 'os';
import * as path from 'path';

export interface RalphConfig {
  ralphFile: string;
  disabled: boolean;
}

export function getRalphConfig(): RalphConfig {
  const ralphFile = process.env.AGENTS_MCP_RALPH_FILE || 'RALPH.md';
  const disabledStr = process.env.AGENTS_MCP_DISABLE_RALPH || 'false';
  const disabled = disabledStr === 'true' || disabledStr === '1';

  return {
    ralphFile,
    disabled,
  };
}

export function isDangerousPath(cwd: string): boolean {
  const dangerousPaths = [
    os.homedir(),
    '/',
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
  ];

  const normalizedCwd = path.resolve(cwd);

  for (const dangerousPath of dangerousPaths) {
    const normalizedDangerous = path.resolve(dangerousPath);
    if (normalizedCwd === normalizedDangerous || normalizedCwd.startsWith(normalizedDangerous + path.sep)) {
      return true;
    }
  }

  return false;
}

export function buildRalphPrompt(userPrompt: string, ralphFilePath: string): string {
  return `${userPrompt}

RALPH MODE INSTRUCTIONS:

You are running in autonomous Ralph mode. Your mission:

1. READ THE TASK FILE: Open ${ralphFilePath} and read all tasks
2. UNDERSTAND THE SYSTEM: Read AGENTS.md, README.md, or grep for relevant context to understand the codebase
3. PICK TASKS LOGICALLY: Work through unchecked tasks (## [ ]) in an order that makes sense (not necessarily top-to-bottom)
4. COMPLETE EACH TASK:
   - Do the work required
   - Mark the task complete by changing ## [ ] to ## [x] in ${ralphFilePath}
   - Add a brief 1-line update under the ### Updates section for that task
5. CONTINUE: Keep going until all tasks are checked or you determine you're done

TASK FORMAT:
- Unchecked: ## [ ] Task Title
- Checked: ## [x] Task Title
- Updates go under ### Updates section (one line per update)

Example update:
### Updates
- Added JWT token generation and validation
- Completed: All auth endpoints working with tests passing

Work autonomously. Don't stop until all tasks are complete.`;
}
