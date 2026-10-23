import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersionResponse } from '../../dist/tfbus/VersionQueryResponse.js';

describe('parseVersionResponse', () => {
  it('parses 3-byte payload: hwType hwVer fwApiVer, extra=null', () => {
    const result = parseVersionResponse(Buffer.from([0x02, 0x01, 0x02]));
    assert.ok(result !== null);
    assert.equal(result.hwType, 0x02);
    assert.equal(result.hwVer, 0x01);
    assert.equal(result.fwApiVer, 0x02);
    assert.equal(result.extra, null);
  });

  it('parses 4-byte payload: extra field is 4th byte', () => {
    const result = parseVersionResponse(Buffer.from([0x01, 0x00, 0x00, 0x01]));
    assert.ok(result !== null);
    assert.equal(result.hwType, 0x01);
    assert.equal(result.hwVer, 0x00);
    assert.equal(result.fwApiVer, 0x00);
    assert.equal(result.extra, 0x01);
  });

  it('returns null for payload shorter than 3 bytes', () => {
    assert.equal(parseVersionResponse(Buffer.from([0x02, 0x01])), null);
  });

  it('returns null for null input', () => {
    assert.equal(parseVersionResponse(null), null);
  });

  it('raw field references the original buffer', () => {
    const buf = Buffer.from([0x1E, 0x02, 0x02]);
    const result = parseVersionResponse(buf);
    assert.deepEqual(result.raw, buf);
  });

  it('maps hwType=0x1E (30 = IO_MODULE_DIN_8 family) correctly', () => {
    const result = parseVersionResponse(Buffer.from([0x1E, 0x02, 0x02]));
    assert.equal(result.hwType, 30);
  });
});
