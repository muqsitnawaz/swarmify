"""Agent process manager for spawning and tracking CLI agents.

Uses a persistent architecture that survives MCP server restarts:
- Agents run as detached processes (separate process group)
- Metadata and output stored in ~/.claude/agent-swarm/agents/{agent_id}/ by default
- On restart, manager scans for existing agents and reconnects
"""

import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Literal
from uuid import uuid4

from loguru import logger

from .parsers import normalize_event


def _is_writable(directory: Path) -> bool:
    """Check whether a directory is writable, creating it if needed."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".write_test"
        probe.touch()
        probe.unlink()
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"Agent storage path {directory} is not writable: {exc}")
        return False


def _resolve_agents_dir() -> Path:
    """Resolve a writable agents directory.

    Prefers ~/.claude/agent-swarm/agents/, falling back to alternatives that
    are writable in restricted environments (e.g., sandboxes or CI).
    Override with AGENT_SWARM_DIR env var if needed.
    """
    env_dir = os.environ.get("AGENT_SWARM_DIR")
    if env_dir:
        env_path = Path(env_dir).expanduser()
        if _is_writable(env_path):
            return env_path
        logger.warning(f"AGENT_SWARM_DIR is not writable: {env_path}")

    canonical = Path.home() / ".claude" / "agent-swarm" / "agents"
    candidates = [
        canonical,
        Path.home() / ".agent-swarm" / "agents",
    ]

    xdg_state_home = os.environ.get("XDG_STATE_HOME")
    if xdg_state_home:
        candidates.append(Path(xdg_state_home) / "agent-swarm" / "agents")

    candidates.extend([
        Path.cwd() / ".agent-swarm" / "agents",
        Path(tempfile.gettempdir()) / "agent-swarm" / "agents",
    ])

    for candidate in candidates:
        if _is_writable(candidate):
            if candidate != canonical:
                logger.info(f"Falling back to agent storage at {candidate}")
            return candidate
        logger.debug(f"Agent storage candidate not writable: {candidate}")

    tried = ", ".join(str(c) for c in candidates)
    raise RuntimeError(f"Unable to find a writable agent storage directory. Tried: {tried}")


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


def check_cli_available(agent_type: AgentType) -> tuple[bool, str | None]:
    """Check if the CLI tool for an agent type is available.

    Returns (is_available, path_or_error_message).
    """
    cmd_template = AGENT_COMMANDS.get(agent_type)
    if not cmd_template:
        return False, f"Unknown agent type: {agent_type}"

    executable = cmd_template[0]
    path = shutil.which(executable)

    if path:
        return True, path
    else:
        return False, f"CLI tool '{executable}' not found in PATH. Install it first."


def check_all_clis() -> dict[str, dict]:
    """Check availability of all supported CLI agents.

    Returns dict with agent type as key and {installed, path, error} as value.
    """
    results = {}
    for agent_type in AGENT_COMMANDS:
        available, path_or_error = check_cli_available(agent_type)
        if available:
            results[agent_type] = {"installed": True, "path": path_or_error, "error": None}
        else:
            results[agent_type] = {"installed": False, "path": None, "error": path_or_error}
    return results

# Base directory for agent data
AGENTS_DIR = _resolve_agents_dir()


@dataclass
class AgentProcess:
    """Manages a single agent subprocess."""

    agent_id: str
    agent_type: AgentType
    prompt: str
    cwd: str | None
    yolo: bool = False
    pid: int | None = None
    status: AgentStatus = AgentStatus.RUNNING
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: datetime | None = None
    _events_cache: list[dict] = field(default_factory=list)
    _last_read_pos: int = 0
    _base_dir: Path | None = None  # If None, uses AGENTS_DIR

    @property
    def agent_dir(self) -> Path:
        """Directory for this agent's data."""
        base = self._base_dir if self._base_dir else AGENTS_DIR
        return base / self.agent_id

    @property
    def stdout_path(self) -> Path:
        """Path to stdout log file."""
        return self.agent_dir / "stdout.log"

    @property
    def meta_path(self) -> Path:
        """Path to metadata file."""
        return self.agent_dir / "meta.json"

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
            "mode": "yolo" if self.yolo else "safe",
            "yolo": self.yolo,
        }

    def _duration_ms(self) -> int | None:
        """Calculate duration in milliseconds."""
        if self.completed_at:
            return int((self.completed_at - self.started_at).total_seconds() * 1000)
        if self.status == AgentStatus.RUNNING:
            return int((datetime.now() - self.started_at).total_seconds() * 1000)
        return None

    @property
    def events(self) -> list[dict]:
        """Get events, reading from file if needed."""
        self._read_new_events()
        return self._events_cache

    def _read_new_events(self) -> None:
        """Read new events from stdout file."""
        if not self.stdout_path.exists():
            return

        try:
            with open(self.stdout_path, "r") as f:
                f.seek(self._last_read_pos)
                new_content = f.read()
                self._last_read_pos = f.tell()

            if not new_content:
                return

            for line in new_content.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue

                try:
                    raw_event = json.loads(line)
                    event = normalize_event(self.agent_type, raw_event)
                    self._events_cache.append(event)

                    # Check for completion events
                    if event.get("type") in ("result", "turn.completed", "thread.completed"):
                        if event.get("status") == "success" or event.get("type") == "turn.completed":
                            self.status = AgentStatus.COMPLETED
                            self.completed_at = datetime.now()
                        elif event.get("status") == "error":
                            self.status = AgentStatus.FAILED
                            self.completed_at = datetime.now()

                except json.JSONDecodeError:
                    self._events_cache.append({
                        "type": "raw",
                        "content": line,
                        "timestamp": datetime.now().isoformat(),
                    })

        except Exception as e:
            logger.error(f"Error reading events for agent {self.agent_id}: {e}")

    def save_meta(self) -> None:
        """Save agent metadata to disk."""
        self.agent_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "prompt": self.prompt,
            "cwd": self.cwd,
            "yolo": self.yolo,
            "pid": self.pid,
            "status": self.status.value,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
        with open(self.meta_path, "w") as f:
            json.dump(meta, f, indent=2)

    @classmethod
    def load_from_disk(cls, agent_id: str, base_dir: Path | None = None) -> "AgentProcess | None":
        """Load agent from disk."""
        base = base_dir if base_dir else AGENTS_DIR
        agent_dir = base / agent_id
        meta_path = agent_dir / "meta.json"

        if not meta_path.exists():
            return None

        try:
            with open(meta_path) as f:
                meta = json.load(f)

            agent = cls(
                agent_id=meta["agent_id"],
                agent_type=meta["agent_type"],
                prompt=meta["prompt"],
                cwd=meta.get("cwd"),
                yolo=meta.get("yolo", False),
                pid=meta.get("pid"),
                status=AgentStatus(meta["status"]),
                started_at=datetime.fromisoformat(meta["started_at"]),
                completed_at=datetime.fromisoformat(meta["completed_at"]) if meta.get("completed_at") else None,
                _base_dir=base_dir,
            )
            return agent
        except Exception as e:
            logger.error(f"Error loading agent {agent_id}: {e}")
            return None

    def is_process_alive(self) -> bool:
        """Check if the agent process is still running."""
        if not self.pid:
            return False
        try:
            os.kill(self.pid, 0)  # Signal 0 = check if process exists
            return True
        except OSError:
            return False

    def update_status_from_process(self) -> None:
        """Update status based on process state."""
        if self.status != AgentStatus.RUNNING:
            return

        # Only check process status if we have a PID
        if self.pid is None:
            return

        if not self.is_process_alive():
            # Process finished - read remaining events to determine final status
            self._read_new_events()
            if self.status == AgentStatus.RUNNING:
                # No completion event found, assume completed
                self.status = AgentStatus.COMPLETED
                self.completed_at = datetime.now()
            self.save_meta()


class AgentManager:
    """Manages multiple agent processes with persistence."""

    def __init__(self, max_agents: int = 50, agents_dir: Path | None = None):
        self._agents: dict[str, AgentProcess] = {}
        self._max_agents = max_agents
        self._agents_dir = agents_dir or AGENTS_DIR

        # Ensure agents directory exists
        self._agents_dir.mkdir(parents=True, exist_ok=True)

        # Load existing agents from disk
        self._load_existing_agents()

    def _load_existing_agents(self) -> None:
        """Scan disk for existing agents and load them."""
        if not self._agents_dir.exists():
            return

        for agent_dir in self._agents_dir.iterdir():
            if not agent_dir.is_dir():
                continue

            agent_id = agent_dir.name
            agent = AgentProcess.load_from_disk(agent_id, base_dir=self._agents_dir)
            if agent:
                # Update status from process
                agent.update_status_from_process()
                self._agents[agent_id] = agent
                logger.info(f"Restored agent {agent_id} (status: {agent.status.value})")

        logger.info(f"Loaded {len(self._agents)} agents from disk")

    async def spawn(
        self,
        agent_type: AgentType,
        prompt: str,
        cwd: str | None = None,
        yolo: bool = False,
    ) -> AgentProcess:
        """Spawn a new agent process (detached, survives server restart)."""
        # Validate CLI tool is available
        available, path_or_error = check_cli_available(agent_type)
        if not available:
            raise ValueError(path_or_error)

        # Validate working directory
        if cwd is not None:
            cwd_path = Path(cwd)
            if not cwd_path.exists():
                raise ValueError(f"Working directory does not exist: {cwd}")
            if not cwd_path.is_dir():
                raise ValueError(f"Working directory is not a directory: {cwd}")

        agent_id = str(uuid4())[:8]

        cmd = self._build_command(agent_type, prompt, yolo)

        # Create agent object
        agent = AgentProcess(
            agent_id=agent_id,
            agent_type=agent_type,
            prompt=prompt,
            cwd=cwd,
            yolo=yolo,
            _base_dir=self._agents_dir,
        )

        # Create agent directory
        agent.agent_dir.mkdir(parents=True, exist_ok=True)

        mode_label = "yolo" if yolo else "safe"
        logger.info(f"Spawning {agent_type} agent {agent_id} [{mode_label}]: {' '.join(cmd[:3])}...")

        # Spawn detached process with stdout redirected to file
        # Use context manager to ensure file descriptor is properly closed after Popen inherits it
        with open(agent.stdout_path, "w") as stdout_file:
            process = subprocess.Popen(
                cmd,
                stdout=stdout_file,
                stderr=subprocess.STDOUT,
                cwd=cwd,
                start_new_session=True,  # Detach from parent process group
            )
            # File descriptor is inherited by subprocess, safe to close after Popen returns

        agent.pid = process.pid
        agent.save_meta()

        self._agents[agent_id] = agent

        # Cleanup old agents
        self._cleanup_old_agents()

        logger.info(f"Spawned agent {agent_id} with PID {process.pid}")
        return agent

    def _build_command(self, agent_type: AgentType, prompt: str, yolo: bool) -> list[str]:
        """Build an agent command, applying safety or yolo overrides."""
        cmd_template = AGENT_COMMANDS.get(agent_type)
        if not cmd_template:
            raise ValueError(f"Unknown agent type: {agent_type}")

        if not yolo and self._prompt_has_yolo_flag(prompt):
            raise ValueError(
                "Safety: --yolo flag requires explicit yolo=True (default mode is --full-auto)."
            )

        cmd = [part.replace("{prompt}", prompt) for part in cmd_template]

        if yolo:
            cmd = self._apply_yolo_mode(agent_type, cmd)
        elif "--yolo" in cmd:
            raise ValueError(
                "Safety: --yolo flag detected in command. Enable yolo=True to run in unsafe mode."
            )

        return cmd

    @staticmethod
    def _prompt_has_yolo_flag(prompt: str) -> bool:
        """Detect attempts to inject the --yolo flag directly in the prompt."""
        normalized = prompt.lower()
        return bool(re.search(r"(^|\s)--\s*yolo(\s|$|[^\w-])", normalized))

    @staticmethod
    def _apply_yolo_mode(agent_type: AgentType, cmd: list[str]) -> list[str]:
        """Swap safe automation flags for yolo mode where supported."""
        replaced = False
        yolo_cmd: list[str] = []

        for part in cmd:
            if part == "--full-auto":
                yolo_cmd.append("--yolo")
                replaced = True
            else:
                yolo_cmd.append(part)

        # Only append --yolo for codex to avoid passing unknown flags to other CLIs.
        if not replaced and agent_type == "codex":
            yolo_cmd.append("--yolo")

        return yolo_cmd

    def get(self, agent_id: str) -> AgentProcess | None:
        """Get agent by ID, updating status if needed."""
        agent = self._agents.get(agent_id)
        if agent:
            agent.update_status_from_process()
        return agent

    def list_all(self) -> list[AgentProcess]:
        """List all agents, updating statuses."""
        for agent in self._agents.values():
            agent.update_status_from_process()
        return list(self._agents.values())

    def list_running(self) -> list[AgentProcess]:
        """List running agents."""
        return [a for a in self.list_all() if a.status == AgentStatus.RUNNING]

    def list_completed(self) -> list[AgentProcess]:
        """List completed agents."""
        return [a for a in self.list_all() if a.status != AgentStatus.RUNNING]

    async def stop(self, agent_id: str) -> bool:
        """Stop a running agent."""
        agent = self._agents.get(agent_id)
        if not agent:
            return False

        if agent.pid and agent.status == AgentStatus.RUNNING:
            try:
                # Send SIGTERM to process group
                os.killpg(os.getpgid(agent.pid), signal.SIGTERM)
                logger.info(f"Sent SIGTERM to agent {agent_id} (PID {agent.pid})")

                # Wait a bit then force kill if needed
                await asyncio.sleep(2)
                if agent.is_process_alive():
                    os.killpg(os.getpgid(agent.pid), signal.SIGKILL)
                    logger.info(f"Sent SIGKILL to agent {agent_id}")

            except ProcessLookupError:
                pass  # Process already dead

            agent.status = AgentStatus.STOPPED
            agent.completed_at = datetime.now()
            agent.save_meta()
            logger.info(f"Stopped agent {agent_id}")
            return True

        return False

    def _cleanup_old_agents(self) -> None:
        """Remove old completed agents to free space."""
        completed = self.list_completed()
        if len(completed) > self._max_agents:
            # Sort by completion time, remove oldest
            completed.sort(key=lambda a: a.completed_at or datetime.min)
            for agent in completed[: len(completed) - self._max_agents]:
                # Remove from memory
                del self._agents[agent.agent_id]
                # Remove from disk
                import shutil
                if agent.agent_dir.exists():
                    shutil.rmtree(agent.agent_dir)
                logger.debug(f"Cleaned up old agent {agent.agent_id}")
