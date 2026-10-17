export function toHexString(value, padLength = 0) {
  let hex;
  if (Buffer.isBuffer(value)) {
    hex = value.toString('hex');
  } else if (typeof value === 'bigint') {
    hex = value.toString(16);
  } else {
    hex = (value >>> 0).toString(16);
  }
  return padLength > 0 ? hex.padStart(padLength, '0') : hex;
}

export function hexToBuffer(hex) {
  return Buffer.from(hex, 'hex');
}

export function hexToNumber(hex) {
  return parseInt(hex, 16);
}

export function hexToBigInt(hex) {
  return BigInt('0x' + hex);
}
