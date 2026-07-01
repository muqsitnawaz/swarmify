import { homedir } from 'os';
import { dirname, join } from 'path';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';

export interface Device {
  name: string;
  host: string;
  secretRef?: string;
  softLimit?: number;
  registeredAt: number;
}

interface DevicesFile {
  version: number;
  devices: Device[];
}

const DEFAULT_PATH = join(homedir(), '.agents', 'devices.json');

function isValidDeviceList(value: unknown): value is Device[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const d = item as Record<string, unknown>;
    return (
      typeof d.name === 'string' &&
      typeof d.host === 'string' &&
      typeof d.registeredAt === 'number' &&
      (d.secretRef === undefined || typeof d.secretRef === 'string') &&
      (d.softLimit === undefined || typeof d.softLimit === 'number')
    );
  });
}

function validateNameAndHost(device: Device): void {
  if (typeof device.name !== 'string' || device.name.trim().length === 0) {
    throw new Error('Device name is required and must be non-empty');
  }
  if (typeof device.host !== 'string' || device.host.trim().length === 0) {
    throw new Error('Device host is required and must be non-empty');
  }
}

function validateSoftLimit(limit: number | undefined): void {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('softLimit must be an integer >= 1');
  }
}

export async function loadDevices(filePath: string = DEFAULT_PATH): Promise<Device[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const data = parsed as Partial<DevicesFile>;
    if (data.version !== 1) return [];
    if (!isValidDeviceList(data.devices)) return [];
    return data.devices;
  } catch {
    return [];
  }
}

export async function saveDevices(devices: Device[], filePath: string = DEFAULT_PATH): Promise<void> {
  const data: DevicesFile = { version: 1, devices };
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, filePath);
}

export async function registerDevice(device: Device, filePath: string = DEFAULT_PATH): Promise<Device[]> {
  validateNameAndHost(device);
  validateSoftLimit(device.softLimit);

  const devices = await loadDevices(filePath);
  const existingIndex = devices.findIndex((d) => d.name === device.name);
  const nextDevice: Device = {
    ...device,
    registeredAt: device.registeredAt ?? Date.now(),
  };

  const next = [...devices];
  if (existingIndex >= 0) {
    next[existingIndex] = nextDevice;
  } else {
    next.push(nextDevice);
  }

  await saveDevices(next, filePath);
  return next;
}

export async function unregisterDevice(name: string, filePath: string = DEFAULT_PATH): Promise<Device[]> {
  const devices = await loadDevices(filePath);
  const next = devices.filter((d) => d.name !== name);
  await saveDevices(next, filePath);
  return next;
}

export async function setSoftLimit(name: string, limit: number, filePath: string = DEFAULT_PATH): Promise<Device[]> {
  validateSoftLimit(limit);
  const devices = await loadDevices(filePath);
  const index = devices.findIndex((d) => d.name === name);
  if (index < 0) {
    throw new Error(`Device "${name}" not found`);
  }
  const next = [...devices];
  next[index] = { ...next[index], softLimit: limit };
  await saveDevices(next, filePath);
  return next;
}

export async function setSecretRef(name: string, secretRef: string, filePath: string = DEFAULT_PATH): Promise<Device[]> {
  const devices = await loadDevices(filePath);
  const index = devices.findIndex((d) => d.name === name);
  if (index < 0) {
    throw new Error(`Device "${name}" not found`);
  }
  const next = [...devices];
  next[index] = { ...next[index], secretRef };
  await saveDevices(next, filePath);
  return next;
}

export async function getDevice(name: string, filePath: string = DEFAULT_PATH): Promise<Device | undefined> {
  const devices = await loadDevices(filePath);
  return devices.find((d) => d.name === name);
}
