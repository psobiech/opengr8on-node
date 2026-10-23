import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeCommand, asString, splitExact, splitAtLeast } from '../../dist/commands/serialize.js';

describe('serialize', () => {
  describe('serializeCommand', () => {
    it('concatenates string parts as UTF-8', () => {
      const buf = serializeCommand('req', ':', '192.168.1.1');
      assert.equal(buf.toString(), 'req:192.168.1.1');
    });

    it('passes Buffer parts through unchanged', () => {
      const raw = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
      const buf = serializeCommand(raw, ':end');
      assert.ok(buf.subarray(0, 4).equals(raw));
      assert.equal(buf.subarray(4).toString(), ':end');
    });

    it('converts numbers to decimal strings', () => {
      const buf = serializeCommand('val:', 42);
      assert.equal(buf.toString(), 'val:42');
    });

    it('converts bigints to decimal strings', () => {
      const buf = serializeCommand('n:', BigInt(1234567890));
      assert.equal(buf.toString(), 'n:1234567890');
    });

    it('throws for unsupported types', () => {
      assert.throws(() => serializeCommand({}), /Unsupported serialize type/);
    });
  });

  describe('asString', () => {
    it('converts whole buffer to string', () => {
      const buf = Buffer.from('hello world');
      assert.equal(asString(buf), 'hello world');
    });

    it('trims trailing whitespace', () => {
      const buf = Buffer.from('abc   ');
      assert.equal(asString(buf), 'abc');
    });

    it('strips trailing null bytes', () => {
      // fixed-size buffers from CLU responses often have trailing nulls
      const buf = Buffer.from('abc\0\0');
      assert.equal(asString(buf), 'abc');
    });

    it('supports offset', () => {
      const buf = Buffer.from('prefix:value');
      assert.equal(asString(buf, 7), 'value');
    });

    it('supports offset + length', () => {
      const buf = Buffer.from('req_discovery_clu:extra');
      assert.equal(asString(buf, 0, 'req_discovery_clu'.length), 'req_discovery_clu');
    });
  });

  describe('splitExact', () => {
    it('returns parts when count matches', () => {
      const parts = splitExact('a:b:c', ':', 3);
      assert.deepEqual(parts, ['a', 'b', 'c']);
    });

    it('returns null when count does not match', () => {
      assert.equal(splitExact('a:b', ':', 3), null);
      assert.equal(splitExact('a:b:c:d', ':', 3), null);
    });
  });

  describe('splitAtLeast', () => {
    it('returns parts when count >= min', () => {
      const parts = splitAtLeast('a:b:c:d', ':', 3);
      assert.ok(parts !== null);
      assert.equal(parts.length, 4);
    });

    it('returns null when below minimum', () => {
      assert.equal(splitAtLeast('a:b', ':', 3), null);
    });
  });
});
