# Safety Verification: --yolo Flag Protection

## ✅ Verification Complete

The `--yolo` flag **cannot be enabled** via the agent-spawner tool. Multiple layers of protection are in place:

## Protection Layers

### 1. **Command Template Hardcoded** ✅
The Codex command template is hardcoded and only uses `--full-auto`:

```python
AGENT_COMMANDS = {
    "codex": ["codex", "exec", "{prompt}", "--full-auto", "--json"],
    # ... other agents
}
```

**Verification**: `--yolo` is NOT in any command template.

### 2. **No Additional Flag Parameters** ✅
The `spawn_agent` tool only accepts:
- `agent_type` (enum: codex, gemini, cursor, claude)
- `prompt` (string)
- `cwd` (optional string)

**No way to pass additional flags** - the API doesn't support it.

### 3. **Prompt Validation** ✅
Explicit validation rejects prompts containing `--yolo`:

```python
if "--yolo" in prompt or prompt.strip().startswith("--yolo") or " --yolo " in prompt:
    raise ValueError("Safety: --yolo flag is not allowed...")
```

**Protection**: Even if someone tries to inject `--yolo` in the prompt, it's rejected.

### 4. **Command Construction Check** ✅
After building the command, a final check ensures `--yolo` isn't present:

```python
cmd = [part.replace("{prompt}", prompt) for part in cmd_template]
if "--yolo" in cmd:
    raise ValueError("Safety: --yolo flag detected in command...")
```

**Protection**: Double-check that the final command doesn't contain `--yolo`.

### 5. **Prompt Injection Safety** ✅
Even if `--yolo` were in the prompt (which is blocked), the command construction uses `subprocess_exec` with a list of arguments:

```python
cmd = ['codex', 'exec', 'fix bug --yolo', '--full-auto', '--json']
#                              ^^^^^^^^^^^^
#                              This is ONE argument, not a flag
```

The prompt is inserted as a **single string argument**, so `--yolo` would be part of the prompt text, not interpreted as a separate flag.

## Test Coverage

All safety tests pass ✅:

- ✅ `test_yolo_in_prompt_rejected` - Prompts with `--yolo` are rejected
- ✅ `test_yolo_at_start_rejected` - Prompts starting with `--yolo` are rejected  
- ✅ `test_yolo_with_spaces_rejected` - `--yolo` with spaces is rejected
- ✅ `test_yolo_not_in_command_template` - Templates don't contain `--yolo`
- ✅ `test_codex_uses_full_auto_not_yolo` - Codex uses `--full-auto`, not `--yolo`
- ✅ `test_normal_prompt_allowed` - Normal prompts work fine
- ✅ `test_prompt_with_word_yolo_allowed` - Word "yolo" (not flag) is allowed

## Verification Results

```
Codex command template: ['codex', 'exec', '{prompt}', '--full-auto', '--json']
--yolo in template? False ✅
--yolo in final cmd? False ✅
--full-auto in cmd? True ✅
```

## Conclusion

**The `--yolo` flag is completely blocked** through multiple layers:

1. ✅ Not in command templates
2. ✅ Cannot be passed as a parameter
3. ✅ Rejected if found in prompt
4. ✅ Double-checked in final command
5. ✅ Tested and verified

**Safe automation mode (`--full-auto`) is enforced** - the dangerous `--yolo` mode cannot be enabled via this tool.
