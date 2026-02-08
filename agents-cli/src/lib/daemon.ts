import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getAgentsDir } from './state.js';
import { listJobs as listAllJobs } from './jobs.js';
import { JobScheduler } from './scheduler.js';
import { executeJobDetached, monitorRunningJobs } from './runner.js';

const PID_FILE = 'daemon.pid';
const LOG_FILE = 'daemon.log';
const PLIST_NAME = 'co.swarmify.agents-daemon';
const SYSTEMD_UNIT = 'agents-daemon.service';

function getPidPath(): string {
  return path.join(getAgentsDir(), PID_FILE);
}

function getLogPath(): string {
  return path.join(getAgentsDir(), LOG_FILE);
}

function getLaunchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_NAME}.plist`);
}

function getSystemdUnitPath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', `${SYSTEMD_UNIT}`);
}

export function readDaemonPid(): number | null {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return null;
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function writeDaemonPid(pid: number): void {
  fs.writeFileSync(getPidPath(), String(pid), 'utf-8');
}

export function removeDaemonPid(): void {
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

export function isDaemonRunning(): boolean {
  const pid = readDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    removeDaemonPid();
    return false;
  }
}

export function log(level: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(getLogPath(), line, 'utf-8');
}

export async function runDaemon(): Promise<void> {
  writeDaemonPid(process.pid);
  log('INFO', `Daemon started (PID: ${process.pid})`);

  const scheduler = new JobScheduler(async (config) => {
    log('INFO', `Triggering job '${config.name}' (agent: ${config.agent})`);
    try {
      const meta = await executeJobDetached(config);
      log('INFO', `Job '${config.name}' spawned (run: ${meta.runId}, PID: ${meta.pid})`);
    } catch (err) {
      log('ERROR', `Job '${config.name}' failed to spawn: ${(err as Error).message}`);
    }
  });

  scheduler.loadAll();
  const scheduled = scheduler.listScheduled();
  log('INFO', `Loaded ${scheduled.length} jobs`);
  for (const job of scheduled) {
    log('INFO', `  ${job.name} -> next: ${job.nextRun?.toISOString() || 'unknown'}`);
  }

  const monitorInterval = setInterval(() => {
    monitorRunningJobs();
  }, 60_000);

  const handleReload = () => {
    log('INFO', 'Reloading jobs (SIGHUP)');
    scheduler.reloadAll();
    const reloaded = scheduler.listScheduled();
    log('INFO', `Reloaded ${reloaded.length} jobs`);
  };

  const handleShutdown = () => {
    log('INFO', 'Daemon shutting down');
    scheduler.stopAll();
    clearInterval(monitorInterval);
    removeDaemonPid();
    process.exit(0);
  };

  process.on('SIGHUP', handleReload);
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  await new Promise(() => {});
}

export function generateLaunchdPlist(): string {
  const agentsBin = getAgentsBinPath();
  const logPath = getLogPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${agentsBin}</string>
    <string>daemon</string>
    <string>_run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${os.homedir()}/.bun/bin:${os.homedir()}/.nvm/versions/node/v24.0.0/bin</string>
  </dict>
</dict>
</plist>`;
}

export function generateSystemdUnit(): string {
  const agentsBin = getAgentsBinPath();

  return `[Unit]
Description=Agents Daemon - Scheduled Job Runner
After=network.target

[Service]
Type=simple
ExecStart=${agentsBin} daemon _run
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${os.homedir()}/.nvm/versions/node/v24.0.0/bin

[Install]
WantedBy=default.target`;
}

function getAgentsBinPath(): string {
  try {
    return execSync('which agents', { encoding: 'utf-8' }).trim();
  } catch {
    return 'agents';
  }
}

export function startDaemon(): { pid: number | null; method: string } {
  if (isDaemonRunning()) {
    const pid = readDaemonPid();
    return { pid, method: 'already-running' };
  }

  const platform = os.platform();

  if (platform === 'darwin') {
    try {
      const plistPath = getLaunchdPlistPath();
      const plistDir = path.dirname(plistPath);
      if (!fs.existsSync(plistDir)) {
        fs.mkdirSync(plistDir, { recursive: true });
      }
      fs.writeFileSync(plistPath, generateLaunchdPlist(), 'utf-8');

      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
      } catch {}
      execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' });

      const pid = waitForPid(3000);
      return { pid, method: 'launchd' };
    } catch {
      return startDetached();
    }
  }

  if (platform === 'linux') {
    try {
      const unitPath = getSystemdUnitPath();
      const unitDir = path.dirname(unitPath);
      if (!fs.existsSync(unitDir)) {
        fs.mkdirSync(unitDir, { recursive: true });
      }
      fs.writeFileSync(unitPath, generateSystemdUnit(), 'utf-8');

      execSync('systemctl --user daemon-reload', { encoding: 'utf-8' });
      execSync(`systemctl --user enable ${SYSTEMD_UNIT}`, { encoding: 'utf-8' });
      execSync(`systemctl --user start ${SYSTEMD_UNIT}`, { encoding: 'utf-8' });

      const pid = waitForPid(3000);
      return { pid, method: 'systemd' };
    } catch {
      return startDetached();
    }
  }

  return startDetached();
}

function startDetached(): { pid: number; method: string } {
  const agentsBin = getAgentsBinPath();
  const logPath = getLogPath();
  const logFd = fs.openSync(logPath, 'a');

  const child = spawn(agentsBin, ['daemon', '_run'], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });

  child.unref();
  fs.closeSync(logFd);

  return { pid: child.pid || null, method: 'detached' } as { pid: number; method: string };
}

function waitForPid(timeoutMs: number): number | null {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = readDaemonPid();
    if (pid) return pid;
    const waitUntil = Date.now() + 200;
    while (Date.now() < waitUntil) {}
  }
  return readDaemonPid();
}

export function stopDaemon(): boolean {
  const platform = os.platform();

  if (platform === 'darwin') {
    const plistPath = getLaunchdPlistPath();
    if (fs.existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { encoding: 'utf-8' });
        fs.unlinkSync(plistPath);
      } catch {}
    }
  }

  if (platform === 'linux') {
    try {
      execSync(`systemctl --user stop ${SYSTEMD_UNIT}`, { encoding: 'utf-8' });
      execSync(`systemctl --user disable ${SYSTEMD_UNIT}`, { encoding: 'utf-8' });
    } catch {}
    const unitPath = getSystemdUnitPath();
    if (fs.existsSync(unitPath)) {
      try { fs.unlinkSync(unitPath); } catch {}
    }
  }

  const pid = readDaemonPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}

    setTimeout(() => {
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {}
    }, 5000);
  }

  removeDaemonPid();
  return true;
}

export function getDaemonStatus(): {
  running: boolean;
  pid: number | null;
  jobCount: number;
  logPath: string;
} {
  const running = isDaemonRunning();
  const pid = readDaemonPid();

  let jobCount = 0;
  try {
    jobCount = listAllJobs().filter((j) => j.enabled).length;
  } catch {}

  return { running, pid, jobCount, logPath: getLogPath() };
}

export function readDaemonLog(lines?: number): string {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return '(no log file)';

  const content = fs.readFileSync(logPath, 'utf-8');
  if (!lines) return content;

  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}

export function signalDaemonReload(): boolean {
  const pid = readDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 'SIGHUP');
    return true;
  } catch {
    return false;
  }
}
