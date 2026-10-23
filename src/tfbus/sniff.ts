import { TFBusEventBus, type FrameEvent, type StatusEvent, type VersionEvent, type AckEvent, type ResponseEvent } from './TFBusEventBus.js';
import { parseBusTxFrame } from './TFBusFrame.js';
import type { TFBusTransport } from './transport/SerialTransport.js';

export interface SniffEvent {
  ts: number;
  dir: 'tx' | 'rx';
  hex: string;
  addr: number;
  type: number | null;
  event: 'tx' | 'status' | 'version' | 'ack' | 'response';
  data: object | null;
}

export interface SniffOptions {
  durationMs?: number;
  filter?: boolean;
  addr?: number | null;
}

export async function sniffBus(transport: TFBusTransport, { durationMs = 5000, filter = true, addr = null }: SniffOptions = {}): Promise<SniffEvent[]> {
  const bus = new TFBusEventBus(transport);
  const events: SniffEvent[] = [];
  let lastRxBuf: Buffer | null = null;

  bus.on('frame', ({ buf, dir }: FrameEvent) => {
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

  bus.on('status', ({ addr: a, records, raw }: StatusEvent) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr: a,
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

  bus.on('version', ({ addr: a, version, raw }: VersionEvent) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr: a,
      type: 0xF9,
      event: 'version',
      data: version,
    });
  });

  bus.on('ack', ({ addr: a }: AckEvent) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? '',
      addr: a,
      type: null,
      event: 'ack',
      data: null,
    });
  });

  bus.on('response', ({ addr: a, txType, records, raw }: ResponseEvent) => {
    events.push({
      ts: Date.now(),
      dir: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      addr: a,
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

function filterIdle(events: SniffEvent[]): SniffEvent[] {
  const lastStatus = new Map<number, string>();
  return events.filter(e => {
    if (e.event === 'tx' && e.type === 0x04) return false;
    if (e.event === 'status') {
      const key = JSON.stringify((e.data as { records: unknown } | null)?.records ?? null);
      if (lastStatus.get(e.addr) === key) return false;
      lastStatus.set(e.addr, key);
    }
    return true;
  });
}
