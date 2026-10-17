import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pollAddress, pollBus, receiveMessage } from '../../src/tfbus/TFBusBus.js';
import { statusPollFrame } from '../../src/tfbus/TFBusCommands.js';
import { TLVType } from '../../src/tfbus/StatusPollResponse.js';

// Build a valid module→CLU RX frame wrapping a TLV payload
function buildRxFrame(payload) {
  const remainingLen = payload.length + 1;
  const header = Buffer.from([0xAA, 0x00, remainingLen]);
  let xor = 0;
  for (const b of header) xor ^= b;
  for (const b of payload) xor ^= b;
  return Buffer.concat([header, payload, Buffer.from([xor])]);
}

// Mock queue: pre-loaded RX responses; records TX frames enqueued
function mockQueue(rxPayloads) {
  const rxFrames = rxPayloads.map(p =>
    p === null ? null : buildRxFrame(Buffer.from(p)),
  );
  const txLog = [];
  return {
    txLog,
    enqueue(buf) { txLog.push(buf); },
    async dequeue() { return rxFrames.shift() ?? null; },
  };
}

describe('pollAddress', () => {
  it('enqueues STATUS_POLL for the correct address', async () => {
    const q = mockQueue([[]]); // empty payload → ACK
    await pollAddress(0x05, q);
    assert.deepEqual(q.txLog[0], statusPollFrame(0x05));
  });

  it('returns null when dequeue times out (null response)', async () => {
    const q = mockQueue([null]);
    assert.equal(await pollAddress(0x01, q), null);
  });

  it('returns null on invalid RX frame', async () => {
    const q = { enqueue() {}, async dequeue() { return Buffer.from([0xFF, 0x00, 0x00, 0x00]); } };
    assert.equal(await pollAddress(0x01, q), null);
  });

  it('ACK response (empty payload) → address + empty records', async () => {
    const q = mockQueue([[]]); // empty payload
    const result = await pollAddress(0x03, q);
    assert.ok(result !== null);
    assert.equal(result.address, 0x03);
    assert.deepEqual(result.records, []);
  });

  it('parses single-channel DIGITAL_STATE TLV', async () => {
    // 01 06 01 01 02 = count=1, DIGITAL_STATE, meta=0x01, active
    const q = mockQueue([[0x01, 0x06, 0x01, 0x01, 0x02]]);
    const result = await pollAddress(0x0A, q);
    assert.ok(result !== null);
    assert.equal(result.address, 0x0A);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].type, TLVType.DIGITAL_STATE);
    assert.equal(result.records[0].data[0], 0x02);
  });

  it('parses TEMPERATURE TLV', async () => {
    // 01 02 02 10 6a 09 = count=1, TEMPERATURE, data=0x096A=24.10°C
    const q = mockQueue([[0x01, 0x02, 0x02, 0x10, 0x6A, 0x09]]);
    const result = await pollAddress(0x07, q);
    assert.ok(result !== null);
    assert.equal(result.records[0].type, TLVType.TEMPERATURE);
    assert.equal(result.records[0].data.readUInt16LE(0) / 100, 24.10);
  });

  it('preserves raw payload on result', async () => {
    const payload = [0x01, 0x06, 0x01, 0x01, 0x00];
    const q = mockQueue([payload]);
    const result = await pollAddress(0x01, q);
    assert.deepEqual(result.raw, Buffer.from(payload));
  });
});

describe('pollBus', () => {
  it('returns Map keyed by address', async () => {
    const q = mockQueue([[], [], []]);
    const results = await pollBus([0x01, 0x02, 0x03], q);
    assert.equal(results.size, 3);
    assert.ok(results.has(0x01));
    assert.ok(results.has(0x02));
    assert.ok(results.has(0x03));
  });

  it('stores null for timed-out addresses', async () => {
    const q = mockQueue([[], null, []]);
    const results = await pollBus([0x01, 0x02, 0x03], q);
    assert.ok(results.get(0x01) !== null);
    assert.equal(results.get(0x02), null);
    assert.ok(results.get(0x03) !== null);
  });

  it('enqueues STATUS_POLL to each address in order', async () => {
    const q = mockQueue([[], [], []]);
    await pollBus([0x05, 0x0A, 0x0F], q);
    assert.equal(q.txLog.length, 3);
    assert.equal(q.txLog[0][1], 0x05);
    assert.equal(q.txLog[1][1], 0x0A);
    assert.equal(q.txLog[2][1], 0x0F);
  });

  it('works with an address range array', async () => {
    const addrs = Array.from({ length: 5 }, (_, i) => i + 1);
    const q = mockQueue(addrs.map(() => []));
    const results = await pollBus(addrs, q);
    assert.equal(results.size, 5);
    for (let i = 1; i <= 5; i++) assert.ok(results.has(i));
  });
});

describe('receiveMessage', () => {
  it('returns null on empty queue', async () => {
    const q = { async dequeue() { return null; } };
    assert.equal(await receiveMessage(q), null);
  });

  it('parses an unsolicited RX frame', async () => {
    const payload = Buffer.from([0x01, 0x06, 0x01, 0x01, 0x00]);
    const q = { async dequeue() { return buildRxFrame(payload); } };
    const result = await receiveMessage(q);
    assert.ok(result !== null);
    assert.equal(result.records[0].type, TLVType.DIGITAL_STATE);
  });

  it('returns null on invalid frame', async () => {
    const q = { async dequeue() { return Buffer.from([0x00, 0x00, 0x00, 0x00]); } };
    assert.equal(await receiveMessage(q), null);
  });
});
