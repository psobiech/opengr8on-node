export function toHexString(value: Buffer | bigint | number, padLength = 0): string {
  let hex: string;
  if (Buffer.isBuffer(value)) {
    hex = value.toString('hex');
  } else if (typeof value === 'bigint') {
    hex = value.toString(16);
  } else {
    hex = (value >>> 0).toString(16);
  }
  return padLength > 0 ? hex.padStart(padLength, '0') : hex;
}

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

export function hexToNumber(hex: string): number {
  return parseInt(hex, 16);
}

export function hexToBigInt(hex: string): bigint {
  return BigInt('0x' + hex);
}
