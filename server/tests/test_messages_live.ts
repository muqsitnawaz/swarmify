/**
 * Live test to verify last_messages output from status.
 * Run with: bun run tests/test_messages_live.ts
 */

import { AgentManager, checkCliAvailable } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop } from '../src/api.js';

async function main() {
  const [available] = checkCliAvailable('gemini');
  if (!available) {
    console.log('Gemini CLI not installed, skipping');
    process.exit(0);
  }

  const manager = new AgentManager(50, 10, null, null, null, 7);
  const taskName = `msg-test-${Date.now()}`;

  console.log('Spawning gemini agent...');
  const spawn = await handleSpawn(
    manager,
    taskName,
    'gemini',
    'Read the file /Users/muqsit/src/github.com/muqsitnawaz/CursorAgents/swarm/src/summarizer.ts and tell me what the getLastMessages function does in 2-3 sentences.',
    null,
    'plan',
    null
  );
  console.log('Spawned:', spawn.agent_id);

  // Poll until done
  let done = false;
  let iterations = 0;
  while (!done && iterations < 60) {
    iterations++;
    await new Promise(r => setTimeout(r, 2000));

    const status = await handleStatus(manager, taskName);
    const agent = status.agents[0];

    console.log(`\n[Poll ${iterations}] Status: ${agent.status}`);

    if (agent.status !== 'running') {
      done = true;
      console.log('\n=== FINAL STATUS ===');
      console.log('Duration:', agent.duration);
      console.log('Tool count:', agent.tool_count);
      console.log('Files read:', agent.files_read);
      console.log('Has errors:', agent.has_errors);
      console.log('\n=== LAST MESSAGES ===');
      for (let i = 0; i < agent.last_messages.length; i++) {
        console.log(`\n--- Message ${i + 1} ---`);
        console.log(agent.last_messages[i]);
      }
    }
  }

  // Cleanup
  await handleStop(manager, taskName);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
