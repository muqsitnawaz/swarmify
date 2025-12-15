"""Tests for MCP server - end-to-end integration tests."""

import json
import pytest
import shutil
from datetime import datetime
from pathlib import Path

from agent_swarm.agents import AgentManager, AgentProcess, AgentStatus, AGENT_COMMANDS
from agent_swarm.server import (
    handle_spawn_agent,
    handle_read_agent_output,
    handle_list_agents,
    handle_stop_agent,
    manager,
)

# Test data directory
TESTDATA_DIR = Path(__file__).parent / "testdata"


class TestMCPToolHandlers:
    """Test MCP tool handler functions directly."""

    @pytest.fixture(autouse=True)
    def setup_test_manager(self, monkeypatch):
        """Replace global manager with test instance."""
        agents_dir = TESTDATA_DIR / "mcp_server_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        test_manager = AgentManager(agents_dir=agents_dir)
        monkeypatch.setattr("agent_swarm.server.manager", test_manager)
        self.manager = test_manager
        self.agents_dir = agents_dir

    @pytest.mark.asyncio
    async def test_list_agents_empty(self):
        """Test listing agents when none exist."""
        result = await handle_list_agents()

        assert result["running_count"] == 0
        assert result["completed_count"] == 0
        assert result["agents"] == []

    @pytest.mark.asyncio
    async def test_read_nonexistent_agent(self):
        """Test reading output from nonexistent agent."""
        result = await handle_read_agent_output(
            agent_id="nonexistent",
            format="summary",
            detail_level="standard",
            since_event=0,
        )

        assert "error" in result
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_read_agent_output_includes_mode(self):
        """Reading output should include the agent's mode."""
        agent = AgentProcess(
            agent_id="mode-test",
            agent_type="codex",
            prompt="check mode",
            cwd=None,
            yolo=True,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        self.manager._agents[agent.agent_id] = agent

        summary = await handle_read_agent_output(agent_id=agent.agent_id, format="summary")
        delta = await handle_read_agent_output(agent_id=agent.agent_id, format="delta")
        events = await handle_read_agent_output(agent_id=agent.agent_id, format="events")

        assert summary["mode"] == "yolo"
        assert summary["yolo"] is True
        assert delta["mode"] == "yolo"
        assert delta["yolo"] is True
        assert events["mode"] == "yolo"
        assert events["yolo"] is True

    @pytest.mark.asyncio
    async def test_stop_nonexistent_agent(self):
        """Test stopping nonexistent agent."""
        result = await handle_stop_agent(agent_id="nonexistent")

        assert "error" in result
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_spawn_invalid_agent_type(self):
        """Test spawning with invalid agent type."""
        with pytest.raises(ValueError, match="Unknown agent type"):
            await handle_spawn_agent(
                agent_type="invalid",
                prompt="test",
                cwd=None,
            )

    @pytest.mark.asyncio
    async def test_spawn_rejects_yolo_flag_without_mode(self):
        """Test that --yolo flag is rejected without explicit yolo mode."""
        with pytest.raises(ValueError, match="yolo"):
            await handle_spawn_agent(
                agent_type="codex",
                prompt="do something --yolo",
                cwd=None,
            )

    @pytest.mark.asyncio
    async def test_spawn_allows_explicit_yolo_mode(self, monkeypatch):
        """Test that explicit yolo opt-in flows through the handler."""

        async def fake_spawn(agent_type, prompt, cwd, yolo=False, mode=None):
            class DummyAgent:
                def __init__(self):
                    self.agent_id = "test-yolo"
                    self.agent_type = agent_type
                    self.prompt = prompt
                    self.cwd = cwd
                    self.status = AgentStatus.RUNNING
                    self.started_at = datetime(2024, 1, 1)
                    self.yolo = yolo

            return DummyAgent()

        monkeypatch.setattr(self.manager, "spawn", fake_spawn)

        result = await handle_spawn_agent(
            agent_type="codex",
            prompt="ship it",
            cwd=None,
            yolo=True,
        )

        assert result["mode"] == "yolo"
        assert result["yolo"] is True
        assert "YOLO" in result["message"]

    @pytest.mark.asyncio
    async def test_spawn_accepts_mode_string(self, monkeypatch):
        """Mode string should map to the correct yolo flag."""

        async def fake_spawn(agent_type, prompt, cwd, yolo=False, mode=None):
            class DummyAgent:
                def __init__(self):
                    self.agent_id = "mode-yolo"
                    self.agent_type = agent_type
                    self.prompt = prompt
                    self.cwd = cwd
                    self.status = AgentStatus.RUNNING
                    self.started_at = datetime(2024, 1, 1)
                    self.yolo = yolo

            return DummyAgent()

        monkeypatch.setattr(self.manager, "spawn", fake_spawn)

        result = await handle_spawn_agent(
            agent_type="codex",
            prompt="ship it",
            cwd=None,
            mode="yolo",
        )

        assert result["mode"] == "yolo"
        assert result["yolo"] is True

    @pytest.mark.asyncio
    async def test_spawn_invalid_mode_rejected(self):
        """Invalid mode values should raise an error."""
        with pytest.raises(ValueError, match="mode"):
            await handle_spawn_agent(
                agent_type="codex",
                prompt="ship it",
                cwd=None,
                mode="turbo",
            )

    @pytest.mark.asyncio
    async def test_spawn_mode_overrides_yolo_flag(self, monkeypatch):
        """Explicit mode selection should win over the yolo boolean."""
        captured: dict[str, bool] = {}

        async def fake_spawn(agent_type, prompt, cwd, yolo=False, mode=None):
            captured["yolo"] = yolo
            captured["mode"] = mode

            class DummyAgent:
                def __init__(self):
                    self.agent_id = "mode-override"
                    self.agent_type = agent_type
                    self.prompt = prompt
                    self.cwd = cwd
                    self.status = AgentStatus.RUNNING
                    self.started_at = datetime(2024, 1, 1)
                    self.yolo = yolo

            return DummyAgent()

        monkeypatch.setattr(self.manager, "spawn", fake_spawn)

        result = await handle_spawn_agent(
            agent_type="codex",
            prompt="ship it",
            cwd=None,
            yolo=False,
            mode="yolo",
        )

        assert result["mode"] == "yolo"
        assert result["yolo"] is True
        assert captured.get("yolo") is True
        assert captured.get("mode") == "yolo"


class TestAgentCommands:
    """Test agent command configurations."""

    def test_all_agents_have_json_output(self):
        """Verify all agents output JSON for parsing."""
        for agent_type, cmd in AGENT_COMMANDS.items():
            cmd_str = " ".join(cmd)
            assert "--json" in cmd_str or "stream-json" in cmd_str, (
                f"{agent_type} command must output JSON"
            )

    def test_no_yolo_in_commands(self):
        """Verify no agent commands contain --yolo."""
        for agent_type, cmd in AGENT_COMMANDS.items():
            cmd_str = " ".join(cmd)
            assert "--yolo" not in cmd_str, (
                f"{agent_type} command must not contain --yolo"
            )

    def test_codex_uses_full_auto(self):
        """Verify Codex uses --full-auto (safe mode)."""
        cmd = AGENT_COMMANDS["codex"]
        assert "--full-auto" in cmd, "Codex must use --full-auto for safety"


class TestServerIntegration:
    """Integration tests for server functionality."""

    def test_server_name_is_agent_swarm(self):
        """Verify server reports correct name."""
        from agent_swarm.server import server
        assert server.name == "agent-swarm"

    def test_tools_are_registered(self):
        """Verify all tools are available."""
        from agent_swarm.server import list_tools
        import asyncio

        tools = asyncio.run(list_tools())
        tool_names = [t.name for t in tools]

        assert "spawn_agent" in tool_names
        assert "read_agent_output" in tool_names
        assert "list_agents" in tool_names
        assert "stop_agent" in tool_names
        assert "check_environment" in tool_names


class TestCheckEnvironment:
    """Tests for environment checking functionality."""

    @pytest.mark.asyncio
    async def test_check_environment_returns_all_agents(self):
        """Test check_environment returns info for all agent types."""
        from agent_swarm.server import handle_check_environment

        result = await handle_check_environment()

        assert "agents" in result
        assert "installed" in result
        assert "missing" in result
        assert "ready" in result
        assert "message" in result

        # Should have info for all 4 agent types
        assert "codex" in result["agents"]
        assert "cursor" in result["agents"]
        assert "gemini" in result["agents"]
        assert "claude" in result["agents"]

    @pytest.mark.asyncio
    async def test_check_environment_agent_info_structure(self):
        """Test each agent has proper info structure."""
        from agent_swarm.server import handle_check_environment

        result = await handle_check_environment()

        for agent_type, info in result["agents"].items():
            assert "installed" in info
            assert "path" in info
            assert "error" in info

            if info["installed"]:
                assert info["path"] is not None
                assert info["error"] is None
            else:
                assert info["path"] is None
                assert info["error"] is not None


class TestCLIValidation:
    """Tests for CLI tool validation before spawning."""

    def test_check_cli_available_returns_tuple(self):
        """Test check_cli_available returns proper tuple."""
        from agent_swarm.agents import check_cli_available

        available, path_or_error = check_cli_available("codex")

        assert isinstance(available, bool)
        assert isinstance(path_or_error, str)

    def test_check_cli_available_invalid_type(self):
        """Test check_cli_available with invalid agent type."""
        from agent_swarm.agents import check_cli_available

        available, error = check_cli_available("invalid_agent")

        assert available is False
        assert "Unknown agent type" in error

    def test_check_all_clis_returns_dict(self):
        """Test check_all_clis returns proper structure."""
        from agent_swarm.agents import check_all_clis

        result = check_all_clis()

        assert isinstance(result, dict)
        assert "codex" in result
        assert "cursor" in result
        assert "gemini" in result
        assert "claude" in result
