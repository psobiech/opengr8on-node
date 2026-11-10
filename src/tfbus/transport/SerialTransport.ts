import { SerialPort } from 'serialport';
import { RxFrameParser } from './RxFrameParser.js';

export interface TFBusTransport {
  enqueue(buf: Buffer): void;
  dequeue(): Promise<Buffer | null>;
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface SerialTransportOptions {
  baudRate?: number;
  /** RX frame timeout in ms before dequeue() returns null. Default 200. */
  rxTimeoutMs?: number;
  /** Called with bytes the frame parser discarded (noise, collisions, unparseable data). */
  onSkip?: (bytes: Buffer) => void;
}

// TFBus transport over a USB–RS485 serial adapter.
// Delivers every valid frame observed on the bus. Makes no assumptions about
// addresses, directions, or who is master — callers interpret what they receive.
export class SerialTransport implements TFBusTransport {
  readonly #port: InstanceType<typeof SerialPort>;
  #parser: RxFrameParser;
  #rxQueue: Buffer[] = [];
  #waiters: Array<(buf: Buffer | null) => void> = [];
  #rxTimeoutMs: number;

  constructor(path: string, { baudRate = 115200, rxTimeoutMs = 200, onSkip }: SerialTransportOptions = {}) {
    this.#rxTimeoutMs = rxTimeoutMs;
    this.#parser = new RxFrameParser(onSkip ?? null);
    this.#port = new SerialPort({ path, baudRate, autoOpen: false });
    this.#port.on('data', (chunk: Buffer) => this.#onData(chunk));
    this.#port.on('error', (err: Error) => process.stderr.write(`serial error: ${err.message}\n`));
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.#port.open((err) => (err ? reject(err) : resolve())),
    );
  }

  close(): Promise<void> {
    for (const w of this.#waiters) w(null);
    this.#waiters = [];
    return new Promise((resolve) => this.#port.close(() => resolve()));
  }

  enqueue(buf: Buffer): void {
    this.#port.write(buf);
  }

  dequeue(): Promise<Buffer | null> {
    if (this.#rxQueue.length > 0) return Promise.resolve(this.#rxQueue.shift()!);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.#waiters.indexOf(resolve);
        if (idx >= 0) this.#waiters.splice(idx, 1);
        resolve(null);
      }, this.#rxTimeoutMs);
      this.#waiters.push((buf) => {
        clearTimeout(timer);
        resolve(buf);
      });
    });
  }

  #onData(chunk: Buffer): void {
    for (const frame of this.#parser.push(chunk)) this.#deliverFrame(frame);
  }

  #deliverFrame(frame: Buffer): void {
    if (this.#waiters.length > 0) {
      this.#waiters.shift()!(frame);
    } else {
      this.#rxQueue.push(frame);
    }
  }
}
