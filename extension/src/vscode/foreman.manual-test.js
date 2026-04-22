#!/usr/bin/env node
// Manual E2E test for foreman.sources under a minimal-PATH env like the
// extension host actually has. Run with: node src/vscode/foreman.manual-test.js
//
// This imitates the real bug the user saw: minimal PATH, resolve agents,
// call the three commands, print what they actually return.

const path = require('path');

// Rebuild the same resolver + augmented-PATH exec path as the compiled code,
// inline so we don't have to shim the vscode module for a quick check.
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const execAsync = promisify(exec);

let cachedAgentsBin;
async function resolveAgentsBin() {
  if (cachedAgentsBin) return cachedAgentsBin;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { stdout } = await execAsync(`${shell} -lc 'command -v agents'`, { timeout: 5000 });
    const p = stdout.trim();
    if (p && fs.existsSync(p)) { cachedAgentsBin = p; return p; }
  } catch {}
  const candidates = [path.join(os.homedir(), '.agents', 'shims', 'agents')];
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const versions = fs.readdirSync(nvmDir).sort().reverse();
    for (const v of versions) candidates.push(path.join(nvmDir, v, 'bin', 'agents'));
  } catch {}
  candidates.push('/opt/homebrew/bin/agents', '/usr/local/bin/agents');
  for (const p of candidates) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) { cachedAgentsBin = p; return p; } } catch {}
  }
  throw new Error('agents not found');
}

function buildAugmentedPath(binPath) {
  const binDir = path.dirname(binPath);
  const extras = [binDir, path.join(os.homedir(), '.agents', 'shims'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const versions = fs.readdirSync(nvmDir).sort().reverse();
    if (versions[0]) extras.unshift(path.join(nvmDir, versions[0], 'bin'));
  } catch {}
  const existing = process.env.PATH ?? '';
  const seen = new Set();
  const combined = [];
  for (const p of [...extras, ...existing.split(':')]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    combined.push(p);
  }
  return combined.join(':');
}

async function runJson(bin, args) {
  const cmd = [`'${bin}'`, ...args.map((a) => `'${a}'`)].join(' ');
  const { stdout, stderr } = await execAsync(cmd, {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: buildAugmentedPath(bin) },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

(async () => {
  // Simulate extension host PATH
  process.env.PATH = '/usr/bin:/bin';
  console.log('== Test: foreman under minimal PATH ==');
  console.log('simulated PATH:', process.env.PATH);

  let bin;
  try {
    bin = await resolveAgentsBin();
    console.log('resolved agents:', bin);
  } catch (err) {
    console.error('RESOLVE FAILED:', err.message);
    process.exit(1);
  }

  const checks = [
    { name: 'sessions',       args: ['sessions', '--json', '--since', '2h', '--limit', '5', '--all', '--teams'] },
    { name: 'sessions noflag',args: ['sessions', '--json', '--since', '2h', '--limit', '5', '--all'] },
    { name: 'cloud list',     args: ['cloud', 'list', '--json'] },
    { name: 'teams list',     args: ['teams', 'list', '--json'] },
  ];

  for (const c of checks) {
    try {
      const { stdout, stderr } = await runJson(bin, c.args);
      let parsed;
      try { parsed = JSON.parse(stdout || '[]'); } catch { parsed = stdout.slice(0, 200); }
      const count = Array.isArray(parsed) ? parsed.length : (parsed?.teams?.length ?? 'obj');
      console.log(`${c.name}: ${count} ${stderr ? '(stderr: ' + stderr.slice(0, 120) + ')' : ''}`);
      if (Array.isArray(parsed) && parsed[0]) {
        const s = parsed[0];
        console.log(`  sample:`, s.agent ?? s.provider, '-', s.project ?? s.repo ?? s.task_name, '-', (s.topic ?? s.prompt ?? s.status ?? '').slice(0, 60));
      }
    } catch (err) {
      console.log(`${c.name}: ERROR ${err.message.slice(0, 200)}`);
    }
  }
})();
