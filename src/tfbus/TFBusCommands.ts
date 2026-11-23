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

export function activateRecord(level: number): TLVRecord {
  return tlvRecord(0x08, 0x01, [level & 0xFF]);
}

export function deactivateRecord(value: number): TLVRecord {
  return tlvRecord(0x09, 0x01, [value & 0xFF]);
}

export function setOutputRecord(channelMask: number, valueLow = 0, valueHigh = 0): TLVRecord {
  return tlvRecord(0x01, 0x00, [channelMask & 0xFF, valueLow & 0xFF, valueHigh & 0xFF]);
}

export function setRampTimeRecord(timeMs: number): TLVRecord {
  const recordData = Buffer.allocUnsafe(5);
  recordData[0] = 0;
  recordData.writeUInt16LE(timeMs & 0xFFFF, 1);
  recordData[3] = 0;
  recordData[4] = 0;
  return tlvRecord(0x06, 0x00, recordData);
}

export function dimmerSetValueRecord(value: number): TLVRecord {
  const recordData = Buffer.allocUnsafe(3);
  recordData[0] = 0;
  recordData.writeUInt16LE(value & 0xFFFF, 1);
  return tlvRecord(0x0C, 0x00, recordData);
}

export function setPositionRecord(flags: number, channel: number, targetPct: number): TLVRecord {
  return tlvRecord(0x16, 0x00, [flags & 0xFF, channel & 0xFF, targetPct & 0xFF]);
}

export function featureParamRecord(featureIndex: number, channel: number, value: number): TLVRecord {
  const recordData = Buffer.allocUnsafe(4);
  recordData[0] = featureIndex & 0xFF;
  recordData[1] = channel & 0xFF;
  recordData.writeUInt16LE(value & 0xFFFF, 2);
  return tlvRecord(0x17, 0x00, recordData);
}

export function channelMapRecord(channelId: number, objectType: number): TLVRecord {
  return tlvRecord(0x0B, 0x00, [channelId & 0xFF, objectType & 0xFF]);
}

export function moduleParamRecord(channelIndex: number, ioDirection: number): TLVRecord {
  return tlvRecord(0x0F, 0x00, [0x00, channelIndex & 0xFF, ioDirection & 0xFF, 0x00]);
}

export function channelInitRecord(channelType: number, channelIndex: number): TLVRecord {
  return tlvRecord(0x04, 0x00, [channelType & 0xFF, channelIndex & 0xFF, 0x00]);
}

export function setChannelValueRecord(channelIndex: number, value: number): TLVRecord {
  return tlvRecord(0x05, 0x10, [channelIndex & 0xFF, value & 0xFF]);
}

export function sensorSensitivityRecord(sensorId: number, threshold10: number, sensitivity100ms: number): TLVRecord {
  return tlvRecord(0x00, 0x00, [sensorId & 0xFF, threshold10 & 0xFF, sensitivity100ms & 0xFF, 0x00]);
}

export function buttonHoldDelayRecord(delayMs: number): TLVRecord {
  const recordData = Buffer.allocUnsafe(3);
  recordData[0] = 0;
  recordData.writeUInt16LE(delayMs & 0xFFFF, 1);
  return tlvRecord(0x02, 0x01, recordData);
}

export function setModeRecord(mode: number): TLVRecord {
  return tlvRecord(0x03, 0x01, [mode & 0xFF]);
}

export function rollerChanRegRecord(channel1Based: number): TLVRecord {
  return tlvRecord(0x1C, 0x00, [0x00, channel1Based & 0xFF]);
}

function tlvRecord(type: number, meta: number, data: Buffer | number[]): TLVRecord {
  return { type, meta, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
}

export function moduleCmdFrame(dest: number, records: TLVRecord[]): Buffer {
  if (!Array.isArray(records) || records.length === 0) {
    throw new RangeError('moduleCmdFrame requires at least one record');
  }
  let recordBytes = 0;
  for (const record of records) recordBytes += 3 + record.data.length;
  const payloadLength = 2 + recordBytes;
  const payload = Buffer.allocUnsafe(payloadLength);
  payload[0] = payloadLength;
  payload[1] = records.length;
  let offset = 2;
  for (const record of records) {
    payload[offset++] = record.type;
    payload[offset++] = record.data.length;
    payload[offset++] = record.meta;
    record.data.copy(payload, offset);
    offset += record.data.length;
  }
  return buildFrame(dest, 0xF0, payload);
}

export function checkAliveFrame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x00));
}

export function resetTFBusCmdFrame(dest: number, code = 0): Buffer {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(code >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x03, data));
}

export function printTextFrame(dest: number, positionX: number, positionY: number, font: number, text: string): Buffer {
  const data = Buffer.alloc(19, 0);
  data[0] = positionX & 0xFF;
  data[1] = positionY & 0xFF;
  data[2] = font & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 3, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0A, data));
}

export function buzzerBeepFrame(dest: number, frequency: number, duration: number, volume: number): Buffer {
  const data = Buffer.alloc(7, 0);
  data.writeUInt16LE(frequency & 0xFFFF, 0);
  data.writeUInt16LE(duration & 0xFFFF, 2);
  data.writeUInt16LE(volume & 0xFFFF, 4);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0F, data));
}

export function drawFrame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x19));
}

// Wire order confirmed from firmware tfbus_cmd_rgbw_set: [r, g, b, w, flags/channelIdx]
export function rgbwSetFrame(dest: number, red: number, green: number, blue: number, white: number, channelIdx: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x06, Buffer.from([
    red & 0xFF, green & 0xFF, blue & 0xFF, white & 0xFF, channelIdx & 0xFF,
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

export function rgbwSetAltFrame(dest: number, byte0: number, byte1: number, byte2: number, byte3: number, byte4: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x1B, Buffer.from([
    byte0 & 0xFF, byte1 & 0xFF, byte2 & 0xFF, byte3 & 0xFF, byte4 & 0xFF,
  ])));
}

// sub_cmd 0x02 — 4-byte data payload (tfbus_cmd_02)
export function tfbusCmd02Frame(dest: number, data: number): Buffer {
  const commandData = Buffer.allocUnsafe(4);
  commandData.writeUInt32LE(data >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x02, commandData));
}

// sub_cmd 0x05 — print text without font byte: [x, y, text[16], null] (tfbus_cmd_print_text_no_font)
export function printTextNoFontFrame(dest: number, positionX: number, positionY: number, text: string): Buffer {
  const data = Buffer.alloc(18, 0);
  data[0] = positionX & 0xFF;
  data[1] = positionY & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 2, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x05, data));
}

// sub_cmd 0x07 — 3-byte payload [a, b, c] (tfbus_cmd_07)
export function tfbusCmd07Frame(dest: number, byte0: number, byte1: number, byte2: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x07, Buffer.from([byte0 & 0xFF, byte1 & 0xFF, byte2 & 0xFF])));
}

// sub_cmd 0x08 — display text without font byte: [x, y, text[16], null] (tfbus_cmd_08_display)
export function displayTextFrame(dest: number, positionX: number, positionY: number, text: string): Buffer {
  const data = Buffer.alloc(18, 0);
  data[0] = positionX & 0xFF;
  data[1] = positionY & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 2, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x08, data));
}

// sub_cmd 0x09 — no payload (tfbus_cmd_09)
export function tfbusCmd09Frame(dest: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x09));
}

// sub_cmd 0x0C — 1-byte value (tfbus_cmd_0c)
export function tfbusCmd0CFrame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0C, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x0D — 1-byte value (tfbus_cmd_0d)
export function tfbusCmd0DFrame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0D, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x10 — 1-byte value (tfbus_cmd_10)
export function tfbusCmd10Frame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x10, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x11 — 1-byte value (tfbus_cmd_11)
export function tfbusCmd11Frame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x11, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x14 — 1-byte value (tfbus_cmd_14)
export function tfbusCmd14Frame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x14, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x15 — 1-byte value (tfbus_cmd_15)
export function tfbusCmd15Frame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x15, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x16 — 1-byte value (tfbus_cmd_16)
export function tfbusCmd16Frame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x16, Buffer.from([value & 0xFF])));
}

// sub_cmd 0x1C — variable-length payload (tfbus_cmd_1c)
export function tfbusCmd1CFrame(dest: number, payload: Buffer | number[] = Buffer.alloc(0)): Buffer {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x1C, payload));
}

export function tfbusCmdPayload(cmd: number, data: Buffer | number[] = Buffer.alloc(0)): Buffer {
  const payload = Buffer.alloc(22, 0);
  payload[0] = cmd & 0xFF;
  const sourceData = Buffer.isBuffer(data) ? data : Buffer.from(data);
  sourceData.copy(payload, 1, 0, Math.min(sourceData.length, 21));
  return payload;
}
