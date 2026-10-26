import { EventEmitter } from 'node:events';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { parseStatusPoll, TLVType, parseButtonEvent, type TLVRecord } from './StatusPollResponse.js';
import { parseVersionResponse } from './VersionQueryResponse.js';
import type { TFBusTransport } from './transport/SerialTransport.js';

export interface FrameEvent { buf: Buffer; dir: 'tx' | 'rx'; }
export interface StatusEvent { addr: number; records: TLVRecord[] | null; raw: Buffer; }
export interface VersionEvent { addr: number; version: ReturnType<typeof parseVersionResponse>; raw: Buffer; }
export interface ButtonEvent { addr: number; buttonIndex: number; eventId: number; data: Buffer; }
export interface AckEvent { addr: number; }
export interface ResponseEvent { addr: number; txType: number; records: TLVRecord[] | null; raw: Buffer; }

const TX_TTL_MS = 250;

interface TXEntry { type: number; ts: number; }

function looksLikeTLV(payload: Buffer): boolean {
  if (payload.length === 0) return false;
  const count = payload[0];
  if (count === 0 || count > 10) return false;
  let pos = 1;
  for (let i = 0; i < count; i++) {
    if (pos + 3 > payload.length) return false;
    pos += 3 + payload[pos + 1];
  }
  return pos === payload.length;
}

export class TFBusEventBus extends EventEmitter {
  #transport: TFBusTransport;
  #running = false;
  #lastTx = new Map<number, TXEntry>();   // addr → {type, ts}
  #pendingAddr: number | null = null;     // addr of most-recent TX

  constructor(transport: TFBusTransport) {
    super();
    this.#transport = transport;
  }

  get transport(): TFBusTransport { return this.#transport; }

  start(): this {
    if (this.#running) return this;
    this.#running = true;
    this.#loop().catch(err => this.emit('error', err));
    return this;
  }

  stop(): this {
    this.#running = false;
    return this;
  }

  send(buf: Buffer): this {
    this.#transport.enqueue(buf);
    return this;
  }

  request(dest: number, buf: Buffer, timeoutMs = 300): Promise<Buffer | null> {
    const txType = buf[2];
    return new Promise((resolve) => {
      let synced = false;

      const onFrame = ({ buf: fb, dir }: FrameEvent) => {
        if (!synced) {
          if (dir === 'tx' && fb[1] === dest && fb[2] === txType) synced = true;
          return;
        }
        if (dir === 'rx') {
          cleanup();
          resolve(fb);
        }
      };

      const cleanup = () => {
        this.off('frame', onFrame);
        clearTimeout(timer);
      };

      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      this.on('frame', onFrame);
      this.#transport.enqueue(buf);
    });
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      const buf = await this.#transport.dequeue();
      if (buf === null) continue;
      if (buf.length < 4 || buf[0] !== 0xAA) continue;

      if (buf[1] !== 0x00) {
        const txf = parseBusTxFrame(buf);
        if (txf) {
          this.#lastTx.set(txf.dest, { type: txf.type, ts: Date.now() });
          this.#pendingAddr = txf.dest;
        }
        this.emit('frame', { buf, dir: 'tx' } satisfies FrameEvent);
        continue;
      }

      this.emit('frame', { buf, dir: 'rx' } satisfies FrameEvent);

      const rxFrame = parseRxFrame(buf);
      if (!rxFrame) continue;

      // Resolve TX context with TTL guard
      const now = Date.now();
      let addr: number | null = null;
      let txType: number | null = null;
      if (this.#pendingAddr !== null) {
        const entry = this.#lastTx.get(this.#pendingAddr);
        if (entry && (now - entry.ts) <= TX_TTL_MS) {
          addr = this.#pendingAddr;
          txType = entry.type;
          this.#lastTx.delete(this.#pendingAddr);
        }
      }
      this.#pendingAddr = null;
      // Evict stale entries
      for (const [a, e] of this.#lastTx) {
        if (now - e.ts > TX_TTL_MS) this.#lastTx.delete(a);
      }

      if (addr === null) {
        // Missed TX frame — try TLV heuristic to recover status-poll dispatch
        if (rxFrame.payload.length > 0 && looksLikeTLV(rxFrame.payload)) {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('status', { addr: 0, records, raw } satisfies StatusEvent);
        }
        continue;
      }

      if (txType === 0xF9) {
        const version = parseVersionResponse(rxFrame.payload);
        this.emit('version', { addr, version, raw: rxFrame.payload } satisfies VersionEvent);
      } else if (txType === 0x04) {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { addr } satisfies AckEvent);
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('status', { addr, records, raw } satisfies StatusEvent);
          if (records) {
            for (const r of records) {
              if (r.type === TLVType.BUTTON_EVENT) {
                const { buttonIndex, eventId } = parseButtonEvent(r.data[0]);
                this.emit('button', { addr, buttonIndex, eventId, data: r.data } satisfies ButtonEvent);
              }
            }
          }
        }
      } else {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { addr } satisfies AckEvent);
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('response', { addr, txType: txType!, records, raw } satisfies ResponseEvent);
        }
      }
    }
  }
}
