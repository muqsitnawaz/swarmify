# Critical Test Gaps and Server Crash Analysis

## Critical Missing Tests

### 1. **Concurrent Agent Spawning** ⚠️ HIGH PRIORITY
**Issue**: No tests for spawning multiple agents concurrently. This is likely the root cause of server crashes.

**Missing Test Coverage**:
- Spawning 2+ agents in rapid succession
- Spawning agents while others are still running
- File descriptor exhaustion scenarios
- Race conditions in agent directory creation

**Potential Crash Causes**:
- File descriptor leak: `subprocess.Popen` inherits file descriptor from `with open()` context. While the comment says it's safe, closing immediately after Popen might cause issues if subprocess hasn't fully initialized.
- No exception handling around `subprocess.Popen`: If Popen fails (OSError, file descriptor exhaustion), exception propagates up and could crash server.
- No limit on concurrent running agents: `max_agents` only limits completed agents, not running ones.

**Code Location**: `src/agent_swarm/agents.py:393-401`

### 2. **Subprocess Failure Handling** ⚠️ HIGH PRIORITY
**Issue**: No tests for what happens when subprocess fails to start or crashes immediately.

**Missing Test Coverage**:
- Subprocess fails to start (invalid command, permissions)
- Subprocess crashes immediately after spawn
- Process dies before metadata is saved
- OSError from Popen (file descriptor exhaustion, process limit)

**Potential Crash Causes**:
- If `subprocess.Popen()` raises OSError (e.g., "Too many open files"), exception propagates through `spawn()` → `handle_spawn_agent()` → `call_tool()`. While `call_tool()` has try-except, if exception occurs during Popen, it might not be caught properly.
- No cleanup if Popen succeeds but process dies immediately.

**Code Location**: `src/agent_swarm/agents.py:393-401`

### 3. **File Descriptor Management** ⚠️ HIGH PRIORITY
**Issue**: File descriptor handling in spawn() could leak or exhaust resources.

**Missing Test Coverage**:
- File descriptor exhaustion scenarios
- Multiple concurrent file opens
- Proper FD inheritance by subprocess
- File handle cleanup verification

**Potential Crash Causes**:
```python
with open(agent.stdout_path, "w") as stdout_file:
    process = subprocess.Popen(
        cmd,
        stdout=stdout_file,
        ...
    )
    # File closes here, but subprocess inherits FD
```
- If many agents spawn quickly, file descriptors might not be released fast enough
- Subprocess inherits FD, but parent closes it immediately - could cause issues
- No verification that FD is properly inherited/closed

**Code Location**: `src/agent_swarm/agents.py:393-401`

### 4. **Exception Propagation in Async Context** ⚠️ MEDIUM PRIORITY
**Issue**: Exceptions in async functions might not be caught properly.

**Missing Test Coverage**:
- Exception in `manager.spawn()` during async operation
- Exception during `agent.save_meta()` after spawn
- Exception during `_cleanup_old_agents()`
- Unhandled exceptions that crash the event loop

**Potential Crash Causes**:
- If exception occurs in `spawn()` after Popen but before return, it might not be caught
- If `save_meta()` fails (disk full, permissions), exception propagates
- If `_cleanup_old_agents()` fails, it could corrupt state

**Code Location**: `src/agent_swarm/agents.py:350-412`, `src/agent_swarm/server.py:135-172`

### 5. **Concurrent File Access** ⚠️ MEDIUM PRIORITY
**Issue**: Multiple agents reading/writing files concurrently could cause issues.

**Missing Test Coverage**:
- Concurrent reads of stdout.log files
- Concurrent writes to meta.json
- File locking scenarios
- Race conditions in `_read_new_events()`

**Potential Crash Causes**:
- While each agent has its own files, concurrent access during `list_agents()` could cause issues
- `_read_new_events()` opens files without explicit locking
- Multiple calls to `update_status_from_process()` concurrently could cause race conditions

**Code Location**: `src/agent_swarm/agents.py:197-238`, `src/agent_swarm/agents.py:298-314`

### 6. **Process Management and Cleanup** ⚠️ MEDIUM PRIORITY
**Issue**: No tests for zombie processes or process cleanup failures.

**Missing Test Coverage**:
- Zombie process handling
- Process group cleanup
- Signal handling failures
- Process that hangs indefinitely

**Potential Crash Causes**:
- If `os.killpg()` fails in `stop()`, exception might not be handled
- Zombie processes accumulating
- Process groups not properly cleaned up

**Code Location**: `src/agent_swarm/agents.py:482-509`

### 7. **Resource Limits** ⚠️ MEDIUM PRIORITY
**Issue**: No tests for hitting system resource limits.

**Missing Test Coverage**:
- Maximum concurrent processes
- Maximum file descriptors
- Disk space exhaustion
- Memory limits

**Potential Crash Causes**:
- System process limit reached
- File descriptor limit reached
- Disk full during agent spawn

**Code Location**: `src/agent_swarm/agents.py:350-412`

### 8. **Manager State Consistency** ⚠️ LOW PRIORITY
**Issue**: No tests for manager state corruption.

**Missing Test Coverage**:
- Manager state after exception during spawn
- Partial agent creation (directory exists but no process)
- Inconsistent state between memory and disk

**Potential Crash Causes**:
- If spawn fails partway through, agent might be partially created
- State inconsistency could cause later operations to fail

**Code Location**: `src/agent_swarm/agents.py:317-412`

## Most Likely Root Cause of Server Crashes

Based on the code analysis, the **most likely cause** of the server dying after spawning a couple of agents is:

### **File Descriptor Exhaustion + Unhandled Exception**

1. **File Descriptor Leak Pattern**:
   ```python
   with open(agent.stdout_path, "w") as stdout_file:
       process = subprocess.Popen(..., stdout=stdout_file, ...)
   # File closes here, but subprocess inherits FD
   ```
   - When spawning multiple agents quickly, file descriptors might not be released fast enough
   - Each spawn opens a file, creates subprocess, then closes file
   - If subprocess hasn't fully initialized, closing FD could cause issues

2. **No Exception Handling Around Popen**:
   - If `subprocess.Popen()` raises `OSError` (e.g., "Too many open files"), it propagates up
   - While `call_tool()` has try-except, if exception occurs at wrong time, it might crash the event loop

3. **No Limit on Concurrent Running Agents**:
   - `max_agents` only limits completed agents
   - Could spawn unlimited running agents, exhausting system resources

## Recommended Tests to Add

1. **Test concurrent spawning**:
   ```python
   async def test_concurrent_spawn_multiple_agents():
       """Test spawning multiple agents concurrently."""
       tasks = [manager.spawn("codex", f"task {i}", None) for i in range(10)]
       agents = await asyncio.gather(*tasks)
       assert len(agents) == 10
   ```

2. **Test subprocess failure handling**:
   ```python
   async def test_spawn_handles_popen_failure():
       """Test that spawn handles subprocess.Popen failures gracefully."""
       # Mock Popen to raise OSError
       # Verify exception is caught and doesn't crash server
   ```

3. **Test file descriptor management**:
   ```python
   async def test_file_descriptor_cleanup():
       """Test that file descriptors are properly cleaned up."""
       # Spawn multiple agents
       # Verify FD count doesn't grow unbounded
   ```

4. **Test resource limits**:
   ```python
   async def test_spawn_handles_resource_exhaustion():
       """Test handling of resource exhaustion scenarios."""
       # Mock system calls to simulate FD exhaustion
       # Verify graceful error handling
   ```

## Immediate Fixes Needed

1. **Add exception handling around Popen**:
   ```python
   try:
       with open(agent.stdout_path, "w") as stdout_file:
           process = subprocess.Popen(...)
   except OSError as e:
       logger.error(f"Failed to spawn agent {agent_id}: {e}")
       # Cleanup partial agent creation
       raise ValueError(f"Failed to spawn agent: {e}")
   ```

2. **Add limit on concurrent running agents**:
   ```python
   async def spawn(...):
       running = len(self.list_running())
       if running >= MAX_CONCURRENT_AGENTS:
           raise ValueError(f"Too many concurrent agents ({running})")
   ```

3. **Improve file descriptor handling**:
   - Consider using `subprocess.PIPE` and redirecting to file in background
   - Or ensure FD is properly inherited before closing

4. **Add resource monitoring**:
   - Log file descriptor count
   - Log process count
   - Add warnings when approaching limits

