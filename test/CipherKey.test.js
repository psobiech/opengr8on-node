import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CipherKey } from '../dist/CipherKey.js';

describe('CipherKey', () => {
  describe('DEFAULT_BROADCAST', () => {
    it('is a CipherKey instance', () => {
      const k = CipherKey.DEFAULT_BROADCAST;
      assert.ok(k instanceof CipherKey);
      assert.equal(k.getSecretKey().length, 16);
      assert.equal(k.getIV().length, 16);
    });

    it('always returns same values', () => {
      const a = CipherKey.DEFAULT_BROADCAST;
      const b = CipherKey.DEFAULT_BROADCAST;
      assert.ok(a.getSecretKey().equals(b.getSecretKey()));
      assert.ok(a.getIV().equals(b.getIV()));
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips correctly', () => {
      const key = CipherKey.random();
      const plaintext = Buffer.from('hello CLU protocol');
      const encrypted = key.encrypt(plaintext);
      const decrypted = key.decrypt(encrypted);
      assert.ok(decrypted !== null);
      assert.ok(decrypted.equals(plaintext));
    });

    it('encrypted is multiple of 16 (AES block size)', () => {
      const key = CipherKey.random();
      for (const len of [1, 15, 16, 17, 30, 32, 100]) {
        const enc = key.encrypt(Buffer.alloc(len, 0xAA));
        assert.equal(enc.length % 16, 0, `enc.length=${enc.length} for input.length=${len}`);
      }
    });

    it('decrypt returns null for garbage', () => {
      const key = CipherKey.random();
      const result = key.decrypt(Buffer.alloc(32, 0xFF));
      assert.equal(result, null);
    });

    it('decrypt with wrong key returns null', () => {
      const key1 = CipherKey.random();
      const key2 = CipherKey.random();
      const enc = key1.encrypt(Buffer.from('secret'));
      const result = key2.decrypt(enc);
      assert.equal(result, null);
    });

    it('DEFAULT_BROADCAST round-trips', () => {
      const key = CipherKey.DEFAULT_BROADCAST;
      const data = Buffer.from('req_discovery_clu:192.168.1.50');
      const enc = key.encrypt(data);
      const dec = key.decrypt(enc);
      assert.ok(dec !== null);
      assert.ok(dec.equals(data));
    });
  });

  describe('withIV', () => {
    it('creates new key with different IV but same secret key', () => {
      const key = CipherKey.random();
      const newIV = Buffer.alloc(16, 0x42);
      const key2 = key.withIV(newIV);
      assert.ok(key2.getSecretKey().equals(key.getSecretKey()));
      assert.ok(key2.getIV().equals(newIV));
      assert.ok(!key2.getIV().equals(key.getIV()));
    });
  });

  describe('generateKey', () => {
    it('produces 16-byte output from 16-byte IV + 8-byte privateKey', () => {
      const iv = Buffer.alloc(16, 0xAA);
      const priv = Buffer.alloc(8, 0x55);
      const result = CipherKey.generateKey(iv, priv);
      assert.equal(result.length, 16);
    });

    it('first half: result[i] = iv[i] ^ privateKey[i]', () => {
      const iv = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
                              0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0, 0x00]);
      const priv = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
      const result = CipherKey.generateKey(iv, priv);
      for (let i = 0; i < 8; i++) {
        assert.equal(result[i], iv[i] ^ priv[i], `mismatch at i=${i}`);
      }
    });

    it('second half: result[i] = iv[i] ^ privateKey[(15-i)]', () => {
      const iv = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
                              0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0, 0x00]);
      const priv = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
      const result = CipherKey.generateKey(iv, priv);
      for (let i = 8; i < 16; i++) {
        assert.equal(result[i], iv[i] ^ priv[15 - i], `mismatch at i=${i}`);
      }
    });

    it('known vector', () => {
      const iv   = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10]);
      const priv = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22]);
      const result = CipherKey.generateKey(iv, priv);
      // first 8: XOR with priv forward
      assert.equal(result[0], 0x01 ^ 0xAA);
      assert.equal(result[7], 0x08 ^ 0x22);
      // last 8: XOR with priv backward (priv[(15-i)])
      assert.equal(result[8],  0x09 ^ priv[15 - 8]);   // priv[7] = 0x22
      assert.equal(result[15], 0x10 ^ priv[15 - 15]);  // priv[0] = 0xAA
    });
  });

  describe('generateDefaultKey', () => {
    it('uses hardcoded DEFAULT_IV', () => {
      const priv = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
      const k1 = CipherKey.generateDefaultKey(priv);
      assert.equal(k1.length, 16);
    });

    it('same privateKey always yields same key', () => {
      const priv = Buffer.alloc(8, 0x42);
      const k1 = CipherKey.generateDefaultKey(priv);
      const k2 = CipherKey.generateDefaultKey(priv);
      assert.ok(k1.equals(k2));
    });
  });

  describe('getInitialCipherKey', () => {
    it('returns CipherKey with derived key and given IV', () => {
      const iv = Buffer.alloc(16, 0xAB);
      const priv = Buffer.alloc(8, 0xCD);
      const ck = CipherKey.getInitialCipherKey(iv, priv);
      assert.ok(ck instanceof CipherKey);
      assert.ok(ck.getIV().equals(iv));
      // key is derived from generateDefaultKey(priv)
      const expectedKey = CipherKey.generateDefaultKey(priv);
      assert.ok(ck.getSecretKey().equals(expectedKey));
    });
  });

  describe('random()', () => {
    it('produces different keys each time', () => {
      const k1 = CipherKey.random();
      const k2 = CipherKey.random();
      assert.ok(!k1.getSecretKey().equals(k2.getSecretKey()) || !k1.getIV().equals(k2.getIV()));
    });
  });
});
