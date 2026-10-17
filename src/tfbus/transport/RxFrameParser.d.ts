export declare class RxFrameParser {
  /** Push raw bytes. Returns array of complete, CRC-validated TFBUS frames. */
  push(chunk: Buffer): Buffer[];
}
