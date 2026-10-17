export interface TLVRecord {
  type: number;
  meta: number;
  data: Buffer;
}

export declare const TLVType: {
  readonly INPUT_BITMASK: 0x00;
  readonly STATE: 0x01;
  readonly TEMPERATURE: 0x02;
  readonly POLL_COUNTER: 0x05;
  readonly DIGITAL_STATE: 0x06;
  readonly LIGHT: 0x07;
  readonly BUTTON_EVENT: 0x08;
  readonly ROLLER_POSITION: 0x16;
};

export declare const ButtonEvent: {
  readonly ON_CHANGE: 0;
  readonly ON_SWITCH_ON: 1;
  readonly ON_SWITCH_OFF: 2;
  readonly ON_SHORT_PRESS: 3;
  readonly ON_LONG_PRESS: 4;
  readonly ON_HOLD: 5;
  readonly ON_CLICK: 6;
};

export declare function parseStatusPoll(payload: Buffer): { records: TLVRecord[] | null; raw: Buffer };
export declare function parseTemperatureCelsius(data: Buffer): number;
export declare function parseButtonEvent(val: number): { buttonIndex: number; eventId: number };

/** Returns true when payload matches the 18-byte CLU multichannel layout (format undocumented). */
export declare function isCluMultichannelPayload(payload: Buffer | null | undefined): boolean;

export interface SmartPanelResponse {
  buttonMask: number;
  edgeMask: number;
  /** Ambient light level in % (unit 0.01%, stored as LE u16 / 100). */
  lightLevel: number;
  raw: Buffer;
}
/** Parse SMART_PANEL_FM_4 non-TLV STATUS_POLL payload (13 bytes, last byte 0x02). Returns null if not matching. */
export declare function parseSmartPanelResponse(payload: Buffer): SmartPanelResponse | null;
