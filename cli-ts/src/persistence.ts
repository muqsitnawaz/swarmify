import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir, homedir } from 'os';


export async function isWritableAsync(directory: string): Promise<boolean> {
  try {
    await fs.mkdir(directory, { recursive: true });
    const probe = path.join(directory, '.write_test');
    await fs.writeFile(probe, '');
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

export async function hasAgentData(directory: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directory);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        const metaPath = path.join(entryPath, 'meta.json');
        try {
          await fs.access(metaPath);
          return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function resolveAgentsDir(): Promise<string> {
  const envDir = process.env.AGENT_SWARM_DIR;
  if (envDir) {
    const envPath = path.resolve(envDir.replace(/^~/, homedir()));
    if (await isWritableAsync(envPath)) {
      return envPath;
    }
  }

  const homeDir = homedir();
  const canonical = path.join(homeDir, '.agent-swarm', 'agents');
  const candidates: string[] = [
    canonical,
    path.join(homeDir, '.claude', 'agent-swarm', 'agents'),
  ];

  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    candidates.push(path.join(xdgStateHome, 'agent-swarm', 'agents'));
  }

  candidates.push(
    path.join(process.cwd(), '.agent-swarm', 'agents'),
    path.join(tmpdir(), 'agent-swarm', 'agents')
  );

  for (const candidate of candidates) {
    if (await isWritableAsync(candidate)) {
      const hasData = await hasAgentData(candidate);
      if (hasData && candidate !== canonical) {
        return candidate;
      }
    }
  }

  for (const candidate of candidates) {
    if (await isWritableAsync(candidate)) {
      if (candidate !== canonical) {
        return candidate;
      }
      return candidate;
    }
  }

  const tried = candidates.join(', ');
  throw new Error(`Unable to find a writable agent storage directory. Tried: ${tried}`);
}
