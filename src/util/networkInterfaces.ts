import os from 'os';

const VMWARE_MAC_PREFIXES = ['00:50:56', '00:0c:29', '00:05:69'];

export interface LocalInterface {
  name: string;
  address: string;
  netmask: string;
  mac: string;
}

export function getInterfaceByName(name: string): LocalInterface | null {
  return getLocalIPv4Interfaces().find(localInterface => localInterface.name === name) ?? null;
}

export function getInterfaceByAddress(address: string): LocalInterface | null {
  return getLocalIPv4Interfaces().find(localInterface => localInterface.address === address) ?? null;
}

export function getLocalIPv4Interfaces(): LocalInterface[] {
  const interfaces = os.networkInterfaces();
  const result: LocalInterface[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    for (const addressInfo of addresses) {
      if (addressInfo.family !== 'IPv4' || addressInfo.internal) continue;
      const mac = addressInfo.mac?.toLowerCase();
      if (mac && VMWARE_MAC_PREFIXES.some(prefix => mac.startsWith(prefix))) continue;
      result.push({ name, address: addressInfo.address, netmask: addressInfo.netmask, mac: addressInfo.mac });
    }
  }

  return result;
}

export function broadcastAddress(address: string, netmask: string): string {
  const addrParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  return addrParts.map((octet, i) => (octet & maskParts[i]) | (~maskParts[i] & 0xFF)).join('.');
}
