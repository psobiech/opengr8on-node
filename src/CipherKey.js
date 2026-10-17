import crypto from 'crypto';
import { KEY_BYTES, IV_BYTES } from './constants.js';
import { randomBytes } from './util/random.js';

const DEFAULT_KEY = Buffer.from('hd5SHpxl0N5+WEXTXlPQmw==', 'base64');
const DEFAULT_IV = Buffer.from('ua/jh/kZo9Og15rejhGhFg==', 'base64');
const DEFAULT_BROADCAST_IV = Buffer.from('BwYFBAMCAQAEAgkDBAEFBw==', 'base64');

export class CipherKey {
  constructor(key, iv) {
    this.key = Buffer.isBuffer(key) ? key : Buffer.from(key);
    this.iv = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
  }

  static random() {
    return new CipherKey(randomBytes(KEY_BYTES), randomBytes(IV_BYTES));
  }

  static get DEFAULT_BROADCAST() {
    return new CipherKey(DEFAULT_KEY, DEFAULT_BROADCAST_IV);
  }

  static generateDefaultKey(privateKey) {
    return CipherKey.generateKey(DEFAULT_IV, privateKey);
  }

  // privateKey must be iv.length/2 bytes (8 bytes for 16-byte IV)
  // XOR: first half forward, second half backward
  static generateKey(iv, privateKey) {
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

  static getInitialCipherKey(iv, privateKey) {
    return new CipherKey(CipherKey.generateDefaultKey(privateKey), iv);
  }

  withIV(iv) {
    return new CipherKey(this.key, Buffer.isBuffer(iv) ? iv : Buffer.from(iv));
  }

  encrypt(data) {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }

  // Returns decrypted Buffer or null on failure
  decrypt(data) {
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, this.iv);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch {
      return null;
    }
  }

  getSecretKey() { return this.key; }
  getIV() { return this.iv; }

  toString() {
    return `CipherKey{key=${this.key.toString('base64')}, iv=${this.iv.toString('base64')}}`;
  }
}
