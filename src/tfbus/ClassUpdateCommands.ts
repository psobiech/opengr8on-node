import { buildFrame } from './TFBusFrame.js';

export function classUpdateFrame(dest: number, classId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return buildFrame(dest, classId & 0xFF, payload);
}

export function schedulerFrame(dest: number, channel: number, valueLo: number): Buffer {
  return buildFrame(dest, 0x10, Buffer.from([(1 << channel) & 0xFF, valueLo & 0xFF]));
}

export function genericZwNodeFrame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x11, Buffer.from([value & 0xFF]));
}

export function thermostatFrame(dest: number, value: number): Buffer {
  return buildFrame(dest, 0x12, Buffer.from([value & 0xFF]));
}

export function panelPageFrame(dest: number, channel: number, value32: number): Buffer {
  const b = Buffer.allocUnsafe(5);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt32LE(value32 >>> 0, 1);
  return buildFrame(dest, 0x13, b);
}

export function panelSensTempFrame(dest: number, channel: number, value16: number): Buffer {
  const b = Buffer.allocUnsafe(3);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt16LE(value16 & 0xFFFF, 1);
  return buildFrame(dest, 0x14, b);
}

export function panelSensLightFrame(dest: number, channel: number, value16: number): Buffer {
  const b = Buffer.allocUnsafe(3);
  b[0] = (1 << channel) & 0xFF;
  b.writeUInt16LE(value16 & 0xFFFF, 1);
  return buildFrame(dest, 0x15, b);
}

export function humiditySensorFrame(dest: number, chan: number, value24: number): Buffer {
  return buildFrame(dest, 0x16, Buffer.from([
    chan & 0xFF,
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

export function onewSensorFrame(dest: number, maskLo: number, maskHi: number, vLo: number): Buffer {
  return buildFrame(dest, 0x17, Buffer.from([maskLo & 0xFF, maskHi & 0xFF, vLo & 0xFF]));
}

export function wakeUpFrame(dest: number, maskLo: number, maskHi: number, vLo: number): Buffer {
  return buildFrame(dest, 0x18, Buffer.from([maskLo & 0xFF, maskHi & 0xFF, vLo & 0xFF]));
}

export function batteryFrame(dest: number, value32: number): Buffer {
  return buildFrame(dest, 0x1A, Buffer.from([
    (value32 >> 16) & 0xFF,
    (value32 >> 24) & 0xFF,
    (value32 >> 8) & 0xFF,
    value32 & 0xFF,
  ]));
}

export function daliMasterFrame(dest: number, value24: number): Buffer {
  return buildFrame(dest, 0x1B, Buffer.from([
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

export function class1CFrame(dest: number, value16: number): Buffer {
  return buildFrame(dest, 0x1C, Buffer.from([value16 & 0xFF, (value16 >> 8) & 0xFF]));
}

export function panelFrame(dest: number, value24: number): Buffer {
  return buildFrame(dest, 0x1D, Buffer.from([
    value24 & 0xFF,
    (value24 >> 8) & 0xFF,
    (value24 >> 16) & 0xFF,
  ]));
}

export function panelButtonFrame(dest: number): Buffer {
  return buildFrame(dest, 0x1E);
}

export function pushFrame(dest: number, data: Buffer | number[]): Buffer {
  const buf = Buffer.alloc(20, 0);
  Buffer.from(data).copy(buf, 0, 0, 20);
  return buildFrame(dest, 0x1F, buf);
}

export function daliGearFrame(dest: number): Buffer {
  return buildFrame(dest, 0x20);
}

export function rs232ControllerFrame(dest: number): Buffer {
  return buildFrame(dest, 0x21);
}

export function pressureSensorFrame(dest: number): Buffer {
  return buildFrame(dest, 0x22);
}

export function daliGearDt8Frame(dest: number, data: Buffer | number[]): Buffer {
  const buf = Buffer.alloc(22, 0);
  Buffer.from(data).copy(buf, 0, 0, 22);
  return buildFrame(dest, 0x23, buf);
}

export function airVocSensorFrame(dest: number): Buffer {
  return buildFrame(dest, 0x24);
}

export function soundSensorFrame(dest: number, value32: number): Buffer {
  return buildFrame(dest, 0x25, Buffer.from([
    (value32 >> 24) & 0xFF,
    (value32 >> 16) & 0xFF,
    (value32 >> 8) & 0xFF,
    value32 & 0xFF,
  ]));
}

export function irControllerFrame(dest: number, objClassByte: number, value16: number): Buffer {
  return buildFrame(dest, 0x26, Buffer.from([
    objClassByte & 0xFF,
    value16 & 0xFF,
    (value16 >> 8) & 0xFF,
  ]));
}

export function sunriseSunsetCalendarFrame(dest: number, objClassByte: number, value16: number): Buffer {
  return buildFrame(dest, 0x27, Buffer.from([
    objClassByte & 0xFF,
    value16 & 0xFF,
    (value16 >> 8) & 0xFF,
  ]));
}

export function presenceSensorFrame(dest: number, vLo: number): Buffer {
  return buildFrame(dest, 0x28, Buffer.from([vLo & 0xFF]));
}
