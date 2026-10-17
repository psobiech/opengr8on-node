import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmartPanelResponse } from '../../src/tfbus/StatusPollResponse.js';

function makePayload({ buttonMask = 0, edgeMask = 0, lightRaw = 0 } = {}) {
  const buf = Buffer.alloc(13, 0);
  buf.writeUInt16LE(buttonMask, 0);
  buf.writeUInt16LE(edgeMask, 2);
  buf.writeUInt16LE(lightRaw, 4);
  buf[12] = 0x02;
  return buf;
}

describe('parseSmartPanelResponse', () => {
  it('returns null for non-13-byte payload', () => {
    assert.equal(parseSmartPanelResponse(Buffer.alloc(10, 0)), null);
    assert.equal(parseSmartPanelResponse(Buffer.alloc(14, 0)), null);
  });

  it('returns null when byte[12] is not 0x02', () => {
    const buf = makePayload();
    buf[12] = 0x00;
    assert.equal(parseSmartPanelResponse(buf), null);
  });

  it('returns null for null input', () => {
    assert.equal(parseSmartPanelResponse(null), null);
  });

  it('parses buttonMask LE u16', () => {
    // bit 3 set = button at index 3 active
    const result = parseSmartPanelResponse(makePayload({ buttonMask: 0x0008 }));
    assert.ok(result !== null);
    assert.equal(result.buttonMask, 0x0008);
    assert.ok(result.buttonMask & (1 << 3)); // bit 3 set
  });

  it('edgeMask non-zero on press, zero on release', () => {
    const pressing  = parseSmartPanelResponse(makePayload({ buttonMask: 0x01, edgeMask: 0x01 }));
    const releasing = parseSmartPanelResponse(makePayload({ buttonMask: 0x01, edgeMask: 0x00 }));
    assert.ok(pressing.edgeMask !== 0);
    assert.equal(releasing.edgeMask, 0);
  });

  it('lightLevel = lightRaw / 100 (unit 0.01%)', () => {
    const result = parseSmartPanelResponse(makePayload({ lightRaw: 2000 }));
    assert.equal(result.lightLevel, 20.0); // 2000 / 100 = 20%
  });

  it('lightLevel 0 when dark', () => {
    const result = parseSmartPanelResponse(makePayload({ lightRaw: 0 }));
    assert.equal(result.lightLevel, 0);
  });

  it('raw field is the original buffer', () => {
    const buf = makePayload({ buttonMask: 0x05 });
    const result = parseSmartPanelResponse(buf);
    assert.equal(result.raw, buf);
  });

  it('valid 13-byte all-zero payload with 0x02 flag parses as idle state', () => {
    const result = parseSmartPanelResponse(makePayload());
    assert.equal(result.buttonMask, 0);
    assert.equal(result.edgeMask, 0);
    assert.equal(result.lightLevel, 0);
  });
});
