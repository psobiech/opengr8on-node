import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResetCommand } from '../../dist/commands/ResetCommand.js';

const CLU_IP = '192.168.1.99';

describe('ResetCommand', () => {
  describe('request', () => {
    it('toBuffer() format: req_reset:ip', () => {
      const str = ResetCommand.request(CLU_IP).toBuffer().toString();
      assert.equal(str, `req_reset:${CLU_IP}`);
    });

    it('requestMatches() true', () => {
      assert.ok(ResetCommand.requestMatches(ResetCommand.request(CLU_IP).toBuffer()));
    });

    it('requestMatches() false for short buffer', () => {
      assert.ok(!ResetCommand.requestMatches(Buffer.from('req_reset')));
    });

    it('requestFromBuffer() parses ipAddress', () => {
      const buf = ResetCommand.request(CLU_IP).toBuffer();
      const parsed = ResetCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, CLU_IP);
    });
  });

  describe('response', () => {
    it('toBuffer() format: resp_reset:ip', () => {
      assert.equal(ResetCommand.response(CLU_IP).toBuffer().toString(), `resp_reset:${CLU_IP}`);
    });

    it('responseMatches() true', () => {
      assert.ok(ResetCommand.responseMatches(ResetCommand.response(CLU_IP).toBuffer()));
    });

    it('responseMatches() false for request buffer', () => {
      assert.ok(!ResetCommand.responseMatches(ResetCommand.request(CLU_IP).toBuffer()));
    });

    it('responseFromBuffer() parses ipAddress', () => {
      const buf = ResetCommand.response(CLU_IP).toBuffer();
      const parsed = ResetCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, CLU_IP);
    });
  });
});
