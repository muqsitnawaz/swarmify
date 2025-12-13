"""Tests for safety features - ensuring dangerous flags cannot be enabled."""

import pytest
from agent_spawner.agents import AgentManager


@pytest.mark.asyncio
class TestYoloSafety:
    """Test that --yolo flag cannot be enabled."""

    @pytest.fixture
    def manager(self):
        """Create a fresh AgentManager for each test."""
        return AgentManager()

    async def test_yolo_in_prompt_rejected(self, manager):
        """Test that prompts containing --yolo are rejected."""
        with pytest.raises(ValueError, match="--yolo flag is not allowed"):
            await manager.spawn("codex", "fix bug --yolo", None)

    async def test_yolo_at_start_rejected(self, manager):
        """Test that prompts starting with --yolo are rejected."""
        with pytest.raises(ValueError, match="--yolo flag is not allowed"):
            await manager.spawn("codex", "--yolo deploy everything", None)

    async def test_yolo_with_spaces_rejected(self, manager):
        """Test that --yolo with spaces around it is rejected."""
        with pytest.raises(ValueError, match="--yolo flag is not allowed"):
            await manager.spawn("codex", "deploy --yolo everything", None)

    async def test_yolo_not_in_command_template(self):
        """Test that command templates don't include --yolo."""
        from agent_spawner.agents import AGENT_COMMANDS

        for agent_type, cmd_template in AGENT_COMMANDS.items():
            cmd_str = " ".join(cmd_template)
            assert "--yolo" not in cmd_str, f"{agent_type} command template contains --yolo"

    async def test_codex_uses_full_auto_not_yolo(self):
        """Test that Codex command uses --full-auto, not --yolo."""
        from agent_spawner.agents import AGENT_COMMANDS

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
