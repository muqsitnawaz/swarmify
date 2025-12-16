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
from agent_swarm.server import handle_read_agent_output, handle_watch_agent, handle_watch_agent

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
        print("Monitoring events in real-time:")
        print("")
        
        max_wait = 300
        waited = 0
        check_interval = 2
        last_event_count = 0
        
        while waited < max_wait:
            await asyncio.sleep(check_interval)
            waited += check_interval
            
            agent = manager.get(agent_id)
            if not agent:
                print(f"✗ Agent {agent_id} not found!")
                sys.exit(1)
            
            agent.update_status_from_process()
            
            # Watch for new events
            watch_result = await handle_watch_agent(
                agent_id=agent_id,
                since_event=last_event_count,
                include_raw=False
            )
            
            new_events = watch_result.get("events", [])
            if new_events:
                print(f"[{waited}s] New events ({len(new_events)}):")
                for event in new_events:
                    event_type = event.get("type", "unknown")
                    if event_type == "message":
                        content = event.get("content", "")
                        preview = content[:150] + "..." if len(content) > 150 else content
                        print(f"  📝 MESSAGE: {preview}")
                    elif event_type == "file_write":
                        print(f"  ✏️  FILE_WRITE: {event.get('path', 'unknown')}")
                    elif event_type == "file_read":
                        print(f"  👁️  FILE_READ: {event.get('path', 'unknown')}")
                    elif event_type == "bash":
                        cmd = event.get("command", "")
                        preview = cmd[:80] + "..." if len(cmd) > 80 else cmd
                        print(f"  💻 BASH: {preview}")
                    elif event_type == "tool_use":
                        print(f"  🔧 TOOL: {event.get('tool', 'unknown')}")
                    elif event_type == "error":
                        print(f"  ❌ ERROR: {event.get('message', event.get('content', 'unknown'))}")
                    elif event_type == "result":
                        print(f"  ✅ RESULT: {event.get('status', 'unknown')}")
                    else:
                        print(f"  📌 {event_type.upper()}: {str(event)[:100]}")
                print("")
            
            last_event_count = watch_result.get("current_event_count", 0)
            
            if agent.status.value != "running":
                break
            
            if waited % 10 == 0 and not new_events:
                print(f"  Still running... ({waited}s, {last_event_count} events so far)")
        
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
        print("WHAT THE LLM WILL SEE - EVENTS FORMAT:")
        print("=" * 80)
        print("(This is what read_agent_output returns with format='events')")
        print("")
        result = await handle_read_agent_output(
            agent_id=agent_id,
            format="events",
            detail_level="detailed",
            since_event=0
        )
        
        events = result.get("events", [])
        message_events = [e for e in events if e.get("type") == "message"]
        
        print(f"Total events that will be sent to LLM: {len(events)}")
        print(f"Message events: {len(message_events)}")
        print("")
        
        if message_events:
            print("Full message events (as LLM will see them):")
            for i, msg_event in enumerate(message_events, 1):
                content = msg_event.get("content", "")
                is_complete = msg_event.get("complete", False)
                print(f"\n  Message {i} (Complete: {is_complete}, Length: {len(content)} chars):")
                print(f"  {'-' * 76}")
                print(f"  {content}")
                print(f"  {'-' * 76}")
            print("")
            
            last_message = message_events[-1].get("content", "")
            if len(last_message) > 100:
                print("✓ Full message preserved (not truncated)")
            else:
                print("⚠ Message is short (may be truncated or naturally short)")
        else:
            print("⚠ No message events found!")
        
        print("")
        print("Sample of other events LLM will see:")
        other_events = [e for e in events if e.get("type") != "message"][:5]
        for event in other_events:
            event_type = event.get("type", "unknown")
            if event_type == "file_write":
                print(f"  ✏️  FILE_WRITE: {event.get('path', 'unknown')}")
            elif event_type == "bash":
                cmd = event.get("command", "")
                preview = cmd[:80] + "..." if len(cmd) > 80 else cmd
                print(f"  💻 BASH: {preview}")
            elif event_type == "tool_use":
                print(f"  🔧 TOOL: {event.get('tool', 'unknown')}")
            else:
                print(f"  📌 {event_type.upper()}")
        
        print("")
        print("=" * 80)
        print("WHAT THE LLM WILL SEE - SUMMARY FORMAT (default):")
        print("=" * 80)
        print("(This is what read_agent_output returns with format='summary', detail_level='brief')")
        print("")
        summary_result = await handle_read_agent_output(
            agent_id=agent_id,
            format="summary",
            detail_level="brief",
            since_event=0
        )
        print(json.dumps(summary_result, indent=2))
        print("")
        
        if summary_result.get("final_message"):
            final_msg = summary_result["final_message"]
            print(f"Final message in summary: {len(final_msg)} chars")
            print(f"Preview: {final_msg[:200]}...")
            if len(final_msg) > 100:
                print("✓ Final message preserved in summary")
            else:
                print("⚠ Final message may be truncated")
        
        print("")
        print("=" * 80)
        print("TEST COMPLETE")
        print("=" * 80)
        print("")
        print("Summary:")
        print(f"  - Agent: {agent_id}")
        print(f"  - Status: {agent.status.value}")
        print(f"  - Total events: {len(events)}")
        print(f"  - Messages: {len(message_events)}")
        print(f"  - Full messages preserved: {'✓ Yes' if message_events and len(message_events[-1].get('content', '')) > 100 else '⚠ Check above'}")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_agent())
EOF
