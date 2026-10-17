import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SetKeyCommand } from '../../src/commands/SetKeyCommand.js';
import { randomBytes } from '../../src/util/random.js';
import { RANDOM_ENCRYPTED_BYTES, IV_BYTES, KEY_BYTES } from '../../src/constants.js';

describe('SetKeyCommand', () => {
  const encrypted = randomBytes(RANDOM_ENCRYPTED_BYTES);
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);

  describe('request', () => {
    it('toBuffer() has correct byte layout', () => {
      const buf = SetKeyCommand.request(encrypted, key, iv).toBuffer();
      // encrypted(32) : iv(16) : req_set_key : key(16)
      assert.ok(buf.subarray(0, RANDOM_ENCRYPTED_BYTES).equals(encrypted));
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES], 0x3A);
      assert.ok(buf.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES).equals(iv));
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES], 0x3A);
      const cmdPart = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1).toString();
      assert.ok(cmdPart.startsWith('req_set_key:'), cmdPart);
      const keyInBuf = buf.subarray(buf.length - KEY_BYTES);
      assert.ok(keyInBuf.equals(key));
    });

    it('requestMatches() true for own buffer', () => {
      const buf = SetKeyCommand.request(encrypted, key, iv).toBuffer();
      assert.ok(SetKeyCommand.requestMatches(buf));
    });

    it('requestFromBuffer() parses fields back', () => {
      const buf = SetKeyCommand.request(encrypted, key, iv).toBuffer();
      const parsed = SetKeyCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.ok(parsed.encrypted.equals(encrypted));
      assert.ok(parsed.iv.equals(iv));
      assert.ok(parsed.key.equals(key));
    });
  });

  describe('response', () => {
    it('toBuffer() is "resp:OK"', () => {
      assert.equal(SetKeyCommand.response().toBuffer().toString(), 'resp:OK');
    });

    it('responseMatches() true for "resp:OK"', () => {
      assert.ok(SetKeyCommand.responseMatches(Buffer.from('resp:OK')));
    });

    it('responseMatches() true for "resp:OK\\r\\n"', () => {
      assert.ok(SetKeyCommand.responseMatches(Buffer.from('resp:OK\r\n')));
    });

    it('responseMatches() false for wrong string', () => {
      assert.ok(!SetKeyCommand.responseMatches(Buffer.from('resp:ERROR')));
    });

    it('responseFromBuffer() returns object for valid buffer', () => {
      const result = SetKeyCommand.responseFromBuffer(Buffer.from('resp:OK'));
      assert.ok(result !== null);
    });
  });
});
