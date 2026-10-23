import crypto from 'crypto';
import { KEY_BYTES, IV_BYTES } from './constants.js';
import { randomBytes } from './util/random.js';

const DEFAULT_KEY = Buffer.from('hd5SHpxl0N5+WEXTXlPQmw==', 'base64');
const DEFAULT_IV = Buffer.from('ua/jh/kZo9Og15rejhGhFg==', 'base64');
const DEFAULT_BROADCAST_IV = Buffer.from('BwYFBAMCAQAEAgkDBAEFBw==', 'base64');

export class CipherKey {
  readonly key: Buffer;
  readonly iv: Buffer;

  constructor(key: Buffer | string, iv: Buffer | string) {
    this.key = Buffer.isBuffer(key) ? key : Buffer.from(key);
    this.iv = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
  }

  static random(): CipherKey {
    return new CipherKey(randomBytes(KEY_BYTES), randomBytes(IV_BYTES));
  }

  static get DEFAULT_BROADCAST(): CipherKey {
    return new CipherKey(DEFAULT_KEY, DEFAULT_BROADCAST_IV);
  }

  static generateDefaultKey(privateKey: Buffer): Buffer {
    return CipherKey.generateKey(DEFAULT_IV, privateKey);
  }

  // XOR: first half forward, second half backward
  static generateKey(iv: Buffer, privateKey: Buffer): Buffer {
    const size = iv.length;
    const result = Buffer.alloc(size);
    let i = 0;
    for (; i < size / 2; i++) {
      result[i] = iv[i] ^ privateKey[i];
    }
    for (; i < size; i++) {
      result[i] = iv[i] ^ privateKey[(size - 1) - i];
    }
    return result;
  }

  static getInitialCipherKey(iv: Buffer, privateKey: Buffer): CipherKey {
    return new CipherKey(CipherKey.generateDefaultKey(privateKey), iv);
  }

  withIV(iv: Buffer | string): CipherKey {
    return new CipherKey(this.key, Buffer.isBuffer(iv) ? iv : Buffer.from(iv));
  }

  encrypt(data: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }

  decrypt(data: Buffer): Buffer | null {
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, this.iv);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch {
      return null;
    }
  }

  getSecretKey(): Buffer { return this.key; }
  getIV(): Buffer { return this.iv; }

  toString(): string {
    return `CipherKey{key=${this.key.toString('base64')}, iv=${this.iv.toString('base64')}}`;
  }
}
