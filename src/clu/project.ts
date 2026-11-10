import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { CLUClient } from '../CLUClient.js';
import { CLUDevice } from '../device/CLUDevice.js';
import { CipherKey } from '../CipherKey.js';
import { readAllObjects, readProjectCipherKey } from '../parsers/omp/OmpReader.js';

export interface ProjectClu {
  name: string;
  serial: string;
  ipAddress: string;
  cipherKey: CipherKey;
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') return (node as Record<string, string>)['#text'] ?? '';
  return '';
}

// Project AES key: keys.json next to the .omp (written by vclu), else the key stored in the .omp.
function projectKey(ompFile: string): CipherKey | null {
  try {
    const keys = JSON.parse(readFileSync(resolve(dirname(ompFile), 'keys.json'), 'utf8')) as { key?: string; iv?: string };
    if (keys.key && keys.iv) return new CipherKey(Buffer.from(keys.key, 'base64'), Buffer.from(keys.iv, 'base64'));
  } catch { /* no keys.json */ }
  try {
    return readProjectCipherKey(ompFile);
  } catch {
    return null;
  }
}

/** All CLUs (and GATEs) of an OM project with the cipher key to talk to each one. */
export function readProjectClus(ompFile: string): ProjectClu[] {
  const key = projectKey(ompFile);
  const clus = new Map<string, ProjectClu>();
  for (const obj of readAllObjects(ompFile).values() as Iterable<Record<string, unknown>>) {
    const ipAddress = textOf(obj['ipAddress']);
    const name = textOf(obj['name']);
    if (!ipAddress || !name || clus.has(name.toLowerCase())) continue;

    let cipherKey: CipherKey | null = null;
    if (obj['cipherKeyType'] === 'PROJECT_KEY' && key) {
      cipherKey = key;
    } else {
      // Per-device key; falls back to the project key when the device has none.
      const iv = textOf(obj['iv']);
      const pk = textOf(obj['privateKey']);
      cipherKey = iv && pk
        ? CipherKey.getInitialCipherKey(Buffer.from(iv, 'base64'), Buffer.from(pk, 'base64'))
        : key;
    }
    if (!cipherKey) continue;
    clus.set(name.toLowerCase(), { name, serial: textOf(obj['serialNumber']), ipAddress, cipherKey });
  }
  return [...clus.values()];
}

/** Finds a CLU by name or serial (case-insensitive). */
export function findProjectClu(clus: ProjectClu[], id: string): ProjectClu | null {
  const k = id.toLowerCase();
  return clus.find(c => c.name.toLowerCase() === k || c.serial.toLowerCase() === k) ?? null;
}

export function projectCluClient(clu: ProjectClu, localAddress: string, port = 1234): CLUClient {
  const device = new CLUDevice({ address: clu.ipAddress, port, serialNumber: parseInt(clu.serial, 16) });
  return new CLUClient(localAddress, device, clu.cipherKey);
}
