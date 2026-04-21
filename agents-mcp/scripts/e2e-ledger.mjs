#!/usr/bin/env node
/**
 * Live e2e probe for the 4 Ledger MCP tools. Spawns the server, does the
 * MCP initialize handshake, calls each tool with a unique team_id against a
 * temp root, and asserts the tool returned the expected shape.
 *
 * Run: node scripts/e2e-ledger.mjs
 * Exit: 0 on success, 1 on any assertion failure.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'dist', 'index.js');

// We want the Ledger to point to a scratch root so this doesn't pollute ~/.agents/ledger.
// LocalDiskLedger falls back to HOME/.agents/ledger, so we override HOME for the child.
const scratchHome = mkdtempSync(join(tmpdir(), 'mcp-e2e-home-'));
const teamId = `e2e-${Date.now()}`;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

const proc = spawn('node', [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, HOME: scratchHome },
});

const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
let nextId = 1;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  } catch {}
});

proc.stderr.on('data', (d) => {
  const s = d.toString();
  if (process.env.E2E_DEBUG) process.stderr.write(`[srv] ${s}`);
});

function call(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  proc.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }
    }, 10000);
  });
}

async function main() {
  // Initialize handshake.
  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e-probe', version: '0.0.1' },
  });
  if (!init.result?.serverInfo) fail('no serverInfo in initialize response');

  // List tools — make sure our 4 Ledger tools are there.
  const list = await call('tools/list', {});
  const toolNames = new Set((list.result?.tools ?? []).map((t) => t.name));
  for (const expected of ['LedgerRead', 'LedgerRecent', 'LedgerSearch', 'LedgerNote']) {
    if (!toolNames.has(expected)) fail(`tools/list missing ${expected}`);
  }

  // LedgerNote → expect {ok: true}
  const noteRes = await call('tools/call', {
    name: 'LedgerNote',
    arguments: { team_id: teamId, task_id: 'task1', teammate: 'alice', text: 'hello from e2e' },
  });
  const noteBody = JSON.parse(noteRes.result?.content?.[0]?.text ?? '{}');
  if (!noteBody.ok) fail(`LedgerNote did not return ok=true, got ${JSON.stringify(noteBody)}`);

  // LedgerRead (notes) → expect one artifact with our text
  const readRes = await call('tools/call', {
    name: 'LedgerRead',
    arguments: { team_id: teamId, task_id: 'task1', kind: 'notes' },
  });
  const readBody = JSON.parse(readRes.result?.content?.[0]?.text ?? '{}');
  if (!readBody.artifacts?.[0]?.content?.includes('hello from e2e')) {
    fail(`LedgerRead did not surface the note, got ${JSON.stringify(readBody)}`);
  }

  // LedgerSearch → find "e2e"
  const searchRes = await call('tools/call', {
    name: 'LedgerSearch',
    arguments: { team_id: teamId, query: 'e2e' },
  });
  const searchBody = JSON.parse(searchRes.result?.content?.[0]?.text ?? '[]');
  if (!Array.isArray(searchBody) || searchBody.length === 0) {
    fail(`LedgerSearch returned nothing, got ${JSON.stringify(searchBody)}`);
  }

  // LedgerRecent → empty (no registry) is the correct answer here
  const recentRes = await call('tools/call', {
    name: 'LedgerRecent',
    arguments: { team_id: teamId, limit: 3 },
  });
  const recentBody = JSON.parse(recentRes.result?.content?.[0]?.text ?? '[]');
  if (!Array.isArray(recentBody)) fail(`LedgerRecent did not return array`);

  proc.kill('SIGTERM');
  rmSync(scratchHome, { recursive: true, force: true });

  if (process.exitCode === 1) {
    console.error('e2e FAILED');
    process.exit(1);
  } else {
    console.log('e2e OK — all 4 Ledger tools respond correctly over MCP');
  }
}

main().catch((err) => {
  console.error('harness crashed:', err);
  proc.kill('SIGTERM');
  rmSync(scratchHome, { recursive: true, force: true });
  process.exit(1);
});
