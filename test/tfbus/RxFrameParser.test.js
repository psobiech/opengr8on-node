import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RxFrameParser } from '../../dist/tfbus/transport/RxFrameParser.js';
import { buildFrame } from '../../dist/tfbus/TFBusFrame.js';
import { addrAssignFrame, statusPollFrame, checkAliveFrame, moduleCmdFrame, activateRecord } from '../../dist/tfbus/TFBusCommands.js';

// Build a valid PROVISION frame (type 0xFB, 25 bytes)
function provisionFrame(dest = 0xFF) {
  const payload = Buffer.alloc(21, 0);
  return buildFrame(dest, 0xFB, payload);
}

describe('RxFrameParser', () => {
  it('returns single complete frame immediately', () => {
    const p = new RxFrameParser();
    const frame = statusPollFrame(0x03);
    const frames = p.push(frame);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], frame);
  });

  it('returns empty array for partial frame', () => {
    const p = new RxFrameParser();
    const frame = statusPollFrame(0x03);
    assert.deepEqual(p.push(frame.subarray(0, 2)), []);
  });

  it('assembles frame split across two pushes', () => {
    const p = new RxFrameParser();
    const frame = statusPollFrame(0x03);
    assert.deepEqual(p.push(frame.subarray(0, 2)), []);
    const frames = p.push(frame.subarray(2));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], frame);
  });

  it('skips garbage bytes before 0xAA start byte', () => {
    const p = new RxFrameParser();
    const frame = statusPollFrame(0x03);
    const garbage = Buffer.from([0x01, 0x02, 0xBB]);
    const frames = p.push(Buffer.concat([garbage, frame]));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], frame);
  });

  it('skips frame with bad CRC, finds next valid frame', () => {
    const p = new RxFrameParser();
    const good = statusPollFrame(0x03);
    const bad = Buffer.from([0xAA, 0x03, 0x04, 0xFF]); // wrong CRC
    const frames = p.push(Buffer.concat([bad, good]));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], good);
  });

  it('TFBUS_CMD (0x31) uses fixed typedLen=26, not remainingLen field', () => {
    const p = new RxFrameParser();
    const frame = checkAliveFrame(0x01);
    assert.equal(frame.length, 26);
    // byte[2]=0x31, byte[2] is the remainingLen field but should NOT drive length
    const frames = p.push(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, 26);
  });

  it('ADDR_ASSIGN (0x02) uses fixed typedLen=9', () => {
    const p = new RxFrameParser();
    const frame = addrAssignFrame(0x0EF6243C, 1);
    assert.equal(frame.length, 9);
    const frames = p.push(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, 9);
  });

  it('PROVISION (0xFB) uses fixed typedLen=25', () => {
    const p = new RxFrameParser();
    const frame = provisionFrame();
    assert.equal(frame.length, 25);
    const frames = p.push(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, 25);
  });

  it('MODULE_CMD (0xF0) length driven by plen byte', () => {
    const p = new RxFrameParser();
    const frame = moduleCmdFrame(0x03, [activateRecord(0x80)]);
    // plen=6 → total=10 bytes
    assert.equal(frame.length, 10);
    assert.equal(frame[3], 6); // plen byte
    const frames = p.push(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].length, 10);
  });

  it('MODULE_CMD partial: waits until plen worth of bytes arrive', () => {
    const p = new RxFrameParser();
    const frame = moduleCmdFrame(0x03, [activateRecord(0x80)]); // 10 bytes
    assert.deepEqual(p.push(frame.subarray(0, 5)), []);
    const frames = p.push(frame.subarray(5));
    assert.equal(frames.length, 1);
  });

  it('delivers multiple frames from single push', () => {
    const p = new RxFrameParser();
    const f1 = statusPollFrame(0x01);
    const f2 = statusPollFrame(0x02);
    const f3 = checkAliveFrame(0x03);
    const frames = p.push(Buffer.concat([f1, f2, f3]));
    assert.equal(frames.length, 3);
    assert.deepEqual(frames[0], f1);
    assert.deepEqual(frames[1], f2);
    assert.deepEqual(frames[2], f3);
  });

  it('STATUS_POLL response (dest=0x00, remainingLen>1) parsed via rlLen', () => {
    const p = new RxFrameParser();
    // Simulate a module STATUS_POLL response: AA 00 remaining_len payload... CRC
    const tlvPayload = Buffer.from([0x01, 0x06, 0x01, 0x01, 0x00]); // 1 TLV record
    const remainingLen = tlvPayload.length + 1;
    const header = Buffer.from([0xAA, 0x00, remainingLen]);
    let crc = 0;
    for (const b of header) crc ^= b;
    for (const b of tlvPayload) crc ^= b;
    const rxFrame = Buffer.concat([header, tlvPayload, Buffer.from([crc])]);
    const frames = p.push(rxFrame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0][1], 0x00); // dest = CLU addr
  });
});
