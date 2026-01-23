import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Manifest } from './types.js';

export const MANIFEST_FILENAME = 'agents.yaml';

export function parseManifest(content: string): Manifest {
  return yaml.parse(content) as Manifest;
}

export function serializeManifest(manifest: Manifest): string {
  return yaml.stringify(manifest, { indent: 2 });
}

export function readManifest(repoPath: string): Manifest | null {
  const manifestPath = path.join(repoPath, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return parseManifest(content);
}

export function writeManifest(repoPath: string, manifest: Manifest): void {
  const manifestPath = path.join(repoPath, MANIFEST_FILENAME);
  const content = serializeManifest(manifest);
  fs.writeFileSync(manifestPath, content, 'utf-8');
}

export function createDefaultManifest(): Manifest {
  return {
    clis: {
      claude: {
        package: '@anthropic-ai/claude-code',
        version: 'latest',
      },
      codex: {
        package: '@openai/codex',
        version: 'latest',
      },
      gemini: {
        package: '@google/gemini-cli',
        version: 'latest',
      },
    },
    dependencies: {},
    mcp: {},
    defaults: {
      method: 'symlink',
      scope: 'global',
      agents: ['claude', 'codex', 'gemini'],
    },
  };
}
