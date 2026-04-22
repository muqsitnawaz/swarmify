/**
 * Verify mode='ralph' emits the deprecation warning on stderr.
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
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-smoke-'));
  await fs.writeFile(path.join(workDir, 'RALPH.md'), '## [ ] do nothing\n\n### Updates\n');

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

  let stderr = '';
  proc.stderr!.on('data', (d) => (stderr += d.toString()));

  async function call(method: string, params?: any): Promise<Msg> {
    const id = nextId++;
    const p = new Promise<Msg>((resolve) => pending.set(id, resolve));
    proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }

  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ralph-smoke', version: '0.0.1' },
  });

  const taskName = `ralph-smoke-${Date.now()}`;
  const res = await call('tools/call', {
    name: 'Spawn',
    arguments: {
      task_name: taskName,
      agent_type: 'codex',
      prompt: 'print ok',
      mode: 'ralph',
      cwd: workDir,
      effort: 'low',
    },
  });

  const content = JSON.parse((res.result as any).content[0].text);
  await call('tools/call', { name: 'Stop', arguments: { task_name: taskName } });
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));

  console.log('spawn result agent_id:', content.agent_id, 'status:', content.status);
  const warned = stderr.includes('ralph mode is deprecated');
  console.log('deprecation warning present on stderr:', warned);
  console.log('stderr sample:', stderr.split('\n').filter(l => l.includes('ralph') || l.includes('DEPRECAT')).join('\n'));

  await fs.rm(workDir, { recursive: true, force: true });

  if (!warned) {
    console.error('FAIL: deprecation warning not observed');
    process.exit(1);
  }
  if (!content.agent_id) {
    console.error('FAIL: ralph spawn did not return agent_id');
    process.exit(1);
  }
  console.log('PASS: ralph still works but emits deprecation warning');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(2);
});
