def main():
    """Entry point for the agent-swarm CLI."""
    from .server import main as server_main

    return server_main()


__all__ = ["main"]
