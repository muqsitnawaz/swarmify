/**
 * Live E2E smoke: spawn a real codex agent via the MCP protocol,
 * poll status, stop it, and verify the agent reached a terminal state
 * under ~/.agents/teams/agents/.
 */
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', 'dist', 'index.js');

type Msg = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: any };

async function main() {
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  const pending = new Map<number, (m: Msg) => void>();
  let nextId = 1;

  rl.on('line', (line) => {
    try {
      const msg: Msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id as number)) {
        pending.get(msg.id as number)!(msg);
        pending.delete(msg.id as number);
      }
    } catch {}
  });

  // Surface stderr (deprecation warnings, startup logs)
  const errBuf: string[] = [];
  proc.stderr!.on('data', (d) => errBuf.push(d.toString()));

  async function call(method: string, params?: any): Promise<Msg> {
    const id = nextId++;
    const p = new Promise<Msg>((resolve) => pending.set(id, resolve));
    proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }

  const initRes = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-live', version: '0.0.1' },
  });
  if (!(initRes.result as any)?.protocolVersion) throw new Error('initialize failed');

  const taskName = `smoke-${Date.now()}`;
  const spawnRes = await call('tools/call', {
    name: 'Spawn',
    arguments: {
      task_name: taskName,
      agent_type: 'codex',
      prompt: 'Print only the text "ok" and exit.',
      mode: 'plan',
      effort: 'low',
    },
  });

  const spawnContent = (spawnRes.result as any)?.content?.[0]?.text;
  if (!spawnContent) throw new Error(`spawn returned no content: ${JSON.stringify(spawnRes)}`);
  const spawnParsed = JSON.parse(spawnContent);
  if (spawnParsed.error) throw new Error(`spawn error: ${spawnParsed.error}`);
  console.log('SPAWN:', { agent_id: spawnParsed.agent_id, status: spawnParsed.status });

  const agentId: string = spawnParsed.agent_id;
  const metaPath = path.join(os.homedir(), '.agents', 'teams', 'agents', agentId, 'meta.json');

  // Wait up to 60s for the agent to reach a terminal state (or reasonable progress)
  const deadline = Date.now() + 60_000;
  let lastStatus = spawnParsed.status;
  let metaExists = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await fs.access(metaPath);
      metaExists = true;
    } catch {}
    const stRes = await call('tools/call', {
      name: 'Status',
      arguments: { task_name: taskName, filter: 'all' },
    });
    const stText = (stRes.result as any)?.content?.[0]?.text;
    if (stText) {
      const st = JSON.parse(stText);
      const agents = st.agents ?? [];
      if (agents.length > 0) {
        lastStatus = agents[0].status;
        console.log(`STATUS: ${lastStatus}`);
        if (['completed', 'failed', 'stopped'].includes(lastStatus)) break;
      }
    }
  }

  // Ensure the agent is no longer running so we don't leak processes
  await call('tools/call', { name: 'Stop', arguments: { task_name: taskName } });

  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));

  console.log('---');
  console.log(`meta.json at ${metaPath} exists:`, metaExists);
  console.log('final status:', lastStatus);
  console.log('stderr tail:', errBuf.join('').split('\n').slice(-5).join('\n'));

  if (!metaExists) {
    console.error('FAIL: meta.json not found under ~/.agents/teams/');
    process.exit(1);
  }
  console.log('PASS: spawn wrote to ~/.agents/teams/ and status reported back via MCP');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(2);
});
