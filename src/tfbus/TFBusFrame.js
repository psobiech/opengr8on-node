export const BROADCAST = 0xFF;
export const CLU_ADDR = 0x00;
export const MIN_ADDR = 1;
export const MAX_ADDR = 48;

export function buildFrame(dest, type, payload = Buffer.alloc(0)) {
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

// Returns { payload: Buffer, length: number } or null if invalid/incomplete.
// dest byte is not validated — callers filter by buf[1] before calling.
export function parseRxFrame(buf) {
  if (buf.length < 4) return null;
  if (buf[0] !== 0xAA) return null;
  const remainingLen = buf[2];
  if (remainingLen > 0x1D) return null;
  // special case: remainingLen <= 1 → 4-byte frame, empty payload
  const frameLen = Math.max(4, 3 + remainingLen);
  if (buf.length < frameLen) return null;
  let xor = 0;
  for (let i = 0; i < frameLen - 1; i++) xor ^= buf[i];
  if (xor !== buf[frameLen - 1]) return null;
  const payloadLen = Math.max(0, remainingLen - 1);
  return { payload: buf.slice(3, 3 + payloadLen), length: frameLen };
}

// Parse a CLU→module TX frame (dest ≠ 0x00), already CRC-validated by transport.
// Returns { dest, type, payload } or null.
export function parseBusTxFrame(buf) {
  if (buf.length < 4 || buf[0] !== 0xAA || buf[1] === 0x00) return null;
  return {
    dest: buf[1],
    type: buf[2],
    payload: buf.length > 4 ? buf.slice(3, buf.length - 1) : Buffer.alloc(0),
  };
}
