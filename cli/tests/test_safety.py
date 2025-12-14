"""Tests for yolo flag handling - defaults stay safe unless explicitly enabled."""

import pytest
from agent_swarm.agents import AgentManager


@pytest.mark.asyncio
class TestYoloSafety:
    """Test that --yolo flag remains blocked unless explicitly opted into."""

    @pytest.fixture
    def manager(self, tmp_path):
        """Create a fresh AgentManager for each test."""
        return AgentManager(agents_dir=tmp_path)

    async def test_yolo_in_prompt_rejected(self, manager):
        """Test that prompts containing --yolo are rejected without yolo mode."""
        with pytest.raises(ValueError, match="yolo=True"):
            await manager.spawn("codex", "fix bug --yolo", None)

    async def test_yolo_at_start_rejected(self, manager):
        """Test that prompts starting with --yolo are rejected without yolo mode."""
        with pytest.raises(ValueError, match="yolo=True"):
            await manager.spawn("codex", "--yolo deploy everything", None)

    async def test_yolo_with_spaces_rejected(self, manager):
        """Test that --yolo with spaces around it is rejected without yolo mode."""
        with pytest.raises(ValueError, match="yolo=True"):
            await manager.spawn("codex", "deploy --yolo everything", None)

    async def test_yolo_split_flag_rejected(self, manager):
        """Test that attempts to smuggle '-- yolo' are blocked without opt-in."""
        with pytest.raises(ValueError, match="yolo=True"):
            await manager.spawn("codex", "deploy -- yolo everything", None)

    async def test_yolo_opt_in_builds_yolo_command(self, manager):
        """Explicit opt-in should swap --full-auto for --yolo where supported."""
        cmd = manager._build_command("codex", "deploy to prod", yolo=True)
        assert "--yolo" in cmd
        assert "--full-auto" not in cmd

    async def test_yolo_prompt_allowed_when_opted_in(self, manager):
        """Prompts containing --yolo can be used when explicitly opting in."""
        cmd = manager._build_command("codex", "deploy --yolo now", yolo=True)
        assert "--yolo" in cmd

    async def test_yolo_not_in_command_template(self):
        """Test that command templates don't include --yolo."""
        from agent_swarm.agents import AGENT_COMMANDS

        for agent_type, cmd_template in AGENT_COMMANDS.items():
            cmd_str = " ".join(cmd_template)
            assert "--yolo" not in cmd_str, f"{agent_type} command template contains --yolo"

    async def test_codex_uses_full_auto_not_yolo(self):
        """Test that Codex command uses --full-auto, not --yolo."""
        from agent_swarm.agents import AGENT_COMMANDS

        codex_cmd = AGENT_COMMANDS["codex"]
        assert "--full-auto" in codex_cmd
        assert "--yolo" not in codex_cmd

    async def test_normal_prompt_allowed(self, manager):
        """Test that normal prompts without --yolo are allowed."""
        try:
            agent = await manager.spawn("codex", "fix the bug", None)
            assert agent is not None
            assert agent.prompt == "fix the bug"
        except Exception as e:
            if "codex" in str(e).lower() or "command not found" in str(e).lower():
                pytest.skip("Codex CLI not available for testing")
            else:
                raise

    async def test_prompt_with_word_yolo_allowed(self, manager):
        """Test that prompts containing the word 'yolo' (not as flag) are allowed."""
        try:
            agent = await manager.spawn("codex", "implement yolo mode feature", None)
            assert agent is not None
            assert "yolo" in agent.prompt.lower()
        except Exception as e:
            if "codex" in str(e).lower() or "command not found" in str(e).lower():
                pytest.skip("Codex CLI not available for testing")
            else:
                raise

    async def test_yolo_mode_opt_in_switches_flag(self, manager, monkeypatch):
        """Test that opting into yolo mode swaps --full-auto for --yolo."""
        captured_cmds: list[list[str]] = []

        class DummyProcess:
            def __init__(self, cmd: list[str]):
                self.pid = 4242
                self.cmd = cmd

        def fake_popen(cmd, *args, **kwargs):
            captured_cmds.append(cmd)
            return DummyProcess(cmd)

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", fake_popen)

        agent = await manager.spawn("codex", "deploy everything", None, yolo=True)
        assert agent.yolo is True
        assert captured_cmds, "Expected spawn to invoke subprocess.Popen"
        cmd = captured_cmds[0]
        assert "--yolo" in cmd
        assert "--full-auto" not in cmd

    async def test_yolo_flag_in_prompt_allowed_when_opted_in(self, manager, monkeypatch):
        """Test that --yolo in the prompt is allowed when yolo mode is enabled."""
        calls: list[list[str]] = []

        class DummyProcess:
            def __init__(self, cmd: list[str]):
                self.pid = 777
                self.cmd = cmd

        def fake_popen(cmd, *args, **kwargs):
            calls.append(cmd)
            return DummyProcess(cmd)

        monkeypatch.setattr("agent_swarm.agents.subprocess.Popen", fake_popen)

        agent = await manager.spawn("codex", "run --yolo migration", None, yolo=True)
        assert agent.yolo is True
        assert calls
        assert any(part == "--yolo" for part in calls[0])
