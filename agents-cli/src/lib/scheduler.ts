import { Cron } from 'croner';
import type { JobConfig } from './jobs.js';
import { listJobs } from './jobs.js';

interface ScheduledJob {
  config: JobConfig;
  cron: Cron;
}

export class JobScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private onTrigger: (config: JobConfig) => Promise<void>;

  constructor(onTrigger: (config: JobConfig) => Promise<void>) {
    this.onTrigger = onTrigger;
  }

  loadAll(): void {
    const configs = listJobs();
    for (const config of configs) {
      if (config.enabled) {
        this.schedule(config);
      }
    }
  }

  schedule(config: JobConfig): void {
    this.unschedule(config.name);

    const cron = new Cron(config.schedule, async () => {
      try {
        await this.onTrigger(config);
      } catch (err) {
        console.error(`Job '${config.name}' failed:`, (err as Error).message);
      }
    });

    this.jobs.set(config.name, { config, cron });
  }

  unschedule(name: string): void {
    const existing = this.jobs.get(name);
    if (existing) {
      existing.cron.stop();
      this.jobs.delete(name);
    }
  }

  reloadAll(): void {
    this.stopAll();
    this.loadAll();
  }

  stopAll(): void {
    for (const [, job] of this.jobs) {
      job.cron.stop();
    }
    this.jobs.clear();
  }

  getNextRun(name: string): Date | null {
    const job = this.jobs.get(name);
    if (!job) return null;
    return job.cron.nextRun() || null;
  }

  listScheduled(): Array<{ name: string; nextRun: Date | null; enabled: boolean }> {
    const result: Array<{ name: string; nextRun: Date | null; enabled: boolean }> = [];
    for (const [name, job] of this.jobs) {
      result.push({
        name,
        nextRun: job.cron.nextRun() || null,
        enabled: job.config.enabled,
      });
    }
    return result;
  }
}
