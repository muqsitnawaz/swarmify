"""Agent process manager for spawning and tracking CLI agents."""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import uuid4

from loguru import logger

from .parsers import parse_event, normalize_event


class AgentStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


AgentType = Literal["codex", "gemini", "cursor", "claude"]


AGENT_COMMANDS: dict[AgentType, list[str]] = {
    "codex": ["codex", "exec", "{prompt}", "--full-auto", "--json"],
    "cursor": ["cursor-agent", "-p", "--output-format", "stream-json", "{prompt}"],
    "gemini": ["gemini", "-p", "{prompt}", "--output-format", "stream-json"],
    "claude": ["claude", "-p", "{prompt}", "--output-format", "stream-json"],
}


@dataclass
class AgentProcess:
    """Manages a single agent subprocess."""

    agent_id: str
    agent_type: AgentType
    prompt: str
    cwd: str | None
    status: AgentStatus = AgentStatus.RUNNING
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: datetime | None = None
    events: list[dict] = field(default_factory=list)
    process: asyncio.subprocess.Process | None = None
    _read_task: asyncio.Task | None = None

    def to_dict(self) -> dict:
        """Serialize agent info for API responses."""
        return {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "status": self.status.value,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "event_count": len(self.events),
            "duration_ms": self._duration_ms(),
        }

    def _duration_ms(self) -> int | None:
        """Calculate duration in milliseconds."""
        if self.completed_at:
            return int((self.completed_at - self.started_at).total_seconds() * 1000)
        if self.status == AgentStatus.RUNNING:
            return int((datetime.now() - self.started_at).total_seconds() * 1000)
        return None


class AgentManager:
    """Manages multiple agent processes."""

    def __init__(self, max_completed: int = 20):
        self._agents: dict[str, AgentProcess] = {}
        self._max_completed = max_completed

    async def spawn(
        self,
        agent_type: AgentType,
        prompt: str,
        cwd: str | None = None,
    ) -> AgentProcess:
        """Spawn a new agent process."""
        agent_id = str(uuid4())[:8]

        if "--yolo" in prompt or prompt.strip().startswith("--yolo") or " --yolo " in prompt:
            raise ValueError(
                "Safety: --yolo flag is not allowed. This tool only supports safe automation with --full-auto."
            )

        cmd_template = AGENT_COMMANDS.get(agent_type)
        if not cmd_template:
            raise ValueError(f"Unknown agent type: {agent_type}")

        cmd = [part.replace("{prompt}", prompt) for part in cmd_template]

        if "--yolo" in cmd:
            raise ValueError(
                "Safety: --yolo flag detected in command. This is not allowed."
            )

        logger.info(f"Spawning {agent_type} agent {agent_id}: {' '.join(cmd[:3])}...")

        # Create process
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )

        agent = AgentProcess(
            agent_id=agent_id,
            agent_type=agent_type,
            prompt=prompt,
            cwd=cwd,
            process=process,
        )

        self._agents[agent_id] = agent

        # Start reading output in background
        agent._read_task = asyncio.create_task(self._read_output(agent))

        # Cleanup old completed agents
        self._cleanup_old_agents()

        return agent

    async def _read_output(self, agent: AgentProcess) -> None:
        """Read agent output stream and parse events."""
        if not agent.process or not agent.process.stdout:
            return

        try:
            async for line in agent.process.stdout:
                line = line.decode().strip()
                if not line:
                    continue

                try:
                    raw_event = json.loads(line)
                    event = normalize_event(agent.agent_type, raw_event)
                    agent.events.append(event)

                    # Check for completion events
                    if event.get("type") in ("result", "turn.completed", "thread.completed"):
                        if event.get("status") == "success" or event.get("type") == "turn.completed":
                            agent.status = AgentStatus.COMPLETED
                        elif event.get("status") == "error":
                            agent.status = AgentStatus.FAILED

                except json.JSONDecodeError:
                    # Non-JSON output, store as raw message
                    agent.events.append({
                        "type": "raw",
                        "content": line,
                        "timestamp": datetime.now().isoformat(),
                    })

        except Exception as e:
            logger.error(f"Error reading agent {agent.agent_id} output: {e}")
            agent.status = AgentStatus.FAILED
        finally:
            agent.completed_at = datetime.now()
            if agent.status == AgentStatus.RUNNING:
                # Process ended without explicit completion event
                return_code = agent.process.returncode if agent.process else -1
                agent.status = AgentStatus.COMPLETED if return_code == 0 else AgentStatus.FAILED

    def get(self, agent_id: str) -> AgentProcess | None:
        """Get agent by ID."""
        return self._agents.get(agent_id)

    def list_all(self) -> list[AgentProcess]:
        """List all agents."""
        return list(self._agents.values())

    def list_running(self) -> list[AgentProcess]:
        """List running agents."""
        return [a for a in self._agents.values() if a.status == AgentStatus.RUNNING]

    def list_completed(self) -> list[AgentProcess]:
        """List completed agents."""
        return [a for a in self._agents.values() if a.status != AgentStatus.RUNNING]

    async def stop(self, agent_id: str) -> bool:
        """Stop a running agent."""
        agent = self._agents.get(agent_id)
        if not agent:
            return False

        if agent.process and agent.status == AgentStatus.RUNNING:
            agent.process.terminate()
            try:
                await asyncio.wait_for(agent.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                agent.process.kill()

            agent.status = AgentStatus.STOPPED
            agent.completed_at = datetime.now()

            if agent._read_task:
                agent._read_task.cancel()

            logger.info(f"Stopped agent {agent_id}")
            return True

        return False

    def _cleanup_old_agents(self) -> None:
        """Remove old completed agents to free memory."""
        completed = self.list_completed()
        if len(completed) > self._max_completed:
            # Sort by completion time, remove oldest
            completed.sort(key=lambda a: a.completed_at or datetime.min)
            for agent in completed[: len(completed) - self._max_completed]:
                del self._agents[agent.agent_id]
                logger.debug(f"Cleaned up old agent {agent.agent_id}")
