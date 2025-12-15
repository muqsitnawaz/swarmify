"""Tests for agents.py - agent process management."""

import json
import shutil
import signal
import pytest
from datetime import datetime
from pathlib import Path
from agent_swarm.agents import (
    AgentManager,
    AgentProcess,
    AgentStatus,
    AgentType,
    AGENT_COMMANDS,
)

# Test data directory - checked into repo for reproducible tests
TESTDATA_DIR = Path(__file__).parent / "testdata"


def test_resolve_agents_dir_falls_back(monkeypatch, tmp_path):
    """Ensure storage resolution falls back when defaults are not writable."""
    import agent_swarm.agents as agents

    attempts: list[Path] = []

    def fake_is_writable(path: Path) -> bool:
        attempts.append(path)
        return path == tmp_path / "agent-swarm" / "agents"

    monkeypatch.delenv("AGENT_SWARM_DIR", raising=False)
    monkeypatch.setattr(agents, "_is_writable", fake_is_writable)
    monkeypatch.setattr(agents.tempfile, "gettempdir", lambda: str(tmp_path))

    resolved = agents._resolve_agents_dir()

    assert resolved == tmp_path / "agent-swarm" / "agents"
    assert attempts[-1] == resolved


class TestAgentProcess:
    """Test AgentProcess dataclass."""

    def test_to_dict(self):
        """Test serialization to dict."""
        agent = AgentProcess(
            agent_id="test-1",
            agent_type="codex",
            prompt="Test prompt",
            cwd=None,
            yolo=False,
            status=AgentStatus.RUNNING,
            started_at=datetime(2024, 1, 1, 0, 0, 0),
        )

        result = agent.to_dict()

        assert result["agent_id"] == "test-1"
        assert result["agent_type"] == "codex"
        assert result["status"] == "running"
        assert result["event_count"] == 0
        assert result["completed_at"] is None
        assert result["mode"] == "safe"
        assert result["yolo"] is False
        assert result["mode"] == "safe"

    def test_to_dict_yolo_mode(self):
        """Test serialization reflects yolo mode."""
        agent = AgentProcess(
            agent_id="test-yolo",
            agent_type="codex",
            prompt="Test prompt",
            cwd=None,
            yolo=True,
            status=AgentStatus.RUNNING,
            started_at=datetime(2024, 1, 1, 0, 0, 0),
        )

        result = agent.to_dict()
        assert result["mode"] == "yolo"

    def test_save_and_load_persists_yolo_mode(self, tmp_path):
        """Persisted metadata should carry yolo mode across restarts."""
        agent = AgentProcess(
            agent_id="persist-yolo",
            agent_type="codex",
            prompt="Test prompt",
            cwd=None,
            yolo=True,
            status=AgentStatus.RUNNING,
            _base_dir=tmp_path,
        )

        agent.save_meta()

        with open(agent.meta_path) as f:
            meta = json.load(f)
        assert meta["mode"] == "yolo"
        assert meta["yolo"] is True

        reloaded = AgentProcess.load_from_disk(agent.agent_id, base_dir=tmp_path)
        assert reloaded is not None
        assert reloaded.yolo is True
        assert reloaded.mode == "yolo"

    def test_duration_calculation_completed(self):
        """Test duration calculation for completed agent."""
        started = datetime(2024, 1, 1, 0, 0, 0)
        completed = datetime(2024, 1, 1, 0, 0, 5)

        agent = AgentProcess(
            agent_id="test-2",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.COMPLETED,
            started_at=started,
            completed_at=completed,
        )

        duration = agent._duration_ms()
        assert duration == 5000

    def test_duration_calculation_running(self):
        """Test duration calculation for running agent."""
        started = datetime.now()

        agent = AgentProcess(
            agent_id="test-3",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
            started_at=started,
        )

        duration = agent._duration_ms()
        assert duration is not None
        assert duration >= 0

    def test_update_status_marks_failed_on_nonzero_exit(self, monkeypatch):
        """Non-zero exit without completion events should mark agent as failed."""
        agent = AgentProcess(
            agent_id="crash",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
            pid=4242,
        )

        monkeypatch.setattr(agent, "is_process_alive", lambda: False)
        monkeypatch.setattr(agent, "_reap_process", lambda: 9)
        monkeypatch.setattr(agent, "_read_new_events", lambda: None)

        saved: dict[str, bool] = {}
        monkeypatch.setattr(agent, "save_meta", lambda: saved.setdefault("called", True))

        agent.update_status_from_process()

        assert agent.status == AgentStatus.FAILED
        assert agent.completed_at is not None
        assert saved.get("called") is True

    def test_update_status_marks_completed_on_clean_exit(self, monkeypatch):
        """Zero exit without completion events should mark agent as completed."""
        agent = AgentProcess(
            agent_id="clean-exit",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
            pid=5252,
        )

        monkeypatch.setattr(agent, "is_process_alive", lambda: False)
        monkeypatch.setattr(agent, "_reap_process", lambda: 0)
        monkeypatch.setattr(agent, "_read_new_events", lambda: None)

        saved: dict[str, bool] = {}
        monkeypatch.setattr(agent, "save_meta", lambda: saved.setdefault("called", True))

        agent.update_status_from_process()

        assert agent.status == AgentStatus.COMPLETED
        assert agent.completed_at is not None
        assert saved.get("called") is True


class TestAgentCommands:
    """Test agent command templates."""

    def test_all_agent_types_have_commands(self):
        """Test that all agent types have command templates."""
        assert "codex" in AGENT_COMMANDS
        assert "cursor" in AGENT_COMMANDS
        assert "gemini" in AGENT_COMMANDS
        assert "claude" in AGENT_COMMANDS

    def test_command_template_formatting(self):
        """Test command template has prompt placeholder."""
        for agent_type, cmd_template in AGENT_COMMANDS.items():
            assert "{prompt}" in " ".join(cmd_template)

    def test_codex_command(self):
        """Test Codex command structure."""
        cmd = AGENT_COMMANDS["codex"]
        assert cmd[0] == "codex"
        assert "exec" in cmd
        assert "--full-auto" in cmd
        assert "--json" in cmd

    def test_cursor_command(self):
        """Test Cursor command structure."""
        cmd = AGENT_COMMANDS["cursor"]
        assert "cursor-agent" in cmd or "cursor" in cmd
        assert "-p" in cmd or "--prompt" in cmd
        assert "--output-format" in cmd
        assert "stream-json" in cmd


class TestAgentManager:
    """Test AgentManager functionality."""

    @pytest.fixture
    def manager(self):
        """Create a fresh AgentManager for each test with isolated storage."""
        agents_dir = TESTDATA_DIR / "agent_manager_tests"
        # Clean before each test for isolation
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)
        return AgentManager(max_agents=5, agents_dir=agents_dir)

    def test_manager_initialization(self, manager):
        """Test manager initialization."""
        assert len(manager.list_all()) == 0
        assert len(manager.list_running()) == 0
        assert len(manager.list_completed()) == 0

    def test_get_nonexistent_agent(self, manager):
        """Test getting non-existent agent."""
        agent = manager.get("nonexistent")
        assert agent is None

    def test_cleanup_old_agents(self, manager):
        """Test cleanup of old completed agents."""
        from datetime import timedelta

        now = datetime.now()

        for i in range(10):
            agent = AgentProcess(
                agent_id=f"test-{i}",
                agent_type="codex",
                prompt="Test",
                cwd=None,
                status=AgentStatus.COMPLETED,
                started_at=now - timedelta(minutes=10),
                completed_at=now - timedelta(minutes=9),
            )
            manager._agents[agent.agent_id] = agent

        assert len(manager.list_all()) == 10

        manager._cleanup_old_agents()

        assert len(manager.list_all()) == 5

    def test_list_running(self, manager):
        """Test listing running agents."""
        running1 = AgentProcess(
            agent_id="running-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
        )
        running2 = AgentProcess(
            agent_id="running-2",
            agent_type="gemini",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
        )
        completed = AgentProcess(
            agent_id="completed-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.COMPLETED,
        )

        manager._agents = {
            "running-1": running1,
            "running-2": running2,
            "completed-1": completed,
        }

        running = manager.list_running()
        assert len(running) == 2
        assert all(a.status == AgentStatus.RUNNING for a in running)

    def test_list_completed(self, manager):
        """Test listing completed agents."""
        running = AgentProcess(
            agent_id="running-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
        )
        completed1 = AgentProcess(
            agent_id="completed-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.COMPLETED,
        )
        completed2 = AgentProcess(
            agent_id="completed-2",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.FAILED,
        )

        manager._agents = {
            "running-1": running,
            "completed-1": completed1,
            "completed-2": completed2,
        }

        completed = manager.list_completed()
        assert len(completed) == 2
        assert all(a.status != AgentStatus.RUNNING for a in completed)


@pytest.mark.asyncio
class TestAgentManagerAsync:
    """Test async AgentManager operations."""

    @pytest.fixture
    def manager(self):
        """Create a fresh AgentManager for each test with isolated storage."""
        agents_dir = TESTDATA_DIR / "agent_manager_async_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)
        return AgentManager(agents_dir=agents_dir)

    async def test_spawn_invalid_agent_type(self, manager):
        """Test spawning with invalid agent type."""
        with pytest.raises(ValueError, match="Unknown agent type"):
            await manager.spawn("invalid_type", "test prompt", None)

    async def test_stop_nonexistent_agent(self, manager):
        """Test stopping non-existent agent."""
        success = await manager.stop("nonexistent")
        assert success is False

    async def test_stop_already_completed_agent(self, manager):
        """Test stopping an already completed agent."""
        agent = AgentProcess(
            agent_id="completed-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.COMPLETED,
        )
        manager._agents["completed-1"] = agent

        success = await manager.stop("completed-1")
        assert success is False

    async def test_spawn_accepts_mode_string(self, manager, monkeypatch):
        """Manager.spawn should accept a mode string and flip the yolo flag."""
        monkeypatch.setattr("agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo"))

        class DummyProcess:
            def __init__(self):
                self.pid = 7777

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess())

        agent = await manager.spawn("codex", "task", None, mode="yolo")

        assert agent.yolo is True
        assert agent.mode == "yolo"

    async def test_spawn_invalid_mode_rejected(self, manager, monkeypatch):
        """Invalid mode strings should be rejected before spawning."""
        monkeypatch.setattr("agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo"))

        with pytest.raises(ValueError, match="mode"):
            await manager.spawn("codex", "task", None, mode="turbo")

    async def test_spawn_mode_overrides_yolo_flag(self, manager, monkeypatch):
        """Explicit mode selection should override the boolean yolo flag at manager level."""
        monkeypatch.setattr("agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo"))

        class DummyProcess:
            def __init__(self):
                self.pid = 8888

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess())

        captured: dict[str, bool] = {}
        original_build_command = manager._build_command

        def capture_build(agent_type, prompt, yolo_flag):
            captured["yolo"] = yolo_flag
            return original_build_command(agent_type, prompt, yolo_flag)

        monkeypatch.setattr(manager, "_build_command", capture_build)

        agent = await manager.spawn("codex", "ship it", None, yolo=False, mode="yolo")

        assert captured.get("yolo") is True
        assert agent.yolo is True
        assert agent.mode == "yolo"

    async def test_spawn_handles_popen_failure(self, manager, monkeypatch):
        """Spawn should surface a clean error and cleanup when Popen fails."""
        agents_dir = TESTDATA_DIR / "agent_manager_async_tests"

        monkeypatch.setattr("agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo"))

        def fake_popen(*_, **__):
            raise OSError("boom")

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", fake_popen)

        with pytest.raises(ValueError, match="Failed to spawn agent"):
            await manager.spawn("codex", "task", None)

        assert manager.list_all() == []
        assert list(agents_dir.iterdir()) == []

    async def test_spawn_cleans_up_on_meta_save_failure(self, manager, monkeypatch):
        """If metadata persistence fails, the child process is terminated and cleaned up."""
        agents_dir = TESTDATA_DIR / "agent_manager_async_tests"
        kills: list[tuple[int, signal.Signals]] = []

        monkeypatch.setattr("agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo"))

        class DummyProcess:
            def __init__(self):
                self.pid = 12345

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess())

        def fail_save_meta(self):
            raise RuntimeError("disk full")

        monkeypatch.setattr("agent_swarm.agents.AgentProcess.save_meta", fail_save_meta)
        monkeypatch.setattr("agent_swarm.agents.os.getpgid", lambda pid: pid)
        monkeypatch.setattr("agent_swarm.agents.os.killpg", lambda pgid, sig: kills.append((pgid, sig)))

        with pytest.raises(ValueError, match="persist metadata"):
            await manager.spawn("codex", "task", None)

        assert manager.list_all() == []
        assert list(agents_dir.iterdir()) == []
        assert kills and kills[0][1] == signal.SIGTERM

    async def test_concurrent_spawn_limit_rejects_at_max(self, monkeypatch):
        """Verify spawn rejects when max_concurrent running agents is reached."""
        agents_dir = TESTDATA_DIR / "agent_manager_concurrent_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        # Create manager with max_concurrent=2
        manager = AgentManager(max_concurrent=2, agents_dir=agents_dir)

        # Prevent status updates from changing running agents to completed
        monkeypatch.setattr(AgentProcess, "is_process_alive", lambda self: True)

        # Add 2 running agents to the manager
        for i in range(2):
            agent = AgentProcess(
                agent_id=f"running-{i}",
                agent_type="codex",
                prompt="Test",
                cwd=None,
                status=AgentStatus.RUNNING,
                pid=1000 + i,
                _base_dir=agents_dir,
            )
            manager._agents[agent.agent_id] = agent

        assert len(manager.list_running()) == 2

        # Third spawn should fail
        monkeypatch.setattr(
            "agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo")
        )

        with pytest.raises(ValueError, match="Maximum concurrent agents"):
            await manager.spawn("codex", "third task", None)

    async def test_concurrent_spawn_allows_after_completion(self, monkeypatch):
        """Verify spawn succeeds after a running agent completes."""
        agents_dir = TESTDATA_DIR / "agent_manager_concurrent_completion_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        manager = AgentManager(max_concurrent=2, agents_dir=agents_dir)

        # Prevent status updates from changing running agents to completed
        monkeypatch.setattr(AgentProcess, "is_process_alive", lambda self: self.status == AgentStatus.RUNNING)

        # Add 2 agents, one running and one completed
        running = AgentProcess(
            agent_id="running-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
            pid=1001,
            _base_dir=agents_dir,
        )
        completed = AgentProcess(
            agent_id="completed-1",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.COMPLETED,
            pid=1002,
            _base_dir=agents_dir,
        )
        manager._agents = {"running-1": running, "completed-1": completed}

        assert len(manager.list_running()) == 1

        # Should allow spawn since only 1 is running
        monkeypatch.setattr(
            "agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo")
        )

        class DummyProcess:
            def __init__(self):
                self.pid = 9999

        monkeypatch.setattr(
            "agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess()
        )

        agent = await manager.spawn("codex", "new task", None)
        assert agent is not None
        assert len(manager.list_running()) == 2

    async def test_spawn_refreshes_running_status_before_limit(self, monkeypatch):
        """Stale RUNNING agents should not block new spawns when the process is dead."""
        agents_dir = TESTDATA_DIR / "agent_manager_concurrent_refresh_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        manager = AgentManager(max_concurrent=1, agents_dir=agents_dir)

        stale = AgentProcess(
            agent_id="stale",
            agent_type="codex",
            prompt="Test",
            cwd=None,
            status=AgentStatus.RUNNING,
            pid=1111,
            _base_dir=agents_dir,
        )
        stale.agent_dir.mkdir(parents=True, exist_ok=True)
        stale.save_meta()
        manager._agents = {stale.agent_id: stale}

        # Process already exited, but status is still RUNNING
        monkeypatch.setattr(AgentProcess, "is_process_alive", lambda self: self.agent_id != "stale")
        monkeypatch.setattr(AgentProcess, "_reap_process", lambda self: 0)
        monkeypatch.setattr(AgentProcess, "_read_new_events", lambda self: None)

        monkeypatch.setattr(
            "agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo")
        )

        class DummyProcess:
            def __init__(self):
                self.pid = 2222

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess())

        agent = await manager.spawn("codex", "new task", None)

        assert agent is not None
        assert stale.status == AgentStatus.COMPLETED
        running = manager.list_running()
        assert len(running) == 1
        assert running[0].agent_id == agent.agent_id

    async def test_spawn_handles_mkdir_failure(self, monkeypatch):
        """Verify spawn handles agent directory creation failure gracefully."""
        agents_dir = TESTDATA_DIR / "agent_manager_mkdir_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        manager = AgentManager(agents_dir=agents_dir)

        monkeypatch.setattr(
            "agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo")
        )

        original_mkdir = Path.mkdir

        def fail_mkdir(self, *args, **kwargs):
            # Fail only for agent subdirectories, not for the base dir
            if "agent_manager_mkdir_tests" in str(self) and len(self.parts) > len(
                agents_dir.parts
            ):
                raise OSError("Permission denied")
            return original_mkdir(self, *args, **kwargs)

        monkeypatch.setattr(Path, "mkdir", fail_mkdir)

        with pytest.raises(ValueError, match="Failed to create agent directory"):
            await manager.spawn("codex", "test task", None)

        assert manager.list_all() == []

    async def test_spawn_handles_process_exit_during_cleanup(self, monkeypatch):
        """Verify spawn cleanup handles process that exits before getpgid is called."""
        agents_dir = TESTDATA_DIR / "agent_manager_race_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        manager = AgentManager(agents_dir=agents_dir)

        monkeypatch.setattr(
            "agent_swarm.agents.check_cli_available", lambda agent_type: (True, "/bin/echo")
        )

        class DummyProcess:
            def __init__(self):
                self.pid = 54321

        monkeypatch.setattr(
            "agent_swarm.agents.subprocess.Popen", lambda *_, **__: DummyProcess()
        )

        def fail_save_meta(self):
            raise RuntimeError("disk full")

        monkeypatch.setattr("agent_swarm.agents.AgentProcess.save_meta", fail_save_meta)

        # Simulate process already exited by the time we try to kill it
        def raise_process_lookup_error(pid):
            raise ProcessLookupError("No such process")

        monkeypatch.setattr("agent_swarm.agents.os.getpgid", raise_process_lookup_error)

        # This should NOT crash - it should handle ProcessLookupError gracefully
        with pytest.raises(ValueError, match="persist metadata"):
            await manager.spawn("codex", "task", None)

        # Verify cleanup still happened
        assert manager.list_all() == []
        assert list(agents_dir.iterdir()) == []
