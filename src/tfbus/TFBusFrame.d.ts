export declare const BROADCAST: 0xFF;
export declare const CLU_ADDR: 0x00;
export declare const MIN_ADDR: 1;
export declare const MAX_ADDR: 48;

export declare function buildFrame(dest: number, type: number, payload?: Buffer): Buffer;

/** Parse a module response frame. Validates start byte and CRC; does not check dest byte. */
export declare function parseRxFrame(buf: Buffer): { payload: Buffer; length: number } | null;

export interface BusTxFrame {
  dest: number;
  type: number;
  payload: Buffer;
}
export declare function parseBusTxFrame(buf: Buffer): BusTxFrame | null;
