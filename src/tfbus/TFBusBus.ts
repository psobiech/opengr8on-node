import { statusPollFrame } from './TFBusCommands.js';
import { parseRxFrame } from './TFBusFrame.js';
import { parseStatusPoll, type TLVRecord } from './StatusPollResponse.js';

interface TFBusQueue {
  enqueue(buf: Buffer): void;
  dequeue(): Promise<Buffer | null>;
}

interface PollResult {
  address: number;
  records: TLVRecord[] | null;
  raw: Buffer;
}

function parseRxResponse(buf: Buffer): { records: TLVRecord[] | null; raw: Buffer } | null {
  const frame = parseRxFrame(buf);
  if (!frame) return null;
  const { records, raw } = parseStatusPoll(frame.payload);
  return { records, raw };
}

export async function receiveMessage(queue: TFBusQueue): Promise<{ records: TLVRecord[] | null; raw: Buffer } | null> {
  const buf = await queue.dequeue();
  return buf === null ? null : parseRxResponse(buf);
}

export async function pollAddress(dest: number, queue: TFBusQueue): Promise<PollResult | null> {
  queue.enqueue(statusPollFrame(dest));
  for (;;) {
    const buf = await queue.dequeue();
    if (buf === null) return null;
    if (buf.length >= 2 && buf[1] !== 0x00) continue;
    const result = parseRxResponse(buf);
    return result ? { address: dest, ...result } : null;
  }
}

export async function pollBus(addresses: number[], queue: TFBusQueue): Promise<Map<number, PollResult | null>> {
  const results = new Map<number, PollResult | null>();
  for (const addr of addresses) {
    results.set(addr, await pollAddress(addr, queue));
  }
  return results;
}
