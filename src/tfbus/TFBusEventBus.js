import { EventEmitter } from 'node:events';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { parseStatusPoll, TLVType, parseButtonEvent } from './StatusPollResponse.js';
import { parseVersionResponse } from './VersionQueryResponse.js';

// Events emitted:
//   frame    { buf: Buffer, dir: 'tx'|'rx' }
//   status   { addr: number, records: TLVRecord[]|null, raw: Buffer }   — STATUS_POLL response
//   version  { addr: number, version: object|null, raw: Buffer }         — VERSION_QUERY response
//   button   { addr: number, buttonIndex: number, eventId: number, data: Buffer }
//   ack      { addr: number }                                             — empty response
//   response { addr: number, txType: number, records: TLVRecord[]|null, raw: Buffer }
//   error    Error

export class TFBusEventBus extends EventEmitter {
  #transport;
  #running = false;
  #lastTxType = null;
  #lastTxAddr = null;

  constructor(transport) {
    super();
    this.#transport = transport;
  }

  get transport() { return this.#transport; }

  start() {
    if (this.#running) return this;
    this.#running = true;
    this.#loop().catch(err => this.emit('error', err));
    return this;
  }

  stop() {
    this.#running = false;
    return this;
  }

  send(buf) {
    this.#transport.enqueue(buf);
    return this;
  }

  // Enqueue buf, wait for the TX echo, then return the first RX frame addressed to the CLU (0x00).
  // Returns null on timeout (default 300 ms).
  request(dest, buf, timeoutMs = 300) {
    const txType = buf[2];
    return new Promise((resolve) => {
      let synced = false;

      const onFrame = ({ buf: fb, dir }) => {
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

  async #loop() {
    while (this.#running) {
      const buf = await this.#transport.dequeue();
      if (buf === null) continue;
      if (buf.length < 4 || buf[0] !== 0xAA) continue;

      if (buf[1] !== 0x00) {
        const txf = parseBusTxFrame(buf);
        if (txf) {
          this.#lastTxType = txf.type;
          this.#lastTxAddr = txf.dest;
        }
        this.emit('frame', { buf, dir: 'tx' });
        continue;
      }

      // Module → CLU response (dest === 0x00)
      this.emit('frame', { buf, dir: 'rx' });

      const addr = this.#lastTxAddr;
      const txType = this.#lastTxType;
      if (addr === null) continue;

      const rxFrame = parseRxFrame(buf);
      if (!rxFrame) continue;

      this.#lastTxAddr = null;
      this.#lastTxType = null;

      if (txType === 0xF9) {
        const version = parseVersionResponse(rxFrame.payload);
        this.emit('version', { addr, version, raw: rxFrame.payload });
      } else if (txType === 0x04) {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { addr });
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('status', { addr, records, raw });
          if (records) {
            for (const r of records) {
              if (r.type === TLVType.BUTTON_EVENT) {
                const { buttonIndex, eventId } = parseButtonEvent(r.data[0]);
                this.emit('button', { addr, buttonIndex, eventId, data: r.data });
              }
            }
          }
        }
      } else {
        if (rxFrame.payload.length === 0) {
          this.emit('ack', { addr });
        } else {
          const { records, raw } = parseStatusPoll(rxFrame.payload);
          this.emit('response', { addr, txType, records, raw });
        }
      }
    }
  }
}
