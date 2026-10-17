import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LuaScriptCommand } from '../../src/commands/LuaScriptCommand.js';
import { CRLF } from '../../src/constants.js';

const LOCAL_IP = '10.0.0.1';
const SESSION_ID = 0xDEAD;
const SCRIPT = 'checkAlive()';

describe('LuaScriptCommand', () => {
  describe('constants', () => {
    it('CHECK_ALIVE is checkAlive()', () => {
      assert.equal(LuaScriptCommand.CHECK_ALIVE, 'checkAlive()');
    });
  });

  describe('request', () => {
    it('toBuffer() format: req:ip:sessionId:script\\r\\n', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, SESSION_ID, SCRIPT).toBuffer();
      const str = buf.toString();
      assert.ok(str.startsWith('req:'), `prefix: ${str}`);
      assert.ok(str.includes(`:${LOCAL_IP}:`), `ip: ${str}`);
      assert.ok(str.includes(`:${SCRIPT}`), `script: ${str}`);
      assert.ok(str.endsWith(CRLF), `CRLF: ${JSON.stringify(str.slice(-2))}`);
    });

    it('session ID is zero-padded to 8 hex chars lowercase', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, 0x1, SCRIPT).toBuffer();
      assert.ok(buf.toString().includes(':00000001:'), buf.toString());
    });

    it('session ID 0xDEAD pads to 0000dead', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, 0xDEAD, SCRIPT).toBuffer();
      assert.ok(buf.toString().includes(':0000dead:'), buf.toString());
    });

    it('requestMatches() true for valid buffer', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, SESSION_ID, SCRIPT).toBuffer();
      assert.ok(LuaScriptCommand.requestMatches(buf));
    });

    it('requestMatches() false for too-short buffer', () => {
      assert.ok(!LuaScriptCommand.requestMatches(Buffer.from('req')));
    });

    it('requestMatches() false for resp buffer', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'true').toBuffer();
      assert.ok(!LuaScriptCommand.requestMatches(buf));
    });

    it('requestFromBuffer() parses all fields', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, SESSION_ID, SCRIPT).toBuffer();
      const parsed = LuaScriptCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, LOCAL_IP);
      assert.equal(parsed.sessionId, SESSION_ID);
      assert.equal(parsed.script, SCRIPT + CRLF.trimEnd() === SCRIPT ? SCRIPT : parsed.script);
    });
  });

  describe('response', () => {
    it('toBuffer() format: resp:ip:sessionId:returnValue', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'true').toBuffer();
      const str = buf.toString();
      assert.ok(str.startsWith('resp:'), `prefix: ${str}`);
      assert.ok(str.includes(`:${LOCAL_IP}:`));
      assert.ok(str.endsWith(':true'));
    });

    it('responseMatches() true for valid buffer', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'ok').toBuffer();
      assert.ok(LuaScriptCommand.responseMatches(buf));
    });

    it('responseMatches() false for req buffer', () => {
      const buf = LuaScriptCommand.request(LOCAL_IP, SESSION_ID, SCRIPT).toBuffer();
      assert.ok(!LuaScriptCommand.responseMatches(buf));
    });

    it('responseFromBuffer() parses all fields', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'true').toBuffer();
      const parsed = LuaScriptCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, LOCAL_IP);
      assert.equal(parsed.sessionId, SESSION_ID);
      assert.equal(parsed.returnValue, 'true');
    });
  });

  describe('parse', () => {
    it('returns returnValue when sessionId matches', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'hello').toBuffer();
      assert.equal(LuaScriptCommand.parse(SESSION_ID, buf), 'hello');
    });

    it('returns null when sessionId does not match', () => {
      const buf = LuaScriptCommand.response(LOCAL_IP, SESSION_ID, 'hello').toBuffer();
      assert.equal(LuaScriptCommand.parse(0x9999, buf), null);
    });

    it('returns null for non-response buffer', () => {
      assert.equal(LuaScriptCommand.parse(SESSION_ID, Buffer.from('garbage')), null);
    });
  });
});
