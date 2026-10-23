import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StartTFTPdCommand } from '../../dist/commands/StartTFTPdCommand.js';
import { StopTFTPdCommand } from '../../dist/commands/StopTFTPdCommand.js';
import { ErrorCommand } from '../../dist/commands/ErrorCommand.js';

describe('StartTFTPdCommand', () => {
  it('request toBuffer() is "req_start_ftp"', () => {
    assert.equal(StartTFTPdCommand.request().toBuffer().toString(), 'req_start_ftp');
  });

  it('requestMatches() true for exact string', () => {
    assert.ok(StartTFTPdCommand.requestMatches(Buffer.from('req_start_ftp')));
  });

  it('requestMatches() true with CRLF', () => {
    assert.ok(StartTFTPdCommand.requestMatches(Buffer.from('req_start_ftp\r\n')));
  });

  it('requestMatches() false for wrong string', () => {
    assert.ok(!StartTFTPdCommand.requestMatches(Buffer.from('req_tftp_stop')));
  });

  it('requestFromBuffer() returns object for valid', () => {
    assert.ok(StartTFTPdCommand.requestFromBuffer(Buffer.from('req_start_ftp')) !== null);
  });

  it('response toBuffer() is "resp:OK"', () => {
    assert.equal(StartTFTPdCommand.response().toBuffer().toString(), 'resp:OK');
  });

  it('responseMatches() true for "resp:OK"', () => {
    assert.ok(StartTFTPdCommand.responseMatches(Buffer.from('resp:OK')));
  });

  it('responseMatches() false for "resp:ERROR"', () => {
    assert.ok(!StartTFTPdCommand.responseMatches(Buffer.from('resp:ERROR')));
  });
});

describe('StopTFTPdCommand', () => {
  it('request toBuffer() is "req_tftp_stop"', () => {
    assert.equal(StopTFTPdCommand.request().toBuffer().toString(), 'req_tftp_stop');
  });

  it('requestMatches() true', () => {
    assert.ok(StopTFTPdCommand.requestMatches(Buffer.from('req_tftp_stop')));
  });

  it('requestMatches() true with CRLF', () => {
    assert.ok(StopTFTPdCommand.requestMatches(Buffer.from('req_tftp_stop\r\n')));
  });

  it('responseMatches() true for "resp:OK"', () => {
    assert.ok(StopTFTPdCommand.responseMatches(Buffer.from('resp:OK')));
  });

  it('responseFromBuffer() returns object for valid', () => {
    assert.ok(StopTFTPdCommand.responseFromBuffer(Buffer.from('resp:OK')) !== null);
  });
});

describe('ErrorCommand', () => {
  it('responseMatches() true for "resp:ERROR"', () => {
    assert.ok(ErrorCommand.responseMatches(Buffer.from('resp:ERROR')));
  });

  it('responseMatches() true with CRLF', () => {
    assert.ok(ErrorCommand.responseMatches(Buffer.from('resp:ERROR\r\n')));
  });

  it('responseMatches() false for "resp:OK"', () => {
    assert.ok(!ErrorCommand.responseMatches(Buffer.from('resp:OK')));
  });

  it('responseFromBuffer() returns object for valid', () => {
    assert.ok(ErrorCommand.responseFromBuffer(Buffer.from('resp:ERROR')) !== null);
  });

  it('responseFromBuffer() returns null for non-matching', () => {
    assert.equal(ErrorCommand.responseFromBuffer(Buffer.from('resp:OK')), null);
  });
});
