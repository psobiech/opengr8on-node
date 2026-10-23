export class RxFrameParser {
  #buf = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames: Buffer[] = [];
    this.#consume(frames);
    return frames;
  }

  #consume(frames: Buffer[]): void {
    while (this.#buf.length >= 4) {
      if (this.#buf[0] !== 0xAA) {
        const idx = this.#buf.indexOf(0xAA, 1);
        if (idx < 0) { this.#buf = Buffer.alloc(0); return; }
        this.#buf = this.#buf.subarray(idx);
        continue;
      }

      const typedLen = this.#typedLen();
      const rlLen = Math.max(4, 3 + this.#buf[2]);
      const candidates: number[] = typedLen !== null ? [typedLen] : [];
      if (rlLen !== typedLen) candidates.push(rlLen);

      let delivered = false;
      for (const len of candidates) {
        if (len > 33) continue;
        if (this.#buf.length < len) return;
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

  #typedLen(): number | null {
    const type = this.#buf[2];
    switch (type) {
      case 0x02: return 9;
      case 0x04: return 4;
      case 0x07: return 4;
      case 0x09: return 5;
      case 0x0A: return 4;
      case 0x0B: return 4;
      case 0x18: return 7;
      case 0x2A: return 4;
      case 0x31: return 26;
      case 0xF9: return 4;
      case 0xFB: return 25;
      case 0xFD: return 7;
      case 0xFE: return 7;
      case 0xF0: return this.#buf.length >= 4 ? 4 + this.#buf[3] : null;
      default: return null;
    }
  }
}
