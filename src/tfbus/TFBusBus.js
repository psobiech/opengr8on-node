import { statusPollFrame } from './TFBusCommands.js';
import { parseRxFrame } from './TFBusFrame.js';
import { parseStatusPoll } from './StatusPollResponse.js';

// Queue interface (implement for your physical layer):
//   enqueue(buf: Buffer): void               push frame to TX queue (non-blocking)
//   dequeue(): Promise<Buffer | null>        pop next complete RX frame; null = timeout / empty

function parseRxResponse(buf) {
  const frame = parseRxFrame(buf);
  if (!frame) return null;
  const { records, raw } = parseStatusPoll(frame.payload);
  return { records, raw };
}

// Dequeue and parse one incoming RX frame without sending a poll.
// Returns { records: TLVRecord[] | null, raw: Buffer } | null
export async function receiveMessage(queue) {
  const buf = await queue.dequeue();
  return buf === null ? null : parseRxResponse(buf);
}

// Enqueue STATUS_POLL to dest, dequeue one response frame.
// Skips TX echo frames (dest ≠ 0x00) that SerialTransport delivers on half-duplex RS485.
// Returns { address, records, raw } | null (null = timeout or invalid frame).
export async function pollAddress(dest, queue) {
  queue.enqueue(statusPollFrame(dest));
  for (;;) {
    const buf = await queue.dequeue();
    if (buf === null) return null;
    if (buf.length >= 2 && buf[1] !== 0x00) continue; // skip TX echo
    const result = parseRxResponse(buf);
    return result ? { address: dest, ...result } : null;
  }
}

// Poll each address sequentially.
// Returns Map<address, { address, records, raw } | null>.
export async function pollBus(addresses, queue) {
  const results = new Map();
  for (const addr of addresses) {
    results.set(addr, await pollAddress(addr, queue));
  }
  return results;
}
