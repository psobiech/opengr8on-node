import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toHexString, hexToBuffer, hexToNumber, hexToBigInt } from '../../src/util/hex.js';

describe('hex', () => {
  describe('toHexString', () => {
    it('converts number to lowercase hex', () => {
      assert.equal(toHexString(0xFF), 'ff');
      assert.equal(toHexString(0xABCD), 'abcd');
      assert.equal(toHexString(0), '0');
    });

    it('zero-pads to requested length', () => {
      assert.equal(toHexString(255, 8), '000000ff');
      assert.equal(toHexString(1, 4), '0001');
      assert.equal(toHexString(0xDEAD, 8), '0000dead');
    });

    it('does not truncate values longer than padLength', () => {
      assert.equal(toHexString(0xABCDEF, 4), 'abcdef');
    });

    it('converts Buffer to hex string', () => {
      assert.equal(toHexString(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF])), 'deadbeef');
    });

    it('converts BigInt', () => {
      assert.equal(toHexString(BigInt('0xDEADBEEF')), 'deadbeef');
    });

    it('known serial number format (8 chars lowercase)', () => {
      assert.equal(toHexString(0x1234, 8), '00001234');
    });
  });

  describe('hexToBuffer', () => {
    it('converts hex string to Buffer', () => {
      const buf = hexToBuffer('deadbeef');
      assert.deepEqual([...buf], [0xDE, 0xAD, 0xBE, 0xEF]);
    });

    it('handles empty string', () => {
      assert.equal(hexToBuffer('').length, 0);
    });
  });

  describe('hexToNumber', () => {
    it('parses hex string to number', () => {
      assert.equal(hexToNumber('ff'), 255);
      assert.equal(hexToNumber('abcd'), 0xABCD);
      assert.equal(hexToNumber('00001234'), 0x1234);
    });
  });

  describe('hexToBigInt', () => {
    it('parses hex string to BigInt', () => {
      assert.equal(hexToBigInt('ff'), BigInt(255));
      assert.equal(hexToBigInt('ffffffffffffffff'), BigInt('0xFFFFFFFFFFFFFFFF'));
    });
  });
});
