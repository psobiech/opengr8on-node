// Stateful byte-stream parser that extracts valid TFBUS frames from raw RS485 data.
// Handles partial frames, garbled prefixes, and protocol-specific fixed frame lengths.
export class RxFrameParser {
  #buf = Buffer.alloc(0);

  // Push new raw bytes. Returns array of complete, CRC-validated frames (may be empty).
  push(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames = [];
    this.#consume(frames);
    return frames;
  }

  #consume(frames) {
    while (this.#buf.length >= 4) {
      if (this.#buf[0] !== 0xAA) {
        const idx = this.#buf.indexOf(0xAA, 1);
        if (idx < 0) { this.#buf = Buffer.alloc(0); return; }
        this.#buf = this.#buf.subarray(idx);
        continue;
      }

      // Try type-table length first to avoid misreading known fixed-size frames.
      const typedLen = this.#typedLen();
      const rlLen = Math.max(4, 3 + this.#buf[2]);
      const candidates = typedLen !== null ? [typedLen] : [];
      if (rlLen !== typedLen) candidates.push(rlLen);

      let delivered = false;
      for (const len of candidates) {
        if (len > 33) continue;
        if (this.#buf.length < len) return; // need more data
        let xor = 0;
        for (let i = 0; i < len - 1; i++) xor ^= this.#buf[i];
        if (xor === this.#buf[len - 1]) {
          frames.push(Buffer.from(this.#buf.subarray(0, len)));
          this.#buf = this.#buf.subarray(len);
          delivered = true;
          break;
        }
      }
      if (!delivered) this.#buf = this.#buf.subarray(1);
    }
  }

  // Known frame lengths by type byte. No address semantics — applies to any frame.
  #typedLen() {
    const type = this.#buf[2];
    switch (type) {
      case 0x02: return 9;   // ADDR_ASSIGN
      case 0x04: return 4;   // STATUS_POLL
      case 0x07: return 4;   // RESET
      case 0x09: return 5;   // ADDR_CONFIRM
      case 0x0A: return 4;
      case 0x0B: return 4;   // FORCE_GET_STATUS
      case 0x18: return 7;   // LED_CMD / WAKE_UP
      case 0x2A: return 4;   // SEEK
      case 0x31: return 26;  // TFBUS_CMD
      case 0xF9: return 4;   // VERSION_QUERY
      case 0xFB: return 25;  // PROVISION
      case 0xFD: return 7;
      case 0xFE: return 7;
      case 0xF0: return this.#buf.length >= 4 ? 4 + this.#buf[3] : null; // MODULE_CMD: plen at [3]
      default: return null;
    }
  }
}
