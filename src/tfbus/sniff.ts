import { TFBusEventBus, type FrameEvent, type StatusEvent, type VersionEvent, type AckEvent, type ResponseEvent } from './TFBusEventBus.js';
import { parseBusTxFrame } from './TFBusFrame.js';
import type { TFBusTransport } from './transport/SerialTransport.js';

export interface SniffEvent {
  timestampMs: number;
  direction: 'tx' | 'rx' | 'junk';
  hex: string;
  address: number;
  type: number | null;
  event: 'tx' | 'status' | 'version' | 'ack' | 'response' | 'junk';
  data: object | null;
}

export interface SniffOptions {
  durationMs?: number;
  filter?: boolean;
  address?: number | null;
}

export async function sniffBus(transport: TFBusTransport, { durationMs = 5000, filter = true, address = null }: SniffOptions = {}): Promise<SniffEvent[]> {
  const bus = new TFBusEventBus(transport);
  const events: SniffEvent[] = [];
  let lastRxBuf: Buffer | null = null;

  bus.on('frame', ({ frame, direction }: FrameEvent) => {
    if (direction === 'rx') {
      lastRxBuf = frame;
      return;
    }
    const txFrame = parseBusTxFrame(frame);
    events.push({
      timestampMs: Date.now(),
      direction: 'tx',
      hex: frame.toString('hex'),
      address: frame[1],
      type: frame[2],
      event: 'tx',
      data: txFrame?.payload.length ? { payload: txFrame.payload.toString('hex') } : null,
    });
  });

  bus.on('status', ({ address: moduleAddress, records, raw }: StatusEvent) => {
    events.push({
      timestampMs: Date.now(),
      direction: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      address: moduleAddress,
      type: 0x04,
      event: 'status',
      data: {
        records: records?.map(record => ({
          type: record.type,
          meta: record.meta,
          data: record.data.toString('hex'),
        })) ?? null,
      },
    });
  });

  bus.on('version', ({ address: moduleAddress, version, raw }: VersionEvent) => {
    events.push({
      timestampMs: Date.now(),
      direction: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      address: moduleAddress,
      type: 0xF9,
      event: 'version',
      data: version,
    });
  });

  bus.on('ack', ({ address: moduleAddress }: AckEvent) => {
    events.push({
      timestampMs: Date.now(),
      direction: 'rx',
      hex: lastRxBuf?.toString('hex') ?? '',
      address: moduleAddress,
      type: null,
      event: 'ack',
      data: null,
    });
  });

  bus.on('response', ({ address: moduleAddress, txType, records, raw }: ResponseEvent) => {
    events.push({
      timestampMs: Date.now(),
      direction: 'rx',
      hex: lastRxBuf?.toString('hex') ?? raw.toString('hex'),
      address: moduleAddress,
      type: txType,
      event: 'response',
      data: {
        txType,
        records: records?.map(record => ({
          type: record.type,
          meta: record.meta,
          data: record.data.toString('hex'),
        })) ?? null,
      },
    });
  });

  bus.start();
  await new Promise(resolveDelay => setTimeout(resolveDelay, durationMs));
  bus.stop();

  const result = filter ? filterIdle(events) : events;
  return address !== null ? result.filter(event => event.address === address) : result;
}

function filterIdle(events: SniffEvent[]): SniffEvent[] {
  const lastStatus = new Map<number, string>();
  return events.filter(event => {
    if (event.event === 'tx' && event.type === 0x04) return false;
    if (event.event === 'status') {
      const key = JSON.stringify((event.data as { records: unknown } | null)?.records ?? null);
      if (lastStatus.get(event.address) === key) return false;
      lastStatus.set(event.address, key);
    }
    return true;
  });
}

// One "ms direction hex" line per frame, ms relative to the first event.
export function formatCompact(events: SniffEvent[]): string {
  const firstTimestampMs = events[0]?.timestampMs ?? 0;
  return events.map(event => `${event.timestampMs - firstTimestampMs} ${event.direction} ${event.hex}`).join('\n');
}

// Collects discarded bytes as 'junk' events (pass collector.onSkip to SerialTransport). Bytes
// arriving within 5 ms of each other are merged into one event.
export function junkCollector(): { onSkip: (bytes: Buffer) => void; events: SniffEvent[] } {
  const events: SniffEvent[] = [];
  const onSkip = (bytes: Buffer) => {
    const now = Date.now();
    const last = events[events.length - 1];
    if (last && now - last.timestampMs <= 5) {
      last.hex += bytes.toString('hex');
      return;
    }
    events.push({ timestampMs: now, direction: 'junk', hex: bytes.toString('hex'), address: -1, type: null, event: 'junk', data: null });
  };
  return { onSkip, events };
}

// Merge two timestamp-sorted event lists.
export function mergeEvents(firstEvents: SniffEvent[], secondEvents: SniffEvent[]): SniffEvent[] {
  return [...firstEvents, ...secondEvents].sort((left, right) => left.timestampMs - right.timestampMs);
}
