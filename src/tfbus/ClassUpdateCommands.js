import { buildFrame } from './TFBusFrame.js';

// Generic builder: dest, classId (0x10–0x28), payload Buffer
export function classUpdateFrame(dest, classId, payload = Buffer.alloc(0)) {
  return buildFrame(dest, classId & 0xFF, payload);
}

// 0x10 Scheduler — channel bitmask + value_lo
export function schedulerFrame(dest, channel, valueLo) {
  return buildFrame(dest, 0x10, Buffer.from([(1 << channel) & 0xFF, valueLo & 0xFF]));
}

// 0x11 GENERIC_ZW_NODE — channel bitmask or scalar value
export function genericZwNodeFrame(dest, value) {
  return buildFrame(dest, 0x11, Buffer.from([value & 0xFF]));
}

// 0x12 Thermostat — channel bitmask or scalar value
export function thermostatFrame(dest, value) {
  return buildFrame(dest, 0x12, Buffer.from([value & 0xFF]));
}

// 0x13 PANEL_PAGE — channel bitmask + full 32-bit value
export function panelPageFrame(dest, channel, value32) {
  const b = Buffer.allocUnsafe(5);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt32LE(value32 >>> 0, 1);
  return buildFrame(dest, 0x13, b);
}

// 0x14 PANELSENSTEMP — channel bitmask + 16-bit temperature (0.01°C)
export function panelSensTempFrame(dest, channel, value16) {
  const b = Buffer.allocUnsafe(3);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt16LE(value16 & 0xFFFF, 1);
  return buildFrame(dest, 0x14, b);
}

// 0x15 PANELSENSLIGHT — channel bitmask + 16-bit light value
export function panelSensLightFrame(dest, channel, value16) {
  const b = Buffer.allocUnsafe(3);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt16LE(value16 & 0xFFFF, 1);
  return buildFrame(dest, 0x15, b);
}

// 0x16 HUMIDITY_SENSOR — chan(1) + 24-bit value (lo, mid, hi)
export function humiditySensorFrame(dest, chan, value24) {
  return buildFrame(dest, 0x16, Buffer.from([
    chan & 0xFF,
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

// 0x17 ONEW_SENSOR — mask_lo, mask_hi, v_lo
export function onewSensorFrame(dest, maskLo, maskHi, vLo) {
  return buildFrame(dest, 0x17, Buffer.from([maskLo & 0xFF, maskHi & 0xFF, vLo & 0xFF]));
}

// 0x18 WAKE_UP — mask_lo, mask_hi, v_lo
export function wakeUpFrame(dest, maskLo, maskHi, vLo) {
  return buildFrame(dest, 0x18, Buffer.from([maskLo & 0xFF, maskHi & 0xFF, vLo & 0xFF]));
}

// 0x19 ZWAVE_BINARY_SENSOR — no frame defined in protocol; omitted

// 0x1A BATTERY — 4 bytes with shuffled order: [v2, v3, v1, v0]
export function batteryFrame(dest, value32) {
  return buildFrame(dest, 0x1A, Buffer.from([
    (value32 >> 16) & 0xFF,
    (value32 >> 24) & 0xFF,
    (value32 >> 8) & 0xFF,
    value32 & 0xFF,
  ]));
}

// 0x1B DALI_MASTER — lower 24-bit value: [v0, v1, v2]
export function daliMasterFrame(dest, value24) {
  return buildFrame(dest, 0x1B, Buffer.from([
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

// 0x1C (unassigned) — lower 16-bit value: [v0, v1]
export function class1CFrame(dest, value16) {
  return buildFrame(dest, 0x1C, Buffer.from([value16 & 0xFF, (value16 >> 8) & 0xFF]));
}

// 0x1D PANEL — lower 24-bit value: [v0, v1, v2]
export function panelFrame(dest, value24) {
  return buildFrame(dest, 0x1D, Buffer.from([
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

// 0x1E PANEL_BUTTON — empty payload (sync pulse)
export function panelButtonFrame(dest) {
  return buildFrame(dest, 0x1E);
}

// 0x1F Push — exactly 20 bytes (truncate or zero-pad)
export function pushFrame(dest, data) {
  const buf = Buffer.alloc(20, 0);
  Buffer.from(data).copy(buf, 0, 0, 20);
  return buildFrame(dest, 0x1F, buf);
}

// 0x20 DALI_GEAR — empty payload
export function daliGearFrame(dest) {
  return buildFrame(dest, 0x20);
}

// 0x21 RS232_CONTROLLER — empty payload
export function rs232ControllerFrame(dest) {
  return buildFrame(dest, 0x21);
}

// 0x22 PRESSURE_SENSOR — empty payload
export function pressureSensorFrame(dest) {
  return buildFrame(dest, 0x22);
}

// 0x23 DALI_GEAR_DT8 — exactly 22 bytes (truncate or zero-pad)
export function daliGearDt8Frame(dest, data) {
  const buf = Buffer.alloc(22, 0);
  Buffer.from(data).copy(buf, 0, 0, 22);
  return buildFrame(dest, 0x23, buf);
}

// 0x24 AIR_VOC_SENSOR — empty payload
export function airVocSensorFrame(dest) {
  return buildFrame(dest, 0x24);
}

// 0x25 SOUND_SENSOR — 32-bit big-endian: [v3, v2, v1, v0]
export function soundSensorFrame(dest, value32) {
  return buildFrame(dest, 0x25, Buffer.from([
    (value32 >> 24) & 0xFF,
    (value32 >> 16) & 0xFF,
    (value32 >> 8) & 0xFF,
    value32 & 0xFF,
  ]));
}

// 0x26 IR_CONTROLLER — obj_class_byte + 16-bit value LE
export function irControllerFrame(dest, objClassByte, value16) {
  return buildFrame(dest, 0x26, Buffer.from([
    objClassByte & 0xFF,
    value16 & 0xFF,
    (value16 >> 8) & 0xFF,
  ]));
}

// 0x27 SunriseSunsetCalendar — obj_class_byte + 16-bit value LE
export function sunriseSunsetCalendarFrame(dest, objClassByte, value16) {
  return buildFrame(dest, 0x27, Buffer.from([
    objClassByte & 0xFF,
    value16 & 0xFF,
    (value16 >> 8) & 0xFF,
  ]));
}

// 0x28 PresenceSensor — 1-byte value
export function presenceSensorFrame(dest, vLo) {
  return buildFrame(dest, 0x28, Buffer.from([vLo & 0xFF]));
}
