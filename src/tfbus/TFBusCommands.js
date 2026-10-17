import { buildFrame, BROADCAST } from './TFBusFrame.js';

export { BROADCAST } from './TFBusFrame.js';

// ─── Universal frames ────────────────────────────────────────────────────────

export function resetFrame(dest = BROADCAST) {
  return buildFrame(dest, 0x07);
}

export function seekFrame() {
  return buildFrame(BROADCAST, 0x2A);
}

// serialNumber: u32 (stored LE on wire); channel: 1-based RS485 address to assign
export function addrAssignFrame(serialNumber, channel) {
  const payload = Buffer.allocUnsafe(5);
  payload.writeUInt32LE(serialNumber >>> 0, 0);
  payload[4] = channel & 0xFF;
  return buildFrame(BROADCAST, 0x02, payload);
}

export function statusPollFrame(dest) {
  return buildFrame(dest, 0x04);
}

export function versionQueryFrame(dest) {
  return buildFrame(dest, 0xF9);
}

export function forceGetStatusFrame() {
  return buildFrame(BROADCAST, 0x0B);
}

// keyType: 0=none,1=AES128; serialNumber: u32; key: 16-byte Buffer (ignored when keyType=0)
export function provisionFrame(dest, keyType, serialNumber, key = Buffer.alloc(16)) {
  const payload = Buffer.alloc(21, 0);
  payload[0] = keyType & 0xFF;
  payload.writeUInt32LE(serialNumber >>> 0, 1);
  Buffer.from(key).copy(payload, 5, 0, 16);
  return buildFrame(dest, 0xFB, payload);
}

export function addrConfirmFrame(dest) {
  return buildFrame(dest, 0x09, Buffer.from([0x02]));
}

// ─── LED_CMD (type 0x18) ─────────────────────────────────────────────────────

// Wire: AA dest 0x18 btn_mask 0x00 cmd_byte XOR_crc (7 bytes)
// buttonMask: bit N = button N (0-indexed), e.g. 1 << buttonIdx

export const LedCmd = Object.freeze({
  SHOW_OK: 0x00,
  SHOW_ERROR: 0x01,
  LED_SWITCH_ON: 0x02,
  LED_SWITCH_OFF: 0x04,
  RED_LED_SWITCH_ON: 0x10,
});

export function ledCmdFrame(dest, buttonMask, cmd) {
  return buildFrame(dest, 0x18, Buffer.from([buttonMask & 0xFF, 0x00, cmd & 0xFF]));
}

// ─── MODULE_CMD (type 0xF0) TLV record builders ──────────────────────────────
// Each record: { type, meta, data: Buffer }
// Wire encoding: type(1) len(1) meta(1) data(len)

function rec(type, meta, data) {
  return { type, meta, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
}

// 0x08 ACTIVATE — switch on; level = CLU-configured value (relay: 0x80)
export function activateRecord(level) {
  return rec(0x08, 0x01, [level & 0xFF]);
}

// 0x09 DEACTIVATE — switch off / stop; val = CLU-configured constant
export function deactivateRecord(val) {
  return rec(0x09, 0x01, [val & 0xFF]);
}

// 0x01 SET_OUTPUT — set output state; for relay: chanMask = 1<<ch, val=0=off
export function setOutputRecord(chanMask, valLo = 0, valHi = 0) {
  return rec(0x01, 0x00, [chanMask & 0xFF, valLo & 0xFF, valHi & 0xFF]);
}

// 0x06 SET_RAMP_TIME — fade time in ms; sent before SET_CHANNEL_VALUE or DIMMER_SET_VALUE
export function setRampTimeRecord(timeMs) {
  const b = Buffer.allocUnsafe(5);
  b[0] = 0;
  b.writeUInt16LE(timeMs & 0xFFFF, 1);
  b[3] = 0;
  b[4] = 0;
  return rec(0x06, 0x00, b);
}

// 0x0C DIMMER_SET_VALUE — target brightness; value: 0–1000 (÷1000 = 0.0–1.0)
export function dimmerSetValueRecord(value) {
  const b = Buffer.allocUnsafe(3);
  b[0] = 0;
  b.writeUInt16LE(value & 0xFFFF, 1);
  return rec(0x0C, 0x00, b);
}

// 0x16 SET_POSITION (TX) — roller target; byte order: [flags, channel, target%]
// Note: RX (STATUS_POLL response) has different byte order [instance, pos%, flags]
export function setPositionRecord(flags, channel, targetPct) {
  return rec(0x16, 0x00, [flags & 0xFF, channel & 0xFF, targetPct & 0xFF]);
}

// 0x17 FEATURE_PARAM — module feature/timing; val: raw 16-bit (ROLLER timing: unit=10ms)
export function featureParamRecord(idx, channel, val) {
  const b = Buffer.allocUnsafe(4);
  b[0] = idx & 0xFF;
  b[1] = channel & 0xFF;
  b.writeUInt16LE(val & 0xFFFF, 2);
  return rec(0x17, 0x00, b);
}

// 0x0B CHANNEL_MAP — channel-to-object type; objType: 0x00=DIN/motor, 0x02=relay/DOUT
export function channelMapRecord(chanId, objType) {
  return rec(0x0B, 0x00, [chanId & 0xFF, objType & 0xFF]);
}

// 0x0F MODULE_PARAM — channel init; ioDir: 0=input, 1=output
export function moduleParamRecord(chanIdx, ioDir) {
  return rec(0x0F, 0x00, [0x00, chanIdx & 0xFF, ioDir & 0xFF, 0x00]);
}

// 0x04 CHANNEL_INIT — hardware channel init; chanType: 0x00=DIN, 0x16=ROLLER
export function channelInitRecord(chanType, chanIdx) {
  return rec(0x04, 0x00, [chanType & 0xFF, chanIdx & 0xFF, 0x00]);
}

// 0x05 SET_CHANNEL_VALUE — LED_RGBW brightness per channel; value: 0–255
export function setChannelValueRecord(chanIdx, value) {
  return rec(0x05, 0x10, [chanIdx & 0xFF, value & 0xFF]);
}

// 0x00 SENSOR_SENSITIVITY — sensor config
// sensorId: 0x07=PANELSENSTEMP, 0x08=PANELSENSLIGHT
export function sensorSensitivityRecord(sensorId, threshold10, sensitivity100ms) {
  return rec(0x00, 0x00, [sensorId & 0xFF, threshold10 & 0xFF, sensitivity100ms & 0xFF, 0x00]);
}

// 0x02 BUTTON_HOLDDELAY — hold timing in ms (observed: 512ms for all TOUCH_PANEL modules)
export function buttonHoldDelayRecord(delayMs) {
  const b = Buffer.allocUnsafe(3);
  b[0] = 0;
  b.writeUInt16LE(delayMs & 0xFFFF, 1);
  return rec(0x02, 0x01, b);
}

// 0x03 SET_MODE — button operating mode; 0=Monostable, 1=Bistable, 2=Locked
export function setModeRecord(mode) {
  return rec(0x03, 0x01, [mode & 0xFF]);
}

// 0x1C ROLLER_CHAN_REG — roller channel registration (sent after FEATURE_PARAM at init)
export function rollerChanRegRecord(channel1Based) {
  return rec(0x1C, 0x00, [0x00, channel1Based & 0xFF]);
}

// Build MODULE_CMD frame from one or more TLV records.
// Wire: AA dest 0xF0 plen count [records...] XOR_crc
export function moduleCmdFrame(dest, records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new RangeError('moduleCmdFrame requires at least one record');
  }
  let subBytes = 0;
  for (const r of records) subBytes += 3 + r.data.length;
  // plen includes itself: plen = 1(plen) + 1(count) + subBytes
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

// ─── TFBUS_CMD (type 0x31) ────────────────────────────────────────────────────
// All 0x31 frames are always 26 bytes on wire: AA dest 0x31 [22-byte payload] CRC
// Payload: cmd(1) + data(21 bytes, zero-padded)

export function tfbusCmdPayload(cmd, data = Buffer.alloc(0)) {
  const payload = Buffer.alloc(22, 0);
  payload[0] = cmd & 0xFF;
  const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
  src.copy(payload, 1, 0, Math.min(src.length, 21));
  return payload;
}

// cmd 0x00 — CHECK_ALIVE (no payload)
export function checkAliveFrame(dest) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x00));
}

// cmd 0x03 — RESET; code: reset type/reason (u32)
export function resetTFBusCmdFrame(dest, code = 0) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(code >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x03, data));
}

// cmd 0x0A — PRINT_TEXT; text truncated to 16 chars
export function printTextFrame(dest, x, y, font, text) {
  const data = Buffer.alloc(19, 0);
  data[0] = x & 0xFF;
  data[1] = y & 0xFF;
  data[2] = font & 0xFF;
  Buffer.from(text, 'ascii').copy(data, 3, 0, 16);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0A, data));
}

// cmd 0x0F — BUZZER_BEEP; freq: 30–5700 Hz, duration: 1–2000 ms, volume: 0–16
export function buzzerBeepFrame(dest, freq, duration, volume) {
  const data = Buffer.alloc(7, 0);
  data.writeUInt16LE(freq & 0xFFFF, 0);
  data.writeUInt16LE(duration & 0xFFFF, 2);
  data.writeUInt16LE(volume & 0xFFFF, 4);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0F, data));
}

// cmd 0x19 — DRAW (commits display buffer; send after PRINT_TEXT)
export function drawFrame(dest) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x19));
}

// cmd 0x06 — RGBW_SET; channelIdx: 0-based RGBW channel index
export function rgbwSetFrame(dest, w, r, g, b, channelIdx) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x06, Buffer.from([
    w & 0xFF, r & 0xFF, g & 0xFF, b & 0xFF, channelIdx & 0xFF,
  ])));
}

// cmd 0x01 — RESP_CHECK_ALIVE; arg: u32 echo value
export function respCheckAliveFrame(dest, arg = 0) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(arg >>> 0, 0);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x01, data));
}

// cmd 0x04 — FORCE_GET_STATUS; triggers immediate status update
export function forceGetStatusTFBusCmdFrame(dest) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x04));
}

// cmd 0x05 — SEEK_BCAST; name truncated/padded to 15 chars + null
export function seekBcastFrame(dest, hwType, fwType, name = '') {
  const data = Buffer.alloc(17, 0);
  data[0] = hwType & 0xFF;
  data[1] = fwType & 0xFF;
  Buffer.from(name, 'ascii').copy(data, 2, 0, 15);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x05, data));
}

// cmd 0x08 — SEEK_RESPONSE; same layout as SEEK_BCAST
export function seekResponseFrame(dest, hwType, fwType, name = '') {
  const data = Buffer.alloc(17, 0);
  data[0] = hwType & 0xFF;
  data[1] = fwType & 0xFF;
  Buffer.from(name, 'ascii').copy(data, 2, 0, 15);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x08, data));
}

// cmd 0x0B — SET_FEATURE; featureId: feature index
export function setFeatureFrame(dest, featureId) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0B, Buffer.from([featureId & 0xFF])));
}

// cmd 0x0E — EXEC_METHOD; methodId: CLU method index
export function execMethodFrame(dest, methodId) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x0E, Buffer.from([methodId & 0xFF])));
}

// cmd 0x12 — ITEM_SENSITIVITY; sensitivityClass at [0], caller data at [1..]
export function itemSensitivityFrame(dest, sensitivityClass, data = Buffer.alloc(0)) {
  const inner = Buffer.allocUnsafe(1 + data.length);
  inner[0] = sensitivityClass & 0xFF;
  Buffer.from(data).copy(inner, 1);
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x12, inner));
}

// cmd 0x1B — RGBW_SET_ALT; 5 arbitrary channel bytes
export function rgbwSetAltFrame(dest, a, b, c, d, e) {
  return buildFrame(dest, 0x31, tfbusCmdPayload(0x1B, Buffer.from([
    a & 0xFF, b & 0xFF, c & 0xFF, d & 0xFF, e & 0xFF,
  ])));
}
