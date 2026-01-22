import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentManager, checkCliAvailable } from '../src/agents.js';
import { handleSpawn, handleStatus } from '../src/api.js';

async function main() {
  const [geminiAvailable, geminiPathOrError] = checkCliAvailable('gemini');
  if (!geminiAvailable) {
    console.log('Gemini not available:', geminiPathOrError);
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'gemini-debug-'));
  console.log('Temp dir:', tempDir);

  const manager = new AgentManager(50, 10, tempDir);
  const prompt = 'Run echo hello world';

  console.log('Spawning agent...');
  const spawnResult = await handleSpawn(manager, 'test-debug', 'gemini', prompt, null, 'edit', null);
  console.log('Spawned:', spawnResult.agent_id);

  // Wait for completion
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await handleStatus(manager, 'test-debug', 'all');
    const agent = result.agents.find(a => a.agent_id === spawnResult.agent_id);
    const bashStr = JSON.stringify(agent?.bash_commands);
    console.log('Poll ' + i + ': status=' + agent?.status + ', bash_commands=' + bashStr);
    if (agent?.status !== 'running') {
      break;
    }
  }

  // Read stdout.log
  const agentDir = join(tempDir, spawnResult.agent_id);
  const stdoutPath = join(agentDir, 'stdout.log');
  console.log('\n=== stdout.log contents ===');
  try {
    const content = readFileSync(stdoutPath, 'utf-8');
    console.log(content);
  } catch (e) {
    console.log('Could not read stdout.log:', e);
  }

  console.log('\nTemp dir (not cleaned):', tempDir);
}

main().catch(console.error);
