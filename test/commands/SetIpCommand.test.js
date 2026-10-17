import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SetIpCommand } from '../../src/commands/SetIpCommand.js';

const SERIAL = 0x00ABCDEF;
const IP = '192.168.1.100';
const GW = '192.168.1.1';

describe('SetIpCommand', () => {
  describe('request', () => {
    it('toBuffer() format: req_set_clu_ip:sn:ip:gw', () => {
      const str = SetIpCommand.request(SERIAL, IP, GW).toBuffer().toString();
      assert.ok(str.startsWith('req_set_clu_ip:'), str);
      assert.ok(str.endsWith(`:${IP}:${GW}`), str);
    });

    it('serial number zero-padded to 8 chars', () => {
      const str = SetIpCommand.request(0x1234, IP, GW).toBuffer().toString();
      assert.ok(str.includes(':00001234:'), str);
    });

    it('requestMatches() true for own buffer', () => {
      const buf = SetIpCommand.request(SERIAL, IP, GW).toBuffer();
      assert.ok(SetIpCommand.requestMatches(buf));
    });

    it('requestMatches() false for short buffer', () => {
      assert.ok(!SetIpCommand.requestMatches(Buffer.from('req_set_clu_ip')));
    });

    it('requestFromBuffer() parses all fields', () => {
      const buf = SetIpCommand.request(SERIAL, IP, GW).toBuffer();
      const parsed = SetIpCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.serialNumber, SERIAL);
      assert.equal(parsed.ipAddress, IP);
      assert.equal(parsed.gatewayIpAddress, GW);
    });
  });

  describe('response', () => {
    it('toBuffer() format: resp_set_clu_ip:sn:ip', () => {
      const str = SetIpCommand.response(SERIAL, IP).toBuffer().toString();
      assert.ok(str.startsWith('resp_set_clu_ip:'), str);
      assert.ok(str.endsWith(`:${IP}`), str);
    });

    it('responseMatches() true for own buffer', () => {
      const buf = SetIpCommand.response(SERIAL, IP).toBuffer();
      assert.ok(SetIpCommand.responseMatches(buf));
    });

    it('responseMatches() false for request buffer', () => {
      const buf = SetIpCommand.request(SERIAL, IP, GW).toBuffer();
      assert.ok(!SetIpCommand.responseMatches(buf));
    });

    it('responseFromBuffer() parses all fields', () => {
      const buf = SetIpCommand.response(SERIAL, IP).toBuffer();
      const parsed = SetIpCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.serialNumber, SERIAL);
      assert.equal(parsed.ipAddress, IP);
    });
  });
});
