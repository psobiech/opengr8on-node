import crypto from 'crypto';

export function randomBytes(count: number): Buffer {
  return crypto.randomBytes(count);
}

export function randomInt(max = 0xFFFFFFFF): number {
  return crypto.randomInt(0, max + 1);
}

export function randomHexString(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
