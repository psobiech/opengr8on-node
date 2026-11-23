import { EventEmitter } from 'node:events';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { parseStatusPoll, TLVType, parseButtonEvent, type TLVRecord } from './StatusPollResponse.js';
import { parseVersionResponse } from './VersionQueryResponse.js';
import type { TFBusTransport } from './transport/SerialTransport.js';

export interface FrameEvent { frame: Buffer; direction: 'tx' | 'rx'; }
export interface StatusEvent { address: number; records: TLVRecord[] | null; raw: Buffer; }
export interface VersionEvent { address: number; version: ReturnType<typeof parseVersionResponse>; raw: Buffer; }
export interface ButtonEvent { address: number; buttonIndex: number; eventId: number; data: Buffer; }
export interface AckEvent { address: number; }
export interface ResponseEvent { address: number; txType: number; records: TLVRecord[] | null; raw: Buffer; }

const TX_TTL_MS = 250;

interface TXEntry { type: number; sentAtMs: number; }

export class TFBusEventBus extends EventEmitter {
  #transport: TFBusTransport;
  #running = false;
  #lastTx = new Map<number, TXEntry>();   // addr → {type, sentAtMs}
  #pendingAddr: number | null = null;     // addr of most-recent TX

  constructor(transport: TFBusTransport) {
    super();
    this.#transport = transport;
  }

  get transport(): TFBusTransport { return this.#transport; }

  start(): this {
    if (this.#running) return this;
    this.#running = true;
    this.#loop().catch(error => this.emit('error', error));
    return this;
  }

  stop(): this {
    this.#running = false;
    return this;
  }

  send(frame: Buffer): this {
    this.#transport.enqueue(frame);
    return this;
  }

  request(dest: number, frame: Buffer, timeoutMs = 300): Promise<Buffer | null> {
    const txType = frame[2];
    return new Promise((resolve) => {
      let synced = false;

      const onFrame = ({ frame: busFrame, direction }: FrameEvent) => {
        if (!synced) {
          if (direction === 'tx' && busFrame[1] === dest && busFrame[2] === txType) synced = true;
          return;
        }
        if (direction === 'rx') {
          cleanup();
          resolve(busFrame);
        }
      };

      const cleanup = () => {
        this.off('frame', onFrame);
        clearTimeout(timer);
      };

      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      this.on('frame', onFrame);
      this.#transport.enqueue(frame);
    });
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      const rawFrame = await this.#transport.dequeue();
      if (rawFrame === null) continue;
      if (rawFrame.length < 4 || rawFrame[0] !== 0xAA) continue;

      if (rawFrame[1] !== 0x00) {
        const txFrame = parseBusTxFrame(rawFrame);
        if (txFrame) {
          this.#lastTx.set(txFrame.dest, { type: txFrame.type, sentAtMs: Date.now() });
          this.#pendingAddr = txFrame.dest;
        }
        this.emit('frame', { frame: rawFrame, direction: 'tx' } satisfies FrameEvent);
        continue;
      }

      this.emit('frame', { frame: rawFrame, direction: 'rx' } satisfies FrameEvent);

      const rxFrame = parseRxFrame(rawFrame);
      if (!rxFrame) continue;

      // Resolve TX context with TTL guard
      const now = Date.now();
      let address: number | null = null;
      let txType: number | null = null;
      if (this.#pendingAddr !== null) {
        const entry = this.#lastTx.get(this.#pendingAddr);
        if (entry && (now - entry.sentAtMs) <= TX_TTL_MS) {
          address = this.#pendingAddr;
          txType = entry.type;
          this.#lastTx.delete(this.#pendingAddr);
        }
      }
      this.#pendingAddr = null;
      // Evict stale entries
      for (const [entryAddr, entry] of this.#lastTx) {
        if (now - entry.sentAtMs > TX_TTL_MS) this.#lastTx.delete(entryAddr);
      }

      if (address === null) {
        // Missed TX frame — try TLV heuristic to recover status-poll dispatch
        if (rxFrame.payload.length > 0 && looksLikeTLV(rxFrame.payload)) {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('status', { address: 0, records, raw } satisfies StatusEvent);
        }
        continue;
      }

      if (txType === 0xF9) {
        const version = parseVersionResponse(rxFrame.payload);
        this.emit('version', { address, version, raw: rxFrame.payload } satisfies VersionEvent);
      } else if (txType === 0x04) {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { address } satisfies AckEvent);
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('status', { address, records, raw } satisfies StatusEvent);
          if (records) {
            for (const record of records) {
              if (record.type === TLVType.BUTTON_EVENT) {
                const { buttonIndex, eventId } = parseButtonEvent(record.data[0]);
                this.emit('button', { address, buttonIndex, eventId, data: record.data } satisfies ButtonEvent);
              }
            }
          }
        }
      } else {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { address } satisfies AckEvent);
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('response', { address, txType: txType!, records, raw } satisfies ResponseEvent);
        }
      }
    }
  }
}

function looksLikeTLV(payload: Buffer): boolean {
  if (payload.length === 0) return false;
  const count = payload[0];
  if (count === 0 || count > 10) return false;
  let position = 1;
  for (let i = 0; i < count; i++) {
    if (position + 3 > payload.length) return false;
    position += 3 + payload[position + 1];
  }
  return position === payload.length;
}
