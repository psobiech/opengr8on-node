import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResetCommand } from '../../src/commands/ResetCommand.js';

const IP = '192.168.1.99';

describe('ResetCommand', () => {
  describe('request', () => {
    it('toBuffer() format: req_reset:ip', () => {
      const str = ResetCommand.request(IP).toBuffer().toString();
      assert.equal(str, `req_reset:${IP}`);
    });

    it('requestMatches() true', () => {
      assert.ok(ResetCommand.requestMatches(ResetCommand.request(IP).toBuffer()));
    });

    it('requestMatches() false for short buffer', () => {
      assert.ok(!ResetCommand.requestMatches(Buffer.from('req_reset')));
    });

    it('requestFromBuffer() parses ipAddress', () => {
      const buf = ResetCommand.request(IP).toBuffer();
      const parsed = ResetCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, IP);
    });
  });

  describe('response', () => {
    it('toBuffer() format: resp_reset:ip', () => {
      assert.equal(ResetCommand.response(IP).toBuffer().toString(), `resp_reset:${IP}`);
    });

    it('responseMatches() true', () => {
      assert.ok(ResetCommand.responseMatches(ResetCommand.response(IP).toBuffer()));
    });

    it('responseMatches() false for request buffer', () => {
      assert.ok(!ResetCommand.responseMatches(ResetCommand.request(IP).toBuffer()));
    });

    it('responseFromBuffer() parses ipAddress', () => {
      const buf = ResetCommand.response(IP).toBuffer();
      const parsed = ResetCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, IP);
    });
  });
});
