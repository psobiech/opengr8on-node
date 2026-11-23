import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomHexString } from '../../dist/util/random.js';

describe('random', () => {
  describe('randomBytes', () => {
    it('returns Buffer of requested length', () => {
      for (const requestedLength of [1, 8, 16, 30, 32]) {
        const bytes = randomBytes(requestedLength);
        assert.ok(Buffer.isBuffer(bytes), 'should be Buffer');
        assert.equal(bytes.length, requestedLength);
      }
    });

    it('produces different values', () => {
      const firstBytes = randomBytes(16);
      const bytes = randomBytes(16);
      assert.ok(!firstBytes.equals(bytes), 'should not be equal (astronomically unlikely)');
    });
  });

  describe('randomInt', () => {
    it('returns a non-negative integer', () => {
      for (let i = 0; i < 10; i++) {
        const value = randomInt();
        assert.ok(Number.isInteger(value));
        assert.ok(value >= 0);
      }
    });

    it('respects max bound', () => {
      for (let i = 0; i < 20; i++) {
        const value = randomInt(9);
        assert.ok(value >= 0 && value <= 9, `out of range: ${value}`);
      }
    });
  });

  describe('randomHexString', () => {
    it('returns lowercase hex of correct length', () => {
      for (const requestedLength of [4, 6, 8]) {
        const hexString = randomHexString(requestedLength);
        assert.equal(hexString.length, requestedLength);
        assert.match(hexString, /^[0-9a-f]+$/);
      }
    });
  });
});
