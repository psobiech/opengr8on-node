import { buildFrame, BROADCAST } from './TFBusFrame.js';
import type { TLVRecord } from './StatusPollResponse.js';

export { BROADCAST } from './TFBusFrame.js';
export type { TLVRecord } from './StatusPollResponse.js';

export function resetFrame(dest = BROADCAST): Buffer {
  return buildFrame(dest, 0x07);
}

export function seekFrame(): Buffer {
  return buildFrame(BROADCAST, 0x2A);
}

export function addrAssignFrame(serialNumber: number, channel: number): Buffer {
  const payload = Buffer.allocUnsafe(5);
  payload.writeUInt32LE(serialNumber >>> 0, 0);
  payload[4] = channel & 0xFF;
  return buildFrame(BROADCAST, 0x02, payload);
}

export function statusPollFrame(dest: number): Buffer {
  return buildFrame(dest, 0x04);
}

export function versionQueryFrame(dest: number): Buffer {
  return buildFrame(dest, 0xF9);
}

export function forceGetStatusFrame(): Buffer {
  return buildFrame(BROADCAST, 0x0B);
}

export function provisionFrame(dest: number, keyType: number, serialNumber: number, key: Buffer = Buffer.alloc(16)): Buffer {
  const payload = Buffer.alloc(21, 0);
  payload[0] = keyType & 0xFF;
  payload.writeUInt32LE(serialNumber >>> 0, 1);
  Buffer.from(key).copy(payload, 5, 0, 16);
  return buildFrame(dest, 0xFB, payload);
}

export function addrConfirmFrame(dest: number): Buffer {
  return buildFrame(dest, 0x09, Buffer.from([0x02]));
}

export const LedCmd = Object.freeze({
  SHOW_OK: 0x00,
  SHOW_ERROR: 0x01,
  LED_SWITCH_ON: 0x02,
  LED_SWITCH_OFF: 0x04,
  RED_LED_SWITCH_ON: 0x10,
} as const);

export function ledCmdFrame(dest: number, buttonMask: number, cmd: number): Buffer {
  return buildFrame(dest, 0x18, Buffer.from([buttonMask & 0xFF, 0x00, cmd & 0xFF]));
}

function rec(type: number, meta: number, data: Buffer | number[]): TLVRecord {
  return { type, meta, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
}

export function activateRecord(level: number): TLVRecord {
  return rec(0x08, 0x01, [level & 0xFF]);
}

export function deactivateRecord(val: number): TLVRecord {
  return rec(0x09, 0x01, [val & 0xFF]);
}

export function setOutputRecord(chanMask: number, valLo = 0, valHi = 0): TLVRecord {
  return rec(0x01, 0x00, [chanMask & 0xFF, valLo & 0xFF, valHi & 0xFF]);
}

export function setRampTimeRecord(timeMs: number): TLVRecord {
  const b = Buffer.allocUnsafe(5);
  b[0] = 0;
  b.writeUInt16LE(timeMs & 0xFFFF, 1);
  b[3] = 0;
  b[4] = 0;
  return rec(0x06, 0x00, b);
}

export function dimmerSetValueRecord(value: number): TLVRecord {
  const b = Buffer.allocUnsafe(3);
  b[0] = 0;
  b.writeUInt16LE(value & 0xFFFF, 1);
  return rec(0x0C, 0x00, b);
}

export function setPositionRecord(flags: number, channel: number, targetPct: number): TLVRecord {
  return rec(0x16, 0x00, [flags & 0xFF, channel & 0xFF, targetPct & 0xFF]);
}

export function featureParamRecord(idx: number, channel: number, val: number): TLVRecord {
  const b = Buffer.allocUnsafe(4);
  b[0] = idx & 0xFF;
  b[1] = channel & 0xFF;
  b.writeUInt16LE(val & 0xFFFF, 2);
  return rec(0x17, 0x00, b);
}

export function channelMapRecord(chanId: number, objType: number): TLVRecord {
  return rec(0x0B, 0x00, [chanId & 0xFF, objType & 0xFF]);
}

export function moduleParamRecord(chanIdx: number, ioDir: number): TLVRecord {
  return rec(0x0F, 0x00, [0x00, chanIdx & 0xFF, ioDir & 0xFF, 0x00]);
}

export function channelInitRecord(chanType: number, chanIdx: number): TLVRecord {
  return rec(0x04, 0x00, [chanType & 0xFF, chanIdx & 0xFF, 0x00]);
}

export function setChannelValueRecord(chanIdx: number, value: number): TLVRecord {
  return rec(0x05, 0x10, [chanIdx & 0xFF, value & 0xFF]);
}

export function sensorSensitivityRecord(sensorId: number, threshold10: number, sensitivity100ms: number): TLVRecord {
  return rec(0x00, 0x00, [sensorId & 0xFF, threshold10 & 0xFF, sensitivity100ms & 0xFF, 0x00]);
}

export function buttonHoldDelayRecord(delayMs: number): TLVRecord {
  const b = Buffer.allocUnsafe(3);
  b[0] = 0;
  b.writeUInt16LE(delayMs & 0xFFFF, 1);
  return rec(0x02, 0x01, b);
}

export function setModeRecord(mode: number): TLVRecord {
  return rec(0x03, 0x01, [mode & 0xFF]);
}

export function rollerChanRegRecord(channel1Based: number): TLVRecord {
  return rec(0x1C, 0x00, [0x00, channel1Based & 0xFF]);
}

export function moduleCmdFrame(dest: number, records: TLVRecord[]): Buffer {
  if (!Array.isArray(records) || records.length === 0) {
    throw new RangeError('moduleCmdFrame requires at least one record');
  }
  let subBytes = 0;
  for (const r of records) subBytes += 3 + r.data.length;
  const plen = 2 + subBytes;
  const payload = Buffer.allocUnsafe(plen);
  payload[0] = plen;
  payload[1] = records.length;
  let off = 2;
  for (const r of records) {
    payload[off++] = r.type;
    payload[off++] = r.data.length;
    payload[off++] = r.meta;
    r.data.copy(payload, off);
    off += r.data.length;
  }
  return buildFrame(dest, 0xF0, payload);
}

export function tfbusCmdPayload(cmd: number, data: Buffer | number[] = Buffer.alloc(0)): Buffer {
  const payload = Buffer.alloc(22, 0);
  payload[0] = cmd & 0xFF;
  const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
  src.copy(payload, 1, 0, Math.min(src.length, 21));
  return payload;
}

export function checkAliveFrame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x00));
}

export function resetTFBusCmdFrame(dest: number, code = 0): Buffer {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(code >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x03, data));
}

export function printTextFrame(dest: number, x: number, y: number, font: number, text: string): Buffer {
  const data = Buffer.alloc(19, 0);
  data[0] = x & 0xFF;
  data[1] = y & 0xFF;
  data[2] = font & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 3, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0A, data));
}

export function buzzerBeepFrame(dest: number, freq: number, duration: number, volume: number): Buffer {
  const data = Buffer.alloc(7, 0);
  data.writeUInt16LE(freq & 0xFFFF, 0);
  data.writeUInt16LE(duration & 0xFFFF, 2);
  data.writeUInt16LE(volume & 0xFFFF, 4);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0F, data));
}

export function drawFrame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x19));
}

// Wire order confirmed from firmware tfbus_cmd_rgbw_set: [r, g, b, w, flags/channelIdx]
export function rgbwSetFrame(dest: number, r: number, g: number, b: number, w: number, channelIdx: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x06, Buffer.from([
    r & 0xFF, g & 0xFF, b & 0xFF, w & 0xFF, channelIdx & 0xFF,
  ])));
}

export function respCheckAliveFrame(dest: number, arg = 0): Buffer {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(arg >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x01, data));
}

export function forceGetStatusTFBusCmdFrame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x04));
}

export function seekBcastFrame(dest: number, hwType: number, fwType: number, name = ''): Buffer {
  const data = Buffer.alloc(17, 0);
  data[0] = hwType & 0xFF;
  data[1] = fwType & 0xFF;
  Buffer.from(name, 'ascii').copy(data, 2, 0, 15);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x05, data));
}

export function seekResponseFrame(dest: number, hwType: number, fwType: number, name = ''): Buffer {
  const data = Buffer.alloc(17, 0);
  data[0] = hwType & 0xFF;
  data[1] = fwType & 0xFF;
  Buffer.from(name, 'ascii').copy(data, 2, 0, 15);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x08, data));
}

export function setFeatureFrame(dest: number, featureId: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0B, Buffer.from([featureId & 0xFF])));
}

export function execMethodFrame(dest: number, methodId: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0E, Buffer.from([methodId & 0xFF])));
}

export function itemSensitivityFrame(dest: number, sensitivityClass: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const inner = Buffer.allocUnsafe(1 + data.length);
  inner[0] = sensitivityClass & 0xFF;
  Buffer.from(data).copy(inner, 1);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x12, inner));
}

export function rgbwSetAltFrame(dest: number, a: number, b: number, c: number, d: number, e: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x1B, Buffer.from([
    a & 0xFF, b & 0xFF, c & 0xFF, d & 0xFF, e & 0xFF,
  ])));
}

// sub_cmd 0x02 — 4-byte data payload (tfbus_cmd_02)
export function tfbusCmd02Frame(dest: number, data: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(data >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x02, b));
}

// sub_cmd 0x05 — print text without font byte: [x, y, text[16], null] (tfbus_cmd_print_text_no_font)
export function printTextNoFontFrame(dest: number, x: number, y: number, text: string): Buffer {
  const data = Buffer.alloc(18, 0);
  data[0] = x & 0xFF;
  data[1] = y & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 2, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x05, data));
}

// sub_cmd 0x07 — 3-byte payload [a, b, c] (tfbus_cmd_07)
export function tfbusCmd07Frame(dest: number, a: number, b: number, c: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x07, Buffer.from([a & 0xFF, b & 0xFF, c & 0xFF])));
}

// sub_cmd 0x08 — display text without font byte: [x, y, text[16], null] (tfbus_cmd_08_display)
export function displayTextFrame(dest: number, x: number, y: number, text: string): Buffer {
  const data = Buffer.alloc(18, 0);
  data[0] = x & 0xFF;
  data[1] = y & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 2, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x08, data));
}

// sub_cmd 0x09 — no payload (tfbus_cmd_09)
export function tfbusCmd09Frame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x09));
}

// sub_cmd 0x0C — 1-byte value (tfbus_cmd_0c)
export function tfbusCmd0CFrame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0C, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x0D — 1-byte value (tfbus_cmd_0d)
export function tfbusCmd0DFrame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0D, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x10 — 1-byte value (tfbus_cmd_10)
export function tfbusCmd10Frame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x10, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x11 — 1-byte value (tfbus_cmd_11)
export function tfbusCmd11Frame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x11, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x14 — 1-byte value (tfbus_cmd_14)
export function tfbusCmd14Frame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x14, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x15 — 1-byte value (tfbus_cmd_15)
export function tfbusCmd15Frame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x15, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x16 — 1-byte value (tfbus_cmd_16)
export function tfbusCmd16Frame(dest: number, val: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x16, Buffer.from([val & 0xFF])));
}

// sub_cmd 0x1C — variable-length payload (tfbus_cmd_1c)
export function tfbusCmd1CFrame(dest: number, payload: Buffer | number[] = Buffer.alloc(0)): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x1C, payload));
}
