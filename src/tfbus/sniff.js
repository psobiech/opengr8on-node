import { TFBusEventBus } from './TFBusEventBus.js';
import { parseBusTxFrame } from './TFBusFrame.js';

/**
 * @typedef {Object} SniffEvent
 * @property {number} ts          - Date.now() ms
 * @property {'tx'|'rx'} dir
 * @property {string} hex         - full frame as hex
 * @property {number} addr        - RS485 address (dest for TX, module addr for RX)
 * @property {number|null} type   - frame type byte (TX) or originating TX type (RX semantics)
 * @property {'tx'|'status'|'version'|'ack'|'response'} event
 * @property {object|null} data
 */

/**
 * Listen passively to RS485 bus traffic for durationMs.
 * Transport must already be opened. Does not send any frames.
 *
 * @param {import('./transport/SerialTransport.js').SerialTransport} transport
 * @param {{ durationMs?: number }} [options]
 * @returns {Promise<SniffEvent[]>}
 */
export async function sniffBus(transport, { durationMs = 5000 } = {}) {
  const bus = new TFBusEventBus(transport);
  const events = [];
  let lastRxBuf = null;

  bus.on('frame', ({ buf, dir }) => {
    if (dir === 'rx') {
      lastRxBuf = buf;
      return;
    }
    const f = parseBusTxFrame(buf);
    events.push({
      ts: Date.now(),
      dir: 'tx',
      hex: buf.toString('hex'),
      addr: buf[1],
      type: buf[2],
      event: 'tx',
      data: f?.payload.length ? { payload: f.payload.toString('hex') } : null,
    });
  });

  bus.on('status', ({ addr, records, raw }) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr,
      type: 0x04,
      event: 'status',
      data: {
        records: records?.map(r => ({
          type: r.type,
          meta: r.meta,
          data: r.data.toString('hex'),
        })) ?? null,
      },
    });
  });

  bus.on('version', ({ addr, version, raw }) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr,
      type: 0xF9,
      event: 'version',
      data: version,
    });
  });

  bus.on('ack', ({ addr }) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? null,
      addr,
      type: null,
      event: 'ack',
      data: null,
    });
  });

  bus.on('response', ({ addr, txType, records, raw }) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr,
      type: txType,
      event: 'response',
      data: {
        txType,
        records: records?.map(r => ({
          type: r.type,
          meta: r.meta,
          data: r.data.toString('hex'),
        })) ?? null,
      },
    });
  });

  bus.start();
  await new Promise(r => setTimeout(r, durationMs));
  bus.stop();

  return events;
}
