import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getDevice,
  loadDevices,
  registerDevice,
  saveDevices,
  setSecretRef,
  setSoftLimit,
  unregisterDevice,
} from './deviceRegistry';

const tmpDirs: string[] = [];

async function getFilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dev-reg-'));
  tmpDirs.push(dir);
  return join(dir, 'devices.json');
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test('registerDevice persists and loadDevices reloads devices', async () => {
  const filePath = await getFilePath();
  const first = await registerDevice({ name: 'laptop', host: 'laptop.local' }, filePath);
  expect(first).toHaveLength(1);
  expect(first[0].name).toBe('laptop');
  expect(first[0].host).toBe('laptop.local');
  expect(typeof first[0].registeredAt).toBe('number');

  const second = await registerDevice({ name: 'desktop', host: 'desktop.local', softLimit: 4 }, filePath);
  expect(second).toHaveLength(2);
  expect(second[1].name).toBe('desktop');
  expect(second[1].softLimit).toBe(4);

  const reloaded = await loadDevices(filePath);
  expect(reloaded).toHaveLength(2);
  expect(reloaded.map((d) => d.name)).toContain('laptop');
  expect(reloaded.map((d) => d.name)).toContain('desktop');
});

test('registerDevice upserts by name without duplicating', async () => {
  const filePath = await getFilePath();
  await registerDevice({ name: 'server', host: 'server.local' }, filePath);
  await registerDevice({ name: 'server', host: 'server.tailscale', secretRef: 'server-key' }, filePath);

  const devices = await loadDevices(filePath);
  expect(devices).toHaveLength(1);
  expect(devices[0].host).toBe('server.tailscale');
  expect(devices[0].secretRef).toBe('server-key');
});

test('unregisterDevice removes a device', async () => {
  const filePath = await getFilePath();
  await registerDevice({ name: 'a', host: 'a.local' }, filePath);
  await registerDevice({ name: 'b', host: 'b.local' }, filePath);

  const remaining = await unregisterDevice('a', filePath);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].name).toBe('b');

  const reloaded = await loadDevices(filePath);
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0].name).toBe('b');
});

test('setSoftLimit persists and validates', async () => {
  const filePath = await getFilePath();
  await registerDevice({ name: 'worker', host: 'worker.local' }, filePath);

  const updated = await setSoftLimit('worker', 8, filePath);
  expect(updated[0].softLimit).toBe(8);

  const reloaded = await loadDevices(filePath);
  expect(reloaded[0].softLimit).toBe(8);

  expect(() => setSoftLimit('worker', 0, filePath)).toThrow('softLimit must be an integer >= 1');
  expect(() => setSoftLimit('worker', 1.5, filePath)).toThrow('softLimit must be an integer >= 1');
  expect(() => setSoftLimit('missing', 2, filePath)).toThrow('Device "missing" not found');
});

test('setSecretRef persists', async () => {
  const filePath = await getFilePath();
  await registerDevice({ name: 'edge', host: 'edge.local' }, filePath);

  const updated = await setSecretRef('edge', 'edge-secret', filePath);
  expect(updated[0].secretRef).toBe('edge-secret');

  const reloaded = await loadDevices(filePath);
  expect(reloaded[0].secretRef).toBe('edge-secret');

  expect(() => setSecretRef('missing', 'x', filePath)).toThrow('Device "missing" not found');
});

test('getDevice returns the matching device', async () => {
  const filePath = await getFilePath();
  await registerDevice({ name: 'found', host: 'found.local' }, filePath);

  const found = await getDevice('found', filePath);
  expect(found).toBeTruthy();
  expect(found!.name).toBe('found');

  const missing = await getDevice('nope', filePath);
  expect(missing).toBeUndefined();
});

test('loadDevices returns empty array for missing file', async () => {
  const filePath = await getFilePath();
  const devices = await loadDevices(filePath);
  expect(devices).toEqual([]);
});

test('loadDevices returns empty array for malformed JSON', async () => {
  const filePath = await getFilePath();
  await writeFile(filePath, '{ not json');
  const devices = await loadDevices(filePath);
  expect(devices).toEqual([]);
});

test('registerDevice validates name and host', async () => {
  const filePath = await getFilePath();
  await expect(registerDevice({ name: '', host: 'host.local', registeredAt: Date.now() }, filePath)).rejects.toThrow('Device name is required');
  await expect(registerDevice({ name: 'valid', host: '   ', registeredAt: Date.now() }, filePath)).rejects.toThrow('Device host is required');
  await expect(registerDevice({ name: 'bad-limit', host: 'host.local', softLimit: 0, registeredAt: Date.now() }, filePath)).rejects.toThrow('softLimit must be an integer >= 1');
});

test('saveDevices atomic write produces a readable file', async () => {
  const filePath = await getFilePath();
  await saveDevices([{ name: 'unit', host: 'unit.local', registeredAt: 1 }], filePath);
  const reloaded = await loadDevices(filePath);
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0].name).toBe('unit');
});
