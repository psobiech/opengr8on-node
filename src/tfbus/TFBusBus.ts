import { statusPollFrame } from './TFBusCommands.js';
import { parseRxFrame } from './TFBusFrame.js';
import { parseStatusPoll, type TLVRecord } from './StatusPollResponse.js';

interface TFBusQueue {
  enqueue(frame: Buffer): void;
  dequeue(): Promise<Buffer | null>;
}

interface PollResult {
  address: number;
  records: TLVRecord[] | null;
  raw: Buffer;
}

export async function receiveMessage(queue: TFBusQueue): Promise<{ records: TLVRecord[] | null; raw: Buffer } | null> {
  const rawFrame = await queue.dequeue();
  return rawFrame === null ? null : parseRxResponse(rawFrame);
}

export async function pollBus(addresses: number[], queue: TFBusQueue): Promise<Map<number, PollResult | null>> {
  const results = new Map<number, PollResult | null>();
  for (const address of addresses) {
    results.set(address, await pollAddress(address, queue));
  }
  return results;
}

export async function pollAddress(dest: number, queue: TFBusQueue): Promise<PollResult | null> {
  queue.enqueue(statusPollFrame(dest));
  for (;;) {
    const rawFrame = await queue.dequeue();
    if (rawFrame === null) return null;
    if (rawFrame.length >= 2 && rawFrame[1] !== 0x00) continue;
    const result = parseRxResponse(rawFrame);
    return result ? { address: dest, ...result } : null;
  }
}

function parseRxResponse(rawFrame: Buffer): { records: TLVRecord[] | null; raw: Buffer } | null {
  const frame = parseRxFrame(rawFrame);
  if (!frame) return null;
  const { records, raw } = parseStatusPoll(frame.payload);
  return { records, raw };
}
