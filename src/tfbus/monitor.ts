import { resolve } from 'node:path';
import type { TFBusTransport } from './transport/SerialTransport.js';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { statusPollFrame, versionQueryFrame, seekFrame, resetFrame } from './TFBusCommands.js';
import { parseStatusPoll, TLVType } from './StatusPollResponse.js';
import { parseVersionResponse, type VersionQueryResponse } from './VersionQueryResponse.js';
import { transcribeModules, type TranscribeOptions } from '../parsers/interfaces/transcribeModules.js';
import type { ModuleEntry, ModuleTranscript } from '../parsers/interfaces/ModuleTranscript.js';
import { readTFBusModules } from '../parsers/omp/OmpReader.js';

export interface MonitorOptions {
  /** Device-interfaces directory for registry. */
  dir?: string;
  /** Translation language. Default 'pl'. */
  lang?: string;
  /** RS485 address range to scan. Default [1, 30]. Active mode only. */
  scanRange?: [number, number];
  /** Send RESET broadcast before seek. Active mode only. */
  reset?: boolean;
  /** Send SEEK broadcast before scanning. Active mode only. */
  seek?: boolean;
  /** Minimum ms between full poll cycles. Default 500. Active mode only. */
  pollIntervalMs?: number;
  /** Called for each log line instead of writing to stdout. */
  logger?: (line: string) => void;
  /**
   * Listen-only: decode CLU bus traffic without sending any frames. Default: true.
   */
  passive?: boolean;
  /**
   * Our RS485 address for active mode response filtering (exact match).
   * Unset (default): accept all frames. Set to 0x00 when acting as CLU master.
   */
  myAddr?: number;
  /** Path to an .omp project file. Pre-populates module names and RS485 addresses. */
  ompPath?: string;
  /** CLU serial (decimal string) to use when multiple CLUs exist in the OMP file. */
  cluSerial?: string;
}

interface ModuleState {
  addr: number;
  versionBytes: Buffer | null;
  version: VersionQueryResponse | null;
  entry: ModuleEntry | null;
  name: string;
}

// ─── TLV decoding ─────────────────────────────────────────────────────────────

const TLV_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(TLVType).map(([typeName, typeValue]) => [typeValue as number, typeName]),
);

// TLV type → object class IDs (tried in order) + how to label the record.
// classes are the CLU object class numbers from the module XML registry.
interface TlvHint {
  classes: number[];
  feature?: string;   // feature name to use as label
  isEvent?: true;     // data encodes btn_idx*7+event_id → look up BUTTON.OnXxx
}

const TLV_HINTS: Record<number, TlvHint> = {
  [TLVType.INPUT_BITMASK]:   { classes: [3],       feature: 'Value' },   // DIN
  [TLVType.STATE]:            { classes: [4, 5],    feature: 'Value' },   // DOUT / DIMM
  [TLVType.TEMPERATURE]:      { classes: [20],      feature: 'Value' },   // PANELSENSTEMP
  [TLVType.DIGITAL_STATE]:    { classes: [4, 3],    feature: 'Value' },   // DOUT / DIN
  [TLVType.LIGHT]:            { classes: [21],      feature: 'Value' },   // PANELSENSLIGHT
  [TLVType.BUTTON_EVENT]:     { classes: [7, 3],    isEvent: true },      // BUTTON / DIN
  [TLVType.ROLLER_POSITION]:  { classes: [24],      feature: 'State' },   // ROLLER_SHUTTER
};

// ─── Monitor ──────────────────────────────────────────────────────────────────

export async function runMonitor(transport: TFBusTransport, options: MonitorOptions = {}): Promise<void> {
  const {
    dir = resolve('docs/device-interfaces'),
    lang = 'pl',
    scanRange = [1, 30],
    reset = false,
    seek = false,
    pollIntervalMs = 500,
    logger = (line) => process.stdout.write(line + '\n'),
    passive = true,
    myAddr,
    ompPath,
    cluSerial,
  } = options;

  const log = logger;

  const { output: transcript, errors } = transcribeModules(dir, { lang } satisfies TranscribeOptions);
  for (const error of errors) process.stderr.write(`warn: ${error}\n`);

  const ompModules = buildOmpIndex(ompPath, cluSerial, transcript);

  if (passive) {
    log('Passive mode — listening to CLU bus traffic (Ctrl-C to stop)…');
    await runPassiveLoop(transport, transcript, log, ompModules);
    return;
  }

  if (reset) {
    log('Broadcasting RESET…');
    transport.enqueue(resetFrame());
    await sleep(300);
  }
  if (seek || reset) {
    log('Broadcasting SEEK…');
    transport.enqueue(seekFrame());
    await sleep(300);
    while (await transport.dequeue() !== null) { /* drain ACKs */ }
  }

  const [scanFrom, scanTo] = scanRange;
  log(`Scanning addresses ${scanFrom}–${scanTo}…`);

  const activeModules = new Map<number, ModuleState>(ompModules);

  for (let addr = scanFrom; addr <= scanTo; addr++) {
    transport.enqueue(statusPollFrame(addr));
    const pollRawFrame = await dequeueRx(transport, myAddr);
    if (!pollRawFrame) continue;

    let versionBytes: Buffer | null = null;
    let version: VersionQueryResponse | null = null;
    let entry: ModuleEntry | null = null;

    transport.enqueue(versionQueryFrame(addr));
    const versionRawFrame = await dequeueRx(transport, myAddr);
    if (versionRawFrame) {
      const versionFrame = parseRxFrame(versionRawFrame);
      if (versionFrame && versionFrame.payload.length > 0) {
        versionBytes = versionFrame.payload;
        version = parseVersionResponse(versionFrame.payload);
        entry = findInTranscript(transcript, versionFrame.payload);
      }
    }

    const name = entry?.name ?? 'unknown';
    const versionSuffix = versionBytes ? ` [${versionBytes.toString('hex')}]` : '';
    log(`  addr=${String(addr).padStart(2, '0')}  ${name}${versionSuffix}`);
    activeModules.set(addr, { addr, versionBytes, version, entry, name });
  }

  if (activeModules.size === 0) {
    log('No modules found. Check wiring and address range.');
    return;
  }

  log(`\nMonitoring ${activeModules.size} module(s) — Ctrl-C to stop\n`);

  for (;;) {
    const cycleStart = Date.now();

    for (const info of activeModules.values()) {
      transport.enqueue(statusPollFrame(info.addr));
      const rawFrame = await dequeueRx(transport, myAddr);
      if (!rawFrame) continue;

      const frame = parseRxFrame(rawFrame);
      if (!frame) continue;

      const { records, raw } = parseStatusPoll(frame.payload);

      if (records === null) {
        log(`[${timestamp()}] addr=${String(info.addr).padStart(2, '0')} ${info.name} | raw: ${raw.toString('hex')}`);
        continue;
      }
      if (records.length === 0) continue;

      const decoded = records.map((record: { type: number; meta: number; data: Buffer }) => decodeTlvRecord(record, info.entry)).join(' | ');
      log(`[${timestamp()}] addr=${String(info.addr).padStart(2, '0')} ${info.name} | ${decoded}`);
    }

    const elapsed = Date.now() - cycleStart;
    const wait = Math.max(0, pollIntervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}

// ─── OMP integration ─────────────────────────────────────────────────────────

/** addr → pre-populated ModuleState from OMP data, or empty Map if no OMP. */
function buildOmpIndex(
  ompPath: string | undefined,
  cluSerial: string | undefined,
  transcript: ModuleTranscript,
): Map<number, ModuleState> {
  if (!ompPath) return new Map();
  let modules;
  try {
    modules = readTFBusModules(ompPath);
  } catch (error) {
    process.stderr.write(`warn: failed to read OMP: ${(error as Error).message}\n`);
    return new Map();
  }
  if (cluSerial) modules = modules.filter(ompModule => ompModule.cluSerial === cluSerial);
  const map = new Map<number, ModuleState>();
  for (const ompModule of modules) {
    const entry = findInTranscriptByFields(transcript, ompModule.hwType, ompModule.fwVer);
    const ioLabel = ompModule.ioNames.length > 0 ? ompModule.ioNames[0] : null;
    const name = ioLabel ?? entry?.name ?? `0x${ompModule.serialHex}`;
    map.set(ompModule.addr, { addr: ompModule.addr, versionBytes: null, version: null, entry, name });
  }
  return map;
}

// ─── Passive loop ─────────────────────────────────────────────────────────────

async function runPassiveLoop(
  transport: Pick<TFBusTransport, 'dequeue'>,
  transcript: ModuleTranscript,
  log: (line: string) => void,
  seed: Map<number, ModuleState> = new Map(),
): Promise<void> {
  const activeModules = new Map<number, ModuleState>(seed);
  let lastTxType: number | null = null;
  let lastTxAddr: number | null = null;

  for (;;) {
    const rawFrame = await transport.dequeue();
    if (rawFrame === null) continue;
    if (rawFrame.length < 4 || rawFrame[0] !== 0xAA) continue;

    if (rawFrame[1] !== 0x00) {
      // CLU TX frame — track context for upcoming module response
      const txFrame = parseBusTxFrame(rawFrame);
      if (txFrame) { lastTxType = txFrame.type; lastTxAddr = txFrame.dest; }
      continue;
    }

    // Module RX response (dest = 0x00)
    if (lastTxAddr === null) continue;
    const addr = lastTxAddr;
    const rxFrame = parseRxFrame(rawFrame);
    if (!rxFrame) continue;

    if (lastTxType === 0xF9) {
      // VERSION_QUERY response — record once per address
      if (!activeModules.get(addr)?.version) {
        const version = parseVersionResponse(rxFrame.payload);
        const entry = version ? findInTranscript(transcript, rxFrame.payload) : null;
        const existing = activeModules.get(addr);
        const name = entry?.name ?? existing?.name ?? 'unknown';
        const versionSuffix = rxFrame.payload.length > 0 ? ` [${rxFrame.payload.toString('hex')}]` : '';
        activeModules.set(addr, { addr, versionBytes: rxFrame.payload, version, entry: entry ?? existing?.entry ?? null, name });
        log(`  addr=${String(addr).padStart(2, '0')}  ${name}${versionSuffix}`);
      }
    } else if (lastTxType === 0x04) {
      // STATUS_POLL response
      if (!activeModules.has(addr)) {
        activeModules.set(addr, { addr, versionBytes: null, version: null, entry: null, name: 'unknown' });
      }
      const info = activeModules.get(addr)!;
      const { records, raw } = parseStatusPoll(rxFrame.payload);

      if (records === null) {
        log(`[${timestamp()}] addr=${String(addr).padStart(2, '0')} ${info.name} | raw: ${raw.toString('hex')}`);
      } else if (records.length > 0) {
        const decoded = records.map((record: { type: number; meta: number; data: Buffer }) => decodeTlvRecord(record, info.entry)).join(' | ');
        log(`[${timestamp()}] addr=${String(addr).padStart(2, '0')} ${info.name} | ${decoded}`);
      }
    }
  }
}

function sleep(ms: number) { return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)); }

// Active mode: dequeue next frame addressed exactly to myAddr, discard everything else.
// If myAddr is unset, return any frame (no filter).
async function dequeueRx(transport: TFBusTransport, myAddr?: number): Promise<Buffer | null> {
  for (;;) {
    const rawFrame = await transport.dequeue();
    if (rawFrame === null) return null;
    if (myAddr === undefined || rawFrame[1] === myAddr) return rawFrame;
  }
}

// ─── Registry matching ────────────────────────────────────────────────────────

function findInTranscript(transcript: ModuleTranscript, payload: Buffer): ModuleEntry | null {
  if (payload.length < 3) return null;
  return findInTranscriptByFields(transcript, payload[0], payload[2]);
}

function findInTranscriptByFields(transcript: ModuleTranscript, hwType: number, fwApiVer: number): ModuleEntry | null {
  const byFwType = (transcript as Record<number, Record<number, Record<number, ModuleEntry>>>)[hwType];
  if (!byFwType) return null;
  for (const byFwApiVer of Object.values(byFwType)) {
    const entry = byFwApiVer[fwApiVer];
    if (entry) return entry;
  }
  const fallback = Object.values(Object.values(byFwType)[0] ?? {})[0];
  return fallback ?? null;
}

function timestamp() { return new Date().toISOString().slice(11, 23); }

// ─── TLV record formatting ────────────────────────────────────────────────────

function decodeTlvRecord(
  record: { type: number; meta: number; data: Buffer },
  entry: ModuleEntry | null,
): string {
  const fallback = TLV_NAMES[record.type] ?? `0x${record.type.toString(16).padStart(2, '0')}`;
  const hint = TLV_HINTS[record.type];

  if (!entry || !hint || hint.classes.length === 0) {
    return `${fallback}: ${decodeValue(record.type, record.data)}`;
  }

  const objectEntry = hint.classes.map((objectClass) => entry.objects[objectClass]).find(Boolean);
  if (!objectEntry) return `${fallback}: ${decodeValue(record.type, record.data)}`;

  if (hint.isEvent) {
    const eventCode = record.data[0];
    const btnIdx = Math.floor(eventCode / 7);
    const eventId = eventCode % 7;
    const eventDefinition = objectEntry.events[eventId];
    const label = eventDefinition ? `${objectEntry.name}.${eventDefinition.name}` : `${objectEntry.name}.event${eventId}`;
    return `${label}: btn${btnIdx}`;
  }

  return `${objectEntry.name}.${hint.feature ?? 'Value'}: ${decodeValue(record.type, record.data)}`;
}

function decodeValue(type: number, data: Buffer): string {
  switch (type) {
    case TLVType.TEMPERATURE:
      return data.length >= 2 ? `${(data.readUInt16LE(0) / 100).toFixed(2)}°C` : data.toString('hex');
    case TLVType.LIGHT:
      return data.length >= 2 ? `${(data.readUInt16LE(0) / 100).toFixed(2)}%` : data.toString('hex');
    case TLVType.ROLLER_POSITION:
      return data.length >= 3
        ? `ch${data[0]} ${data[1]}%${data[2] !== 0 ? ' moving' : ' stopped'}`
        : data.toString('hex');
    case TLVType.INPUT_BITMASK:
      return `0b${data[0].toString(2).padStart(8, '0')}`;
    case TLVType.STATE:
      // 1-byte: relay on/off; 2-byte: dimmer level 0-1000 (×0.1%)
      if (data.length >= 2) return `${(data.readUInt16LE(0) / 10).toFixed(1)}%`;
      return data[0] === 0 ? 'idle' : 'active';
    case TLVType.DIGITAL_STATE:
      return data[0] === 0 ? 'idle' : 'active';
    case TLVType.POLL_COUNTER:
      return String(data[0]);
    default:
      return data.toString('hex');
  }
}
