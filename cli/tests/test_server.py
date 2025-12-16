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
    handle_check_agents_status,
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
        assert "view_logs" in tool_names
        assert "check_agents_status" in tool_names


class TestViewLogs:
    """Tests for view_logs functionality."""

    @pytest.mark.asyncio
    async def test_view_logs_returns_structure(self):
        """Test view_logs returns expected structure."""
        from agent_swarm.server import handle_view_logs

        result = await handle_view_logs(lines=10)

        # Should have either logs or error
        assert "log_path" in result or "error" in result

    @pytest.mark.asyncio
    async def test_view_logs_respects_line_limit(self):
        """Test view_logs respects line count limits."""
        from agent_swarm.server import handle_view_logs

        result = await handle_view_logs(lines=5)

        if "returned_lines" in result:
            assert result["returned_lines"] <= 5

    @pytest.mark.asyncio
    async def test_view_logs_clamps_max_lines(self):
        """Test view_logs clamps to max 500 lines."""
        from agent_swarm.server import handle_view_logs

        result = await handle_view_logs(lines=1000)

        if "returned_lines" in result:
            assert result["returned_lines"] <= 500


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


class TestCheckAgentsStatus:
    """Tests for check_agents_status functionality."""

    @pytest.fixture(autouse=True)
    def setup_test_manager(self, monkeypatch):
        """Replace global manager with test instance."""
        agents_dir = TESTDATA_DIR / "check_agents_status_tests"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        test_manager = AgentManager(agents_dir=agents_dir)
        monkeypatch.setattr("agent_swarm.server.manager", test_manager)
        self.manager = test_manager
        self.agents_dir = agents_dir

    @pytest.mark.asyncio
    async def test_check_agents_status_empty_list(self):
        """Test checking status with empty list."""
        result = await handle_check_agents_status(agent_ids=[])

        assert "agents" in result
        assert "summary" in result
        assert result["agents"] == []
        assert result["summary"]["not_found"] == 0

    @pytest.mark.asyncio
    async def test_check_agents_status_nonexistent_agents(self):
        """Test checking status of nonexistent agents."""
        result = await handle_check_agents_status(agent_ids=["nonexistent1", "nonexistent2"])

        assert len(result["agents"]) == 2
        assert result["summary"]["not_found"] == 2
        assert all("error" in agent for agent in result["agents"])

    @pytest.mark.asyncio
    async def test_check_agents_status_returns_structure(self):
        """Test check_agents_status returns expected structure."""
        agent = AgentProcess(
            agent_id="test-status",
            agent_type="codex",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        agent.save_meta()
        self.manager._agents[agent.agent_id] = agent

        result = await handle_check_agents_status(agent_ids=[agent.agent_id])

        assert "agents" in result
        assert "summary" in result
        assert len(result["agents"]) == 1
        
        agent_status = result["agents"][0]
        assert "agent_id" in agent_status
        assert "agent_type" in agent_status
        assert "status" in agent_status
        assert "duration" in agent_status
        assert "last_tool" in agent_status
        assert "summary" in agent_status
        
        assert "running" in result["summary"]
        assert "completed" in result["summary"]
        assert "failed" in result["summary"]
        assert "stopped" in result["summary"]
        assert "not_found" in result["summary"]

    @pytest.mark.asyncio
    async def test_check_agents_status_summary_is_brief(self):
        """Test that summary is a brief string, not full event data."""
        agent = AgentProcess(
            agent_id="test-brief",
            agent_type="cursor",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        agent._events_cache = [
            {"type": "file_write", "path": "test.py"},
            {"type": "bash", "command": "ls"},
            {"type": "file_write", "path": "test2.py"},
        ]
        agent.save_meta()
        self.manager._agents[agent.agent_id] = agent

        result = await handle_check_agents_status(agent_ids=[agent.agent_id])

        summary = result["agents"][0]["summary"]
        assert isinstance(summary, str)
        assert len(summary.split()) <= 30
        assert "events" not in summary.lower() or "event" in summary.lower()

    @pytest.mark.asyncio
    async def test_check_agents_status_multiple_agents(self):
        """Test checking status of multiple agents with different statuses."""
        running_agent = AgentProcess(
            agent_id="running-agent",
            agent_type="codex",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        running_agent.agent_dir.mkdir(parents=True, exist_ok=True)
        running_agent._events_cache = [{"type": "file_write", "path": "test.py"}]
        running_agent.save_meta()
        self.manager._agents[running_agent.agent_id] = running_agent

        completed_agent = AgentProcess(
            agent_id="completed-agent",
            agent_type="cursor",
            prompt="test",
            cwd=None,
            status=AgentStatus.COMPLETED,
            completed_at=datetime.now(),
            _base_dir=self.agents_dir,
        )
        completed_agent.agent_dir.mkdir(parents=True, exist_ok=True)
        completed_agent._events_cache = [
            {"type": "file_write", "path": "test.py"},
            {"type": "message", "content": "Done"},
        ]
        completed_agent.save_meta()
        self.manager._agents[completed_agent.agent_id] = completed_agent

        result = await handle_check_agents_status(
            agent_ids=[running_agent.agent_id, completed_agent.agent_id, "nonexistent"]
        )

        assert len(result["agents"]) == 3
        assert result["summary"]["running"] == 1
        assert result["summary"]["completed"] == 1
        assert result["summary"]["not_found"] == 1

        running_status = next(a for a in result["agents"] if a["agent_id"] == running_agent.agent_id)
        assert running_status["status"] == "running"
        assert running_status["summary"] is not None

        completed_status = next(a for a in result["agents"] if a["agent_id"] == completed_agent.agent_id)
        assert completed_status["status"] == "completed"
        assert completed_status["summary"] is not None

    @pytest.mark.asyncio
    async def test_check_agents_status_no_events(self):
        """Test agent with no events."""
        agent = AgentProcess(
            agent_id="no-events",
            agent_type="codex",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        agent._events_cache = []
        agent.save_meta()
        self.manager._agents[agent.agent_id] = agent

        result = await handle_check_agents_status(agent_ids=[agent.agent_id])

        agent_status = result["agents"][0]
        assert agent_status["last_tool"] is None
        assert agent_status["summary"] is not None
        assert isinstance(agent_status["summary"], str)

    @pytest.mark.asyncio
    async def test_check_agents_status_last_tool(self):
        """Test that last_tool is correctly extracted."""
        agent = AgentProcess(
            agent_id="last-tool-test",
            agent_type="cursor",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        agent._events_cache = [
            {"type": "file_write", "path": "test.py"},
            {"type": "bash", "command": "ls"},
            {"type": "message", "content": "Done"},
        ]
        agent.save_meta()
        self.manager._agents[agent.agent_id] = agent

        result = await handle_check_agents_status(agent_ids=[agent.agent_id])

        agent_status = result["agents"][0]
        assert agent_status["last_tool"] == "message"

    @pytest.mark.asyncio
    async def test_check_agents_status_refreshes_events(self):
        """Test that status check refreshes events from file."""
        agent = AgentProcess(
            agent_id="refresh-test",
            agent_type="codex",
            prompt="test",
            cwd=None,
            status=AgentStatus.RUNNING,
            _base_dir=self.agents_dir,
        )
        agent.agent_dir.mkdir(parents=True, exist_ok=True)
        agent.save_meta()
        self.manager._agents[agent.agent_id] = agent

        stdout_path = agent.stdout_path
        stdout_path.write_text('{"type": "file_write", "path": "test.py"}\n')

        result = await handle_check_agents_status(agent_ids=[agent.agent_id])

        agent_status = result["agents"][0]
        assert agent_status["summary"] is not None
        assert "modified" in agent_status["summary"] or "file" in agent_status["summary"].lower()


class TestCheckAgentsStatusIntegration:
    """Integration tests for check_agents_status with real agent spawning."""

    @pytest.fixture(autouse=True)
    def setup_test_manager(self, monkeypatch):
        """Replace global manager with test instance."""
        agents_dir = TESTDATA_DIR / "check_agents_status_integration"
        if agents_dir.exists():
            shutil.rmtree(agents_dir)
        agents_dir.mkdir(parents=True, exist_ok=True)

        test_manager = AgentManager(agents_dir=agents_dir)
        monkeypatch.setattr("agent_swarm.server.manager", test_manager)
        self.manager = test_manager
        self.agents_dir = agents_dir

    @pytest.mark.asyncio
    async def test_spawn_codex_and_gemini_summarize_readme(self):
        """Test spawning codex and gemini to summarize README.md, then check status."""
        from agent_swarm.agents import check_cli_available
        
        codex_available, _ = check_cli_available("codex")
        gemini_available, _ = check_cli_available("gemini")
        
        if not codex_available or not gemini_available:
            pytest.skip("codex or gemini CLI not available")
        
        readme_path = Path(__file__).parent.parent / "README.md"
        if not readme_path.exists():
            pytest.skip("README.md not found")
        
        prompt = f"Read and summarize the README.md file in this directory. Be concise."
        cwd = str(readme_path.parent)
        
        codex_result = await handle_spawn_agent(
            agent_type="codex",
            prompt=prompt,
            cwd=cwd,
        )
        codex_id = codex_result["agent_id"]
        
        gemini_result = await handle_spawn_agent(
            agent_type="gemini",
            prompt=prompt,
            cwd=cwd,
        )
        gemini_id = gemini_result["agent_id"]
        
        assert codex_result["status"] == "running"
        assert gemini_result["status"] == "running"
        
        import asyncio
        
        print(f"\n=== Initial Status Check (after 2 seconds) ===")
        await asyncio.sleep(2)
        
        status_result = await handle_check_agents_status(agent_ids=[codex_id, gemini_id])
        
        print(f"\nFull check_agents_status output:")
        print(json.dumps(status_result, indent=2))
        
        assert len(status_result["agents"]) == 2
        assert status_result["summary"]["running"] >= 0
        
        codex_status = next(a for a in status_result["agents"] if a["agent_id"] == codex_id)
        gemini_status = next(a for a in status_result["agents"] if a["agent_id"] == gemini_id)
        
        assert codex_status["agent_type"] == "codex"
        assert gemini_status["agent_type"] == "gemini"
        assert codex_status["status"] in ("running", "completed", "failed")
        assert gemini_status["status"] in ("running", "completed", "failed")
        assert "summary" in codex_status
        assert "summary" in gemini_status
        assert isinstance(codex_status["summary"], str)
        assert isinstance(gemini_status["summary"], str)
        assert len(codex_status["summary"].split()) <= 30
        assert len(gemini_status["summary"].split()) <= 30
        
        print(f"\nParsed output:")
        print(f"Codex: {codex_status['status']} | {codex_status['summary']} | last_tool: {codex_status.get('last_tool')} | duration: {codex_status.get('duration')}")
        print(f"Gemini: {gemini_status['status']} | {gemini_status['summary']} | last_tool: {gemini_status.get('last_tool')} | duration: {gemini_status.get('duration')}")
        print(f"Summary counts: {status_result['summary']}")
        
        print(f"\n=== Second Status Check (after 5 more seconds) ===")
        await asyncio.sleep(5)
        
        status_result2 = await handle_check_agents_status(agent_ids=[codex_id, gemini_id])
        
        print(f"\nFull check_agents_status output (second check):")
        print(json.dumps(status_result2, indent=2))
        
        codex_status2 = next(a for a in status_result2["agents"] if a["agent_id"] == codex_id)
        gemini_status2 = next(a for a in status_result2["agents"] if a["agent_id"] == gemini_id)
        
        print(f"\nParsed output:")
        print(f"Codex: {codex_status2['status']} | {codex_status2['summary']} | last_tool: {codex_status2.get('last_tool')} | duration: {codex_status2.get('duration')}")
        print(f"Gemini: {gemini_status2['status']} | {gemini_status2['summary']} | last_tool: {gemini_status2.get('last_tool')} | duration: {gemini_status2.get('duration')}")
        print(f"Summary counts: {status_result2['summary']}")
        
        assert codex_status2["agent_id"] == codex_id
        assert gemini_status2["agent_id"] == gemini_id
