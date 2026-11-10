// Splits a raw RS485 byte stream into TFBus frames (both directions: CLU→module and module→CLU).
//
// Length detection, per frame start (0xAA):
//   1. known fixed/self-describing type (type table below)
//   2. module→CLU response (byte[1] = 0x00): explicit length at byte[2]
//   3. unknown CLU→module type (class frames 0x10–0x30 have class-specific payloads): CRC scan of
//      lengths 4–33, accepting a length only when the next byte starts another frame (0xAA).
//      This keeps the false-positive rate tiny, at the cost of holding the frame until the
//      next byte arrives (the bus is polled continuously, so that is a few ms).
const MIN_LEN = 4;
const MAX_LEN = 33;

export class RxFrameParser {
  #buf = Buffer.alloc(0);
  readonly #onSkip: ((bytes: Buffer) => void) | null;

  /** onSkip receives every byte discarded as not belonging to a valid frame (noise, collisions). */
  constructor(onSkip: ((bytes: Buffer) => void) | null = null) {
    this.#onSkip = onSkip;
  }

  #skip(n: number): void {
    if (this.#onSkip && n > 0) this.#onSkip(Buffer.from(this.#buf.subarray(0, n)));
    this.#buf = this.#buf.subarray(n);
  }

  push(chunk: Buffer): Buffer[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames: Buffer[] = [];
    this.#consume(frames);
    return frames;
  }

  #consume(frames: Buffer[]): void {
    while (this.#buf.length >= MIN_LEN) {
      if (this.#buf[0] !== 0xAA) {
        const idx = this.#buf.indexOf(0xAA, 1);
        if (idx < 0) { this.#skip(this.#buf.length); return; }
        this.#skip(idx);
        continue;
      }

      const len = this.#frameLen();
      if (len === undefined) return; // need more data
      if (len === null) { this.#skip(1); continue; } // no valid frame here
      frames.push(Buffer.from(this.#buf.subarray(0, len)));
      this.#buf = this.#buf.subarray(len);
    }
  }

  // Length of the frame at #buf[0], null if none fits, undefined if more bytes are needed.
  #frameLen(): number | null | undefined {
    // Module→CLU response: byte[2] is the length, not a type.
    const candidates: number[] = this.#buf[1] === 0x00
      ? [Math.max(MIN_LEN, 3 + this.#buf[2])]
      : [this.#typedLen()].filter((l): l is number => l !== null);
    if (candidates.length) {
      for (const len of candidates) {
        if (len > MAX_LEN) continue;
        if (this.#buf.length < len) return undefined;
        if (this.#xorOk(len)) return len;
      }
      return null;
    }

    // Unknown CLU→module type: CRC scan, confirmed by the next frame's start byte.
    for (let len = MIN_LEN; len <= MAX_LEN; len++) {
      if (this.#buf.length < len + 1) return undefined;
      if (this.#buf[len] === 0xAA && this.#xorOk(len)) return len;
    }
    return null;
  }

  #xorOk(len: number): boolean {
    let xor = 0;
    for (let i = 0; i < len - 1; i++) xor ^= this.#buf[i];
    return xor === this.#buf[len - 1];
  }

  #typedLen(): number | null {
    const type = this.#buf[2];
    switch (type) {
      case 0x02: return 9;    // ADDR_ASSIGN
      case 0x04: return 4;    // STATUS_POLL
      case 0x07: return 4;    // RESET
      case 0x09: return 5;    // ADDR_CONFIRM
      case 0x0A: return 4;
      case 0x0B: return 4;    // FORCE_GET_STATUS
      case 0x18: return 7;    // LED_CMD / WAKE_UP
      case 0x2A: return 4;    // SEEK
      case 0x30: return 26;   // DISPLAY_BLOCK
      case 0x31: return 26;   // TFBUS_CMD
      case 0xF9: return 4;    // VERSION_QUERY
      case 0xFB: return 25;   // PROVISION
      case 0xFD: return 7;
      case 0xFE: return 7;
      case 0xF0: return this.#buf.length >= 4 ? 4 + this.#buf[3] : null; // MODULE_CMD: plen at [3]
      default:   return null;
    }
  }
}
