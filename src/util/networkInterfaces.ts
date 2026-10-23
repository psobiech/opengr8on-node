import os from 'os';

const VMWARE_MAC_PREFIXES = ['00:50:56', '00:0c:29', '00:05:69'];

export interface LocalInterface {
  name: string;
  address: string;
  netmask: string;
  mac: string;
}

export function getLocalIPv4Interfaces(): LocalInterface[] {
  const interfaces = os.networkInterfaces();
  const result: LocalInterface[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const mac = addr.mac?.toLowerCase();
      if (mac && VMWARE_MAC_PREFIXES.some(p => mac.startsWith(p))) continue;
      result.push({ name, address: addr.address, netmask: addr.netmask, mac: addr.mac });
    }
  }

  return result;
}

export function getInterfaceByName(name: string): LocalInterface | null {
  return getLocalIPv4Interfaces().find(i => i.name === name) ?? null;
}

export function getInterfaceByAddress(address: string): LocalInterface | null {
  return getLocalIPv4Interfaces().find(i => i.address === address) ?? null;
}

export function broadcastAddress(address: string, netmask: string): string {
  const addrParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  return addrParts.map((b, i) => (b & maskParts[i]) | (~maskParts[i] & 0xFF)).join('.');
}
