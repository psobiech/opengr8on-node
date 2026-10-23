import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateMeasurementsCommand, RESPONSE_OK } from '../../dist/commands/GenerateMeasurementsCommand.js';
import { CRLF } from '../../dist/constants.js';

const LOCAL_IP = '10.0.0.1';
const SESSION_ID = 0xCAFE;
const UNKNOWN = '0';

describe('GenerateMeasurementsCommand', () => {
  it('RESPONSE_OK is "ok"', () => {
    assert.equal(RESPONSE_OK, 'ok');
  });

  describe('request', () => {
    it('toBuffer() format: req_gen_measurements:ip:sessionId:unknown\\r\\n', () => {
      const str = GenerateMeasurementsCommand.request(LOCAL_IP, SESSION_ID, UNKNOWN).toBuffer().toString();
      assert.ok(str.startsWith('req_gen_measurements:'), str);
      assert.ok(str.includes(`:${LOCAL_IP}:`), str);
      assert.ok(str.endsWith(CRLF), `should end with CRLF: ${JSON.stringify(str.slice(-2))}`);
    });

    it('session ID is zero-padded to 8 hex chars', () => {
      const str = GenerateMeasurementsCommand.request(LOCAL_IP, 0xCA, UNKNOWN).toBuffer().toString();
      assert.ok(str.includes(':000000ca:'), str);
    });

    it('requestMatches() true', () => {
      const buf = GenerateMeasurementsCommand.request(LOCAL_IP, SESSION_ID, UNKNOWN).toBuffer();
      assert.ok(GenerateMeasurementsCommand.requestMatches(buf));
    });

    it('requestFromBuffer() parses all fields', () => {
      const buf = GenerateMeasurementsCommand.request(LOCAL_IP, SESSION_ID, UNKNOWN).toBuffer();
      const parsed = GenerateMeasurementsCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, LOCAL_IP);
      assert.equal(parsed.sessionId, SESSION_ID);
    });
  });

  describe('response', () => {
    it('toBuffer() format: meas_file_download:ip:sessionId:returnValue', () => {
      const str = GenerateMeasurementsCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer().toString();
      assert.ok(str.startsWith('meas_file_download:'), str);
      assert.ok(str.endsWith(':ok'), str);
    });

    it('responseMatches() true for own buffer', () => {
      const buf = GenerateMeasurementsCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer();
      assert.ok(GenerateMeasurementsCommand.responseMatches(buf));
    });

    it('responseFromBuffer() parses all fields', () => {
      const buf = GenerateMeasurementsCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer();
      const parsed = GenerateMeasurementsCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, LOCAL_IP);
      assert.equal(parsed.sessionId, SESSION_ID);
      assert.equal(parsed.returnValue, 'ok');
    });
  });

  describe('parse', () => {
    it('returns returnValue when sessionId matches', () => {
      const buf = GenerateMeasurementsCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer();
      assert.equal(GenerateMeasurementsCommand.parse(SESSION_ID, buf), 'ok');
    });

    it('returns null for wrong sessionId', () => {
      const buf = GenerateMeasurementsCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer();
      assert.equal(GenerateMeasurementsCommand.parse(0x9999, buf), null);
    });
  });
});
