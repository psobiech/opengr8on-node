import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, parseRxFrame, parseBusTxFrame, BROADCAST } from '../../dist/tfbus/TFBusFrame.js';

describe('buildFrame', () => {
  it('RESET broadcast matches wire capture AA FF 07 52', () => {
    const frame = buildFrame(BROADCAST, 0x07);
    assert.deepEqual(frame, Buffer.from('aaff0752', 'hex'));
  });

  it('SEEK broadcast matches wire capture AA FF 2A 7F', () => {
    const frame = buildFrame(BROADCAST, 0x2A);
    assert.deepEqual(frame, Buffer.from('aafF2a7f', 'hex'));
  });

  it('FORCE_GET_STATUS broadcast matches wire capture AA FF 0B 5E', () => {
    const frame = buildFrame(BROADCAST, 0x0B);
    assert.deepEqual(frame, Buffer.from('aaff0b5e', 'hex'));
  });

  it('RESET unicast dest=0x0A matches wire capture AA 0A 07 A7', () => {
    const frame = buildFrame(0x0A, 0x07);
    assert.deepEqual(frame, Buffer.from('aa0a07a7', 'hex'));
  });

  it('total length = 3 + payloadLen + 1', () => {
    assert.equal(buildFrame(0x01, 0x04).length, 4);
    assert.equal(buildFrame(0x01, 0x02, Buffer.alloc(5)).length, 9);
  });

  it('starts with AA', () => {
    assert.equal(buildFrame(0x05, 0xF9)[0], 0xAA);
  });

  it('XOR checksum at last byte covers all preceding bytes', () => {
    const frame = buildFrame(0x03, 0xF0, Buffer.from([0x06, 0x01, 0x08, 0x01, 0x01, 0x80]));
    let xor = 0;
    for (let i = 0; i < frame.length - 1; i++) xor ^= frame[i];
    assert.equal(xor, frame[frame.length - 1]);
  });

  it('throws on payload > 29 bytes', () => {
    assert.throws(() => buildFrame(0x01, 0x04, Buffer.alloc(30)), RangeError);
  });
});

describe('parseRxFrame', () => {
  it('parses ACK frame AA 00 01 AB → empty payload', () => {
    const result = parseRxFrame(Buffer.from('aa0001ab', 'hex'));
    assert.ok(result !== null);
    assert.equal(result.payload.length, 0);
    assert.equal(result.length, 4);
  });

  it('parses frame with payload', () => {
    // Construct a valid RX frame: AA 00 03 p0 p1 CRC
    // remaining_len=3 → payloadLen=2, frameLen=6
    const payload = Buffer.from([0xAB, 0xCD]);
    const header = Buffer.from([0xAA, 0x00, 0x03]);
    let xor = 0xAA ^ 0x00 ^ 0x03 ^ 0xAB ^ 0xCD;
    const frame = Buffer.concat([header, payload, Buffer.from([xor])]);
    const result = parseRxFrame(frame);
    assert.ok(result !== null);
    assert.equal(result.payload.length, 2);
    assert.equal(result.payload[0], 0xAB);
    assert.equal(result.payload[1], 0xCD);
    assert.equal(result.length, 6);
  });

  it('returns null for too-short buffer', () => {
    assert.equal(parseRxFrame(Buffer.from([0xAA, 0x00, 0x01])), null);
  });

  it('returns null for wrong start byte', () => {
    assert.equal(parseRxFrame(Buffer.from('bb0001be', 'hex')), null);
  });

  it('returns null for wrong CRC', () => {
    assert.equal(parseRxFrame(Buffer.from('aa000100', 'hex')), null);
  });

  it('returns null for remaining_len > 0x1D', () => {
    assert.equal(parseRxFrame(Buffer.from([0xAA, 0x00, 0x1E, 0x00, 0x00, 0x00]), ), null);
  });

  it('returns null for incomplete buffer', () => {
    // remaining_len=5 requires frameLen=8 but only 5 bytes
    assert.equal(parseRxFrame(Buffer.from([0xAA, 0x00, 0x05, 0x01, 0x02])), null);
  });
});

describe('parseBusTxFrame', () => {
  it('parses a valid CLU→module frame: returns dest, type, payload', () => {
    // STATUS_POLL to addr 3: AA 03 04 AD
    const frame = buildFrame(0x03, 0x04);
    const result = parseBusTxFrame(frame);
    assert.ok(result !== null);
    assert.equal(result.dest, 0x03);
    assert.equal(result.type, 0x04);
    assert.deepEqual(result.payload, Buffer.alloc(0));
  });

  it('returns null for frame addressed to CLU (dest=0x00)', () => {
    // AA 00 01 AB — module ACK frame
    const ack = Buffer.from('aa0001ab', 'hex');
    assert.equal(parseBusTxFrame(ack), null);
  });

  it('returns null for bad start byte', () => {
    const bad = Buffer.from([0xBB, 0x03, 0x04, 0xB4]);
    assert.equal(parseBusTxFrame(bad), null);
  });

  it('returns null for buffer shorter than 4 bytes', () => {
    assert.equal(parseBusTxFrame(Buffer.from([0xAA, 0x03, 0x04])), null);
  });

  it('extracts payload bytes for frame with payload', () => {
    // ADDR_ASSIGN: AA FF 02 3C 24 F6 0E 01 B6 — payload = [3C 24 F6 0E 01]
    const frame = Buffer.from('aaff023c24f60e01b6', 'hex');
    const result = parseBusTxFrame(frame);
    assert.ok(result !== null);
    assert.equal(result.dest, 0xFF);
    assert.equal(result.type, 0x02);
    assert.deepEqual(result.payload, Buffer.from([0x3C, 0x24, 0xF6, 0x0E, 0x01]));
  });

  it('4-byte frame (no payload beyond header) returns empty payload', () => {
    const frame = buildFrame(BROADCAST, 0x2A); // SEEK = AA FF 2A 7F
    const result = parseBusTxFrame(frame);
    assert.ok(result !== null);
    assert.equal(result.dest, BROADCAST);
    assert.deepEqual(result.payload, Buffer.alloc(0));
  });
});
