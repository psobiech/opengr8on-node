export const TLVType = Object.freeze({
  INPUT_BITMASK: 0x00,
  STATE: 0x01,
  TEMPERATURE: 0x02,
  POLL_COUNTER: 0x05,
  DIGITAL_STATE: 0x06,
  LIGHT: 0x07,
  BUTTON_EVENT: 0x08,
  ROLLER_POSITION: 0x16,
});

// event_id values for sub-record type 0x08 (BUTTON_EVENT)
export const ButtonEvent = Object.freeze({
  ON_CHANGE: 0,
  ON_SWITCH_ON: 1,
  ON_SWITCH_OFF: 2,
  ON_SHORT_PRESS: 3,
  ON_LONG_PRESS: 4,
  ON_HOLD: 5,
  ON_CLICK: 6,
});

// Parse the payload portion of a STATUS_POLL response (after AA 00 remaining_len header).
// Returns { records: TLVRecord[] | null, raw: Buffer }.
// records is null when the payload is not valid TLV (e.g. SMART_PANEL_FM_4 bitmask format).
export function parseStatusPoll(payload) {
  if (payload.length === 0) return { records: [], raw: payload };
  const count = payload[0];
  const records = [];
  let off = 1;
  for (let i = 0; i < count; i++) {
    if (off + 3 > payload.length) return { records: null, raw: payload };
    const type = payload[off++];
    const len = payload[off++];
    const meta = payload[off++];
    if (off + len > payload.length) return { records: null, raw: payload };
    records.push({ type, meta, data: payload.slice(off, off + len) });
    off += len;
  }
  if (off !== payload.length) return { records: null, raw: payload };
  return { records, raw: payload };
}

// LE uint16, unit 0.01°C → °C float
export function parseTemperatureCelsius(data) {
  return data.readUInt16LE(0) / 100;
}

// Decode VAL from sub-record type 0x08: VAL = btn_idx * 7 + event_id
export function parseButtonEvent(val) {
  return { buttonIndex: Math.floor(val / 7), eventId: val % 7 };
}

// Returns true when payload has the 18-byte CLU multichannel layout (format undocumented).
export function isCluMultichannelPayload(payload) {
  return payload != null && payload.length === 18;
}

// Parse a SMART_PANEL_FM_4 13-byte non-TLV STATUS_POLL response.
// Identified by payload.length === 13 and payload[12] === 0x02.
// Returns null when payload does not match this format.
export function parseSmartPanelResponse(payload) {
  if (!payload || payload.length !== 13 || payload[12] !== 0x02) return null;
  return {
    buttonMask: payload.readUInt16LE(0),      // bit N = instance N active
    edgeMask:   payload.readUInt16LE(2),      // non-zero on press start, 0 on release
    lightLevel: payload.readUInt16LE(4) / 100, // ambient light %, unit 0.01%
    raw:        payload,
  };
}
