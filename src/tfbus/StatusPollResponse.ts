export const TLVType = Object.freeze({
  INPUT_BITMASK: 0x00,
  STATE: 0x01,
  TEMPERATURE: 0x02,
  POLL_COUNTER: 0x05,
  DIGITAL_STATE: 0x06,
  LIGHT: 0x07,
  BUTTON_EVENT: 0x08,
  ROLLER_POSITION: 0x16,
} as const);

export const ButtonEvent = Object.freeze({
  ON_CHANGE: 0,
  ON_SWITCH_ON: 1,
  ON_SWITCH_OFF: 2,
  ON_SHORT_PRESS: 3,
  ON_LONG_PRESS: 4,
  ON_HOLD: 5,
  ON_CLICK: 6,
} as const);

export interface TLVRecord {
  type: number;
  meta: number;
  data: Buffer;
}

export function parseStatusPoll(payload: Buffer): { records: TLVRecord[] | null; raw: Buffer } {
  if (payload.length === 0) return { records: [], raw: payload };
  const count = payload[0];
  const records: TLVRecord[] = [];
  let off = 1;
  for (let i = 0; i < count; i++) {
    if (off + 3 > payload.length) return { records: null, raw: payload };
    const type = payload[off++];
    const len = payload[off++];
    const meta = payload[off++];
    if (off + len > payload.length) return { records: null, raw: payload };
    records.push({ type, meta, data: payload.subarray(off, off + len) });
    off += len;
  }
  if (off !== payload.length) return { records: null, raw: payload };
  return { records, raw: payload };
}

export function parseTemperatureCelsius(data: Buffer): number {
  return data.readUInt16LE(0) / 100;
}

export function parseButtonEvent(val: number): { buttonIndex: number; eventId: number } {
  return { buttonIndex: Math.floor(val / 7), eventId: val % 7 };
}

export function isCluMultichannelPayload(payload: Buffer | null | undefined): boolean {
  return payload != null && payload.length === 18;
}

export interface SmartPanelResponse {
  buttonMask: number;
  edgeMask: number;
  lightLevel: number;
  raw: Buffer;
}

export function parseSmartPanelResponse(payload: Buffer): SmartPanelResponse | null {
  if (!payload || payload.length !== 13 || payload[12] !== 0x02) return null;
  return {
    buttonMask: payload.readUInt16LE(0),
    edgeMask:   payload.readUInt16LE(2),
    lightLevel: payload.readUInt16LE(4) / 100,
    raw:        payload,
  };
}
