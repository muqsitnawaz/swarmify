import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { JobConfig } from './jobs.js';
import { getJobsDir } from './state.js';

const REAL_HOME = os.homedir();

const CLAUDE_TOOL_MAP: Record<string, string> = {
  web_search: 'WebSearch(*)',
  web_fetch: 'WebFetch(*)',
  bash: 'Bash(*)',
  read: 'Read(*)',
  write: 'Write(*)',
  edit: 'Edit(*)',
  glob: 'Glob(*)',
  grep: 'Grep(*)',
  notebook_edit: 'NotebookEdit(*)',
};

export function getJobHomePath(name: string): string {
  return path.join(getJobsDir(), name, 'home');
}

export function prepareJobHome(config: JobConfig): string {
  const overlayHome = getJobHomePath(config.name);

  cleanJobHome(config.name);
  fs.mkdirSync(overlayHome, { recursive: true });

  if (config.agent === 'claude') {
    generateClaudeConfig(overlayHome, config);
  } else if (config.agent === 'codex') {
    generateCodexConfig(overlayHome, config);
  } else if (config.agent === 'gemini') {
    generateGeminiConfig(overlayHome, config);
  }

  if (config.allow?.dirs) {
    symlinkAllowedDirs(overlayHome, config.allow.dirs);
  }

  return overlayHome;
}

export function cleanJobHome(name: string): void {
  const overlayHome = getJobHomePath(name);
  if (fs.existsSync(overlayHome)) {
    fs.rmSync(overlayHome, { recursive: true, force: true });
  }
}

export function symlinkAllowedDirs(overlayHome: string, dirs: string[]): void {
  for (const dir of dirs) {
    const realPath = dir.replace(/^~/, REAL_HOME);

    if (!realPath.startsWith(REAL_HOME)) {
      continue;
    }

    const relativePath = path.relative(REAL_HOME, realPath);
    const symlinkTarget = path.join(overlayHome, relativePath);
    const parentDir = path.dirname(symlinkTarget);

    fs.mkdirSync(parentDir, { recursive: true });

    if (!fs.existsSync(symlinkTarget)) {
      try {
        fs.symlinkSync(realPath, symlinkTarget);
      } catch {}
    }
  }
}

export function generateClaudeConfig(overlayHome: string, config: JobConfig): void {
  const claudeDir = path.join(overlayHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  const allowPermissions: string[] = [];

  if (config.allow?.tools) {
    for (const tool of config.allow.tools) {
      const mapped = CLAUDE_TOOL_MAP[tool];
      allowPermissions.push(mapped || tool);
    }
  }

  if (config.allow?.dirs) {
    for (const dir of config.allow.dirs) {
      const resolved = dir.replace(/^~/, REAL_HOME);
      allowPermissions.push(`Read(${resolved}/**)`);
      if (config.mode === 'edit') {
        allowPermissions.push(`Write(${resolved}/**)`);
        allowPermissions.push(`Edit(${resolved}/**)`);
      }
    }
  }

  const settings: Record<string, unknown> = {
    permissions: {
      allow: allowPermissions,
      deny: [],
    },
  };

  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify(settings, null, 2),
    'utf-8'
  );
}

export function generateCodexConfig(overlayHome: string, config: JobConfig): void {
  const codexDir = path.join(overlayHome, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });

  const lines: string[] = [];

  const model = config.config?.model as string | undefined;
  if (model) {
    lines.push(`model = "${model}"`);
  }

  if (config.mode === 'edit') {
    lines.push('approval_mode = "full-auto"');
  } else {
    lines.push('approval_mode = "suggest"');
  }

  if (config.config) {
    for (const [key, value] of Object.entries(config.config)) {
      if (key === 'model') continue;
      if (typeof value === 'string') {
        lines.push(`${key} = "${value}"`);
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        lines.push(`${key} = ${value}`);
      }
    }
  }

  fs.writeFileSync(
    path.join(codexDir, 'config.toml'),
    lines.join('\n') + '\n',
    'utf-8'
  );
}

export function generateGeminiConfig(overlayHome: string, config: JobConfig): void {
  const geminiDir = path.join(overlayHome, '.gemini');
  fs.mkdirSync(geminiDir, { recursive: true });

  const settings: Record<string, unknown> = {};

  if (config.config?.model) {
    settings.model = config.config.model;
  }

  if (config.config) {
    for (const [key, value] of Object.entries(config.config)) {
      settings[key] = value;
    }
  }

  fs.writeFileSync(
    path.join(geminiDir, 'settings.json'),
    JSON.stringify(settings, null, 2),
    'utf-8'
  );
}
