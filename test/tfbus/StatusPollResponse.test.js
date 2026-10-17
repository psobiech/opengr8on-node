import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatusPoll, parseTemperatureCelsius, parseButtonEvent,
  TLVType, ButtonEvent,
} from '../../src/tfbus/StatusPollResponse.js';
import { parseRxFrame } from '../../src/tfbus/TFBusFrame.js';

describe('parseStatusPoll', () => {
  it('empty payload returns empty records array', () => {
    const result = parseStatusPoll(Buffer.alloc(0));
    assert.deepEqual(result.records, []);
  });

  it('parses IO_MODULE_DIN_8 14-byte TLV (count=3)', () => {
    // 03  00 01 01 00  01 01 01 00  02 02 10 6c 09
    const payload = Buffer.from('030001010001010100020 2106c09'.replace(/\s/g, ''), 'hex');
    const { records } = parseStatusPoll(payload);
    assert.ok(records !== null);
    assert.equal(records.length, 3);
    assert.equal(records[0].type, TLVType.INPUT_BITMASK);
    assert.equal(records[0].meta, 0x01);
    assert.equal(records[0].data[0], 0x00);
    assert.equal(records[1].type, TLVType.STATE);
    assert.equal(records[2].type, TLVType.TEMPERATURE);
    assert.equal(records[2].meta, 0x10);
    assert.equal(records[2].data.length, 2);
  });

  it('IO_MODULE_DIN_8 temperature decodes to 24.12°C', () => {
    const payload = Buffer.from('03000101000101010002021 06c09'.replace(/\s/g, ''), 'hex');
    const { records } = parseStatusPoll(payload);
    assert.equal(parseTemperatureCelsius(records[2].data), 24.12);
  });

  it('parses 5-byte single-channel TLV (count=1)', () => {
    // 01  06 01 01 02  (digital state = active)
    const payload = Buffer.from([0x01, 0x06, 0x01, 0x01, 0x02]);
    const { records } = parseStatusPoll(payload);
    assert.ok(records !== null);
    assert.equal(records.length, 1);
    assert.equal(records[0].type, TLVType.DIGITAL_STATE);
    assert.equal(records[0].data[0], 0x02);
  });

  it('parses 10-byte touch panel TLV with button event (count=2)', () => {
    // 02  06 01 01 00  08 02 10 18 00
    // rec2 type=0x08 (BUTTON_EVENT), VAL=0x18=24
    const payload = Buffer.from([0x02, 0x06, 0x01, 0x01, 0x00, 0x08, 0x02, 0x10, 0x18, 0x00]);
    const { records } = parseStatusPoll(payload);
    assert.ok(records !== null);
    assert.equal(records.length, 2);
    assert.equal(records[1].type, TLVType.BUTTON_EVENT);
    const evt = parseButtonEvent(records[1].data[0]);
    assert.equal(evt.buttonIndex, 3);
    assert.equal(evt.eventId, ButtonEvent.ON_SHORT_PRESS);
  });

  it('returns null records for non-TLV payload (count mismatch)', () => {
    // count=5 but only 3 bytes follow → truncated
    const payload = Buffer.from([0x05, 0x06, 0x01, 0x00]);
    const { records, raw } = parseStatusPoll(payload);
    assert.equal(records, null);
    assert.equal(raw.length, 4);
  });

  it('returns null records when trailing bytes remain', () => {
    // count=1 record of 4 bytes, but payload has 1 extra byte
    const payload = Buffer.from([0x01, 0x06, 0x01, 0x00, 0x00, 0xFF]);
    const { records } = parseStatusPoll(payload);
    assert.equal(records, null);
  });

  it('round-trip: parseRxFrame then parseStatusPoll', () => {
    // Build a valid RX frame wrapping IO_MODULE_DIN_8 payload
    const tlvPayload = Buffer.from('030001010001010100020 2106c09'.replace(/\s/g, ''), 'hex');
    const remainingLen = tlvPayload.length + 1;
    const header = Buffer.from([0xAA, 0x00, remainingLen]);
    let xor = 0;
    for (const b of header) xor ^= b;
    for (const b of tlvPayload) xor ^= b;
    const rxFrame = Buffer.concat([header, tlvPayload, Buffer.from([xor])]);
    const parsed = parseRxFrame(rxFrame);
    assert.ok(parsed !== null);
    const { records } = parseStatusPoll(parsed.payload);
    assert.equal(records.length, 3);
    assert.equal(parseTemperatureCelsius(records[2].data), 24.12);
  });
});

describe('parseTemperatureCelsius', () => {
  it('0x096A → 24.10°C', () => {
    assert.equal(parseTemperatureCelsius(Buffer.from([0x6A, 0x09])), 24.10);
  });

  it('0x095E → 23.98°C', () => {
    assert.equal(parseTemperatureCelsius(Buffer.from([0x5E, 0x09])), 23.98);
  });
});

describe('parseButtonEvent', () => {
  it('VAL=0 → button 0, ON_CHANGE', () => {
    const e = parseButtonEvent(0);
    assert.equal(e.buttonIndex, 0);
    assert.equal(e.eventId, ButtonEvent.ON_CHANGE);
  });

  it('VAL=7 → button 1, ON_CHANGE', () => {
    const e = parseButtonEvent(7);
    assert.equal(e.buttonIndex, 1);
    assert.equal(e.eventId, ButtonEvent.ON_CHANGE);
  });

  it('VAL=24 → button 3, ON_SHORT_PRESS', () => {
    // BUTTON_04 (index 3), ON_SHORT_PRESS (id 3): 3*7+3=24
    const e = parseButtonEvent(24);
    assert.equal(e.buttonIndex, 3);
    assert.equal(e.eventId, ButtonEvent.ON_SHORT_PRESS);
  });

  it('VAL=27 → button 3, ON_CLICK (last event of BUTTON_04)', () => {
    const e = parseButtonEvent(27);
    assert.equal(e.buttonIndex, 3);
    assert.equal(e.eventId, ButtonEvent.ON_CLICK);
  });
});
