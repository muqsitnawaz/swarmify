import { spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', 'dist', 'index.js');

async function main() {
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  let seenToolsList = false;
  let effortEnum: string[] = [];
  let modeEnum: string[] = [];

  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && msg.result?.tools) {
        seenToolsList = true;
        const spawnTool = msg.result.tools.find((t: any) => t.name === 'Spawn');
        effortEnum = spawnTool?.inputSchema?.properties?.effort?.enum ?? [];
        modeEnum = spawnTool?.inputSchema?.properties?.mode?.enum ?? [];
        console.log('SPAWN TOOL SCHEMA:');
        console.log('  mode enum:', modeEnum);
        console.log('  effort enum:', effortEnum);
        console.log('  description contains "DEPRECATED":', String(spawnTool?.description).includes('DEPRECATED'));
      }
    } catch {}
  });

  proc.stdin!.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-test', version: '0.0.1' } }
  }) + '\n');

  await new Promise((r) => setTimeout(r, 500));

  proc.stdin!.write(JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'tools/list'
  }) + '\n');

  await new Promise((r) => setTimeout(r, 1500));

  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));

  if (!seenToolsList) {
    console.error('FAIL: did not receive tools/list response');
    process.exit(1);
  }

  const expectedEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
  const expectedModes = ['plan', 'edit', 'cloud', 'ralph'];
  const effortOk = expectedEfforts.every((e) => effortEnum.includes(e));
  const modeOk = expectedModes.every((m) => modeEnum.includes(m));

  if (!effortOk) {
    console.error(`FAIL: effort enum missing values. Got: ${JSON.stringify(effortEnum)}`);
    process.exit(1);
  }
  if (!modeOk) {
    console.error(`FAIL: mode enum missing values. Got: ${JSON.stringify(modeEnum)}`);
    process.exit(1);
  }

  console.log('PASS: MCP handshake + tools/list + schema shapes OK');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(2);
});
