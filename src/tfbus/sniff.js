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
export async function sniffBus(transport, { durationMs = 5000, filter = true, addr = null } = {}) {
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

  const result = filter ? filterIdle(events) : events;
  return addr !== null ? result.filter(e => e.addr === addr) : result;
}

/**
 * Remove STATUS_POLL TX pings and status responses whose records haven't
 * changed since the last status from the same address.
 *
 * @param {SniffEvent[]} events
 * @returns {SniffEvent[]}
 */
function filterIdle(events) {
  const lastStatus = new Map();
  return events.filter(e => {
    if (e.event === 'tx' && e.type === 0x04) return false;
    if (e.event === 'status') {
      const key = JSON.stringify(e.data?.records ?? null);
      if (lastStatus.get(e.addr) === key) return false;
      lastStatus.set(e.addr, key);
    }
    return true;
  });
}
