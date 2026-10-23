import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomHexString } from '../../dist/util/random.js';

describe('random', () => {
  describe('randomBytes', () => {
    it('returns Buffer of requested length', () => {
      for (const len of [1, 8, 16, 30, 32]) {
        const b = randomBytes(len);
        assert.ok(Buffer.isBuffer(b), 'should be Buffer');
        assert.equal(b.length, len);
      }
    });

    it('produces different values', () => {
      const a = randomBytes(16);
      const b = randomBytes(16);
      assert.ok(!a.equals(b), 'should not be equal (astronomically unlikely)');
    });
  });

  describe('randomInt', () => {
    it('returns a non-negative integer', () => {
      for (let i = 0; i < 10; i++) {
        const n = randomInt();
        assert.ok(Number.isInteger(n));
        assert.ok(n >= 0);
      }
    });

    it('respects max bound', () => {
      for (let i = 0; i < 20; i++) {
        const n = randomInt(9);
        assert.ok(n >= 0 && n <= 9, `out of range: ${n}`);
      }
    });
  });

  describe('randomHexString', () => {
    it('returns lowercase hex of correct length', () => {
      for (const len of [4, 6, 8]) {
        const s = randomHexString(len);
        assert.equal(s.length, len);
        assert.match(s, /^[0-9a-f]+$/);
      }
    });
  });
});
