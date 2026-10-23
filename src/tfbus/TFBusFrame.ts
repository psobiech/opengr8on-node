export const BROADCAST = 0xFF as const;
export const CLU_ADDR  = 0x00 as const;
export const MIN_ADDR  = 1 as const;
export const MAX_ADDR  = 48 as const;

export function buildFrame(dest: number, type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > 29) {
    throw new RangeError(`TFBUS payload too long: ${payload.length} (max 29)`);
  }
  const buf = Buffer.allocUnsafe(3 + payload.length + 1);
  buf[0] = 0xAA;
  buf[1] = dest & 0xFF;
  buf[2] = type & 0xFF;
  payload.copy(buf, 3);
  let xor = 0;
  for (let i = 0; i < 3 + payload.length; i++) xor ^= buf[i];
  buf[3 + payload.length] = xor;
  return buf;
}

export function parseRxFrame(buf: Buffer): { payload: Buffer; length: number } | null {
  if (buf.length < 4) return null;
  if (buf[0] !== 0xAA) return null;
  const remainingLen = buf[2];
  if (remainingLen > 0x1D) return null;
  const frameLen = Math.max(4, 3 + remainingLen);
  if (buf.length < frameLen) return null;
  let xor = 0;
  for (let i = 0; i < frameLen - 1; i++) xor ^= buf[i];
  if (xor !== buf[frameLen - 1]) return null;
  const payloadLen = Math.max(0, remainingLen - 1);
  return { payload: buf.subarray(3, 3 + payloadLen), length: frameLen };
}

export interface BusTxFrame {
  dest: number;
  type: number;
  payload: Buffer;
}

export function parseBusTxFrame(buf: Buffer): BusTxFrame | null {
  if (buf.length < 4 || buf[0] !== 0xAA || buf[1] === 0x00) return null;
  return {
    dest: buf[1],
    type: buf[2],
    payload: buf.length > 4 ? buf.subarray(3, buf.length - 1) : Buffer.alloc(0),
  };
}
