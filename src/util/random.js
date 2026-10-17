import crypto from 'crypto';

export function randomBytes(count) {
  return crypto.randomBytes(count);
}

export function randomInt(max = 0xFFFFFFFF) {
  return crypto.randomInt(0, max + 1);
}

export function randomHexString(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
