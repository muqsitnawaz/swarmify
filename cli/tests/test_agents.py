"""Tests for agents.py - agent process management."""

import pytest
from datetime import datetime
from agent_spawner.agents import (
    AgentManager,
    AgentProcess,
    AgentStatus,
    AgentType,
    AGENT_COMMANDS,
)


class TestAgentProcess:
    """Test AgentProcess dataclass."""

    def test_to_dict(self):
        """Test serialization to dict."""
        agent = AgentProcess(
            agent_id="test-1",
            agent_type="codex",
            prompt="Test prompt",
            cwd=None,
            status=AgentStatus.RUNNING,
            started_at=datetime(2024, 1, 1, 0, 0, 0),
        )

        result = agent.to_dict()

        assert result["agent_id"] == "test-1"
        assert result["agent_type"] == "codex"
        assert result["status"] == "running"
        assert result["event_count"] == 0
        assert result["completed_at"] is None

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
        """Create a fresh AgentManager for each test."""
        return AgentManager(max_completed=5)

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
        """Create a fresh AgentManager for each test."""
        return AgentManager()

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
