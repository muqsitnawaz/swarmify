#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_TYPE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --agent)
            AGENT_TYPE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 --agent <codex|cursor|gemini>"
            exit 1
            ;;
    esac
done

if [[ -z "$AGENT_TYPE" ]]; then
    echo "Error: --agent argument is required"
    echo "Usage: $0 --agent <codex|cursor|gemini>"
    exit 1
fi

if [[ ! "$AGENT_TYPE" =~ ^(codex|cursor|gemini)$ ]]; then
    echo "Error: --agent must be one of: codex, cursor, gemini"
    exit 1
fi

cd "$PROJECT_DIR"

echo "Testing agent-swarm with agent type: $AGENT_TYPE"
echo "Spawning agent to count lines in README.md..."
echo ""

python3 << EOF
import asyncio
import json
import sys
from pathlib import Path

project_dir = Path("$PROJECT_DIR")
sys.path.insert(0, str(project_dir / "src"))

from agent_swarm.agents import AgentManager
from agent_swarm.server import handle_read_agent_output

async def test_agent():
    manager = AgentManager()
    
    prompt = "Count the number of lines in the README.md file in the current directory and report the result."
    cwd = str(Path.cwd())
    
    print(f"Prompt: {prompt}")
    print(f"Working directory: {cwd}")
    print("")
    
    try:
        agent_type = "$AGENT_TYPE"
        agent = await manager.spawn(agent_type, prompt, cwd)
        agent_id = agent.agent_id
        print(f"✓ Spawned agent: {agent_id}")
        print(f"  PID: {agent.pid}")
        print("")
        
        print("Waiting for agent to complete...")
        max_wait = 300
        waited = 0
        check_interval = 2
        
        while waited < max_wait:
            await asyncio.sleep(check_interval)
            waited += check_interval
            
            agent = manager.get(agent_id)
            if not agent:
                print(f"✗ Agent {agent_id} not found!")
                sys.exit(1)
            
            agent.update_status_from_process()
            
            if agent.status.value != "running":
                break
            
            if waited % 10 == 0:
                print(f"  Still running... ({waited}s)")
        
        agent = manager.get(agent_id)
        if not agent:
            print(f"✗ Agent {agent_id} not found after completion!")
            sys.exit(1)
        agent.update_status_from_process()
        
        print(f"✓ Agent completed with status: {agent.status.value}")
        print("")
        
        print("Reading agent output in events format...")
        result = await handle_read_agent_output(
            agent_id=agent_id,
            format="events",
            detail_level="detailed",
            since_event=0
        )
        
        print("")
        print("=" * 80)
        print("EVENTS OUTPUT:")
        print("=" * 80)
        print(json.dumps(result, indent=2))
        print("")
        
        events = result.get("events", [])
        message_events = [e for e in events if e.get("type") == "message"]
        
        print("=" * 80)
        print("VERIFICATION:")
        print("=" * 80)
        print(f"Total events: {len(events)}")
        print(f"Message events: {len(message_events)}")
        print("")
        
        if message_events:
            print("Message events found:")
            for i, msg_event in enumerate(message_events, 1):
                content = msg_event.get("content", "")
                is_complete = msg_event.get("complete", False)
                print(f"  {i}. Complete: {is_complete}, Length: {len(content)} chars")
                if content:
                    preview = content[:100] + "..." if len(content) > 100 else content
                    print(f"     Preview: {preview}")
            print("")
            
            last_message = message_events[-1].get("content", "")
            if len(last_message) > 100:
                print("✓ Full message preserved (not truncated)")
            else:
                print("⚠ Message is short (may be truncated or naturally short)")
        else:
            print("⚠ No message events found!")
        
        print("")
        print("=" * 80)
        print("SUMMARY OUTPUT:")
        print("=" * 80)
        summary_result = await handle_read_agent_output(
            agent_id=agent_id,
            format="summary",
            detail_level="standard",
            since_event=0
        )
        print(json.dumps(summary_result, indent=2))
        print("")
        
        if summary_result.get("final_message"):
            final_msg = summary_result["final_message"]
            print(f"Final message length: {len(final_msg)} chars")
            if len(final_msg) > 100:
                print("✓ Final message preserved in summary")
            else:
                print("⚠ Final message may be truncated")
        
        print("")
        print("=" * 80)
        print("TEST COMPLETE")
        print("=" * 80)
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_agent())
EOF
