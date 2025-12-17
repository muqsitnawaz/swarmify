## New API

```
 2 │
 3 │### spawn_agent Tool
 4 │
 5 │**Parameter Order:**
 6 │1. `task_name` (optional, string) - Logical grouping for related agents. Case-insensitive matching.
 7 │2. `agent_type` (required, enum) - Type of agent: "codex", "gemini", "cursor", "claude"
 8 │3. `prompt` (required, string) - Task/prompt for the agent. Can be:
 9 │   - Text content directly
10 │   - File path (if file exists, contents will be read)
11 │4. `mode` (required, enum) - Operation mode:
12 │   - `"plan"` - Read-only, planning mode (no file writes)
13 │   - `"edit"` - Write permissions, can modify files
14 │     - Codex: Uses `--sandbox workspace-write` flag
15 │     - Gemini: Workspace-level write permissions
16 │     - Cursor: Workspace-level write permissions
17 │5. `cwd` (optional, string) - Working directory for the agent
18 │6. `model` (optional, string) - Model to use (for codex: gpt-5-codex, gpt-5-codex-mini, etc.)
19 │
20 │**Example Usage:**
```

Text prompt with task grouping

spawn_agent(\
task_name="research_task",\
agent_type="codex",\
prompt="Summarize [README.md](http://README.md)",\
mode="edit"\
)

File prompt

spawn_agent(\
task_name="research_task",\
agent_type="gemini",\
prompt="./prompts/research_task.txt",\
mode="plan"\
)

No task_name (backward compatible)

spawn_agent(\
agent_type="codex",\
prompt="Do something",\
mode="edit"\
)

```
 1 │
 2 │### New Tools
 3 │
 4 │#### check_task_status
 5 │Check status of all agents with a given task_name (case-insensitive).
 6 │
 7 │**Parameters:**
 8 │- `task_name` (required, string) - Task name to check (case-insensitive matching)
 9 │
10 │**Returns:**
11 │Same format as `check_agents_status` but scoped to agents with matching task_name.
12 │
13 │**Example:**
```

check_task_status(task_name="research_task")

Returns status for all agents with task_name="research_task" (case-insensitive)

```
 1 │
 2 │#### stop_task
 3 │Stop all running agents with a given task_name (case-insensitive).
 4 │
 5 │**Parameters:**
 6 │- `task_name` (required, string) - Task name to stop (case-insensitive matching)
 7 │
 8 │**Returns:**
 9 │Summary of stopped agents.
10 │
11 │**Example:**
```

stop_task(task_name="research_task")

Stops all running agents with task_name="research_task" (case-insensitive)

```
 1 │
 2 │### Implementation Notes
 3 │
 4 │1. **Task Name Storage:**
 5 │   - Store `task_name` in agent metadata (normalized to lowercase)
 6 │   - Case-insensitive matching for `check_task_status` and `stop_task`
 7 │
 8 │2. **Prompt File Loading:**
 9 │   - Check if `prompt` is a valid file path: `Path(prompt).exists() and Path(prompt).is_file()`
10 │   - If file exists, read contents (handle encoding, file not found errors)
11 │   - Otherwise, use `prompt` as-is
12 │
13 │3. **Mode Simplification:**
14 │   - Remove `yolo` parameter entirely
15 │   - Replace `safe`/`yolo` modes with `plan`/`edit`
16 │   - Remove all yolo-related safety checks
17 │   - Default mode: `"plan"` (safer default)
18 │
19 │4. **Backward Compatibility:**
20 │   - Agents without `task_name` work as before
21 │   - `check_agents_status([...])` still works for individual agent IDs
22 │   - Consider deprecation path for old `mode="safe"`/`mode="yolo"` if needed
23 │
24 │### Benefits
25 │
26 │- **Logical Grouping:** Related agents can be grouped by `task_name`
27 │- **No Manual ID Tracking:** Use `check_task_status(task_name)` instead of tracking individual IDs
28 │- **Case-Insensitive:** More user-friendly matching
29 │- **Simpler Modes:** Clear `plan` vs `edit` semantics
30 │- **File Prompts:** Support loading prompts from files
31 │- **Backward Compatible:** Existing code continues to work
```