import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { TFBusTransport } from './transport/SerialTransport.js';
import {
  moduleCmdFrame,
  activateRecord,
  deactivateRecord,
  dimmerSetValueRecord,
  setRampTimeRecord,
  setOutputRecord,
  setPositionRecord,
  statusPollFrame,
  versionQueryFrame,
} from './TFBusCommands.js';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { parseStatusPoll, TLVType } from './StatusPollResponse.js';
import { parseVersionResponse } from './VersionQueryResponse.js';
import { transcribeModules, type TranscribeOptions } from '../parsers/interfaces/transcribeModules.js';
import type { ModuleEntry, ModuleTranscript } from '../parsers/interfaces/ModuleTranscript.js';
import { readTFBusModules, type TFBusModuleInfo, type TFBusIOInfo } from '../parsers/omp/OmpReader.js';

export interface ReplOptions {
  dir?: string;
  lang?: string;
  ompPath?: string;
  cluSerial?: string;
  /** Timeout ms when waiting for module response. Default 300. */
  rxTimeoutMs?: number;
  /** Our RS485 sender address. Not used for response filtering (modules always respond to 0x00). Default 0xFE. */
  myAddr?: number;
  /** Bus baud rate — used only for utilization calculations. Default 115200. */
  baud?: number;
}

// ─── IO class constants ───────────────────────────────────────────────────────

const CLASS_DOUT           = 4;
const CLASS_DIMM           = 5;
const CLASS_ROLLER_SHUTTER = 24;

// ─── Wire encoding tables keyed by (ioClass, index) ──────────────────────────
// Names come from device interfaces transcript. Index → wire is protocol knowledge.

type FrameFn = (addr: number, chanIdx: number, params: number[]) => Buffer;

// execute method index → frame builder
// DIMM indices from DIMMER_MOSFET_DIN XML: 0=HoldValue, 1=Switch, 2=SwitchOn, 3=SwitchOff
const EXEC_WIRE: Record<number, Record<number, FrameFn>> = {
  [CLASS_DIMM]: {
    0: (addr, _channelIndex, params) => moduleCmdFrame(addr, params[0] ? [setRampTimeRecord(params[0]), activateRecord(0x80)] : [activateRecord(0x80)]),
    1: (addr, _channelIndex, params) => moduleCmdFrame(addr, params[1] ? [setRampTimeRecord(params[1]), activateRecord(0x80)] : [activateRecord(0x80)]),
    2: (addr, _channelIndex, params) => moduleCmdFrame(addr, params[1] ? [setRampTimeRecord(params[1]), activateRecord(0x80)] : [activateRecord(0x80)]),
    3: (addr, _channelIndex, params) => moduleCmdFrame(addr, params[1] ? [setRampTimeRecord(params[1]), deactivateRecord(0x01)] : [deactivateRecord(0x01)]),
  },
  [CLASS_DOUT]: {
    0: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setOutputRecord((1 << channelIndex) & 0xFF, 1)]),
    1: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setOutputRecord((1 << channelIndex) & 0xFF, 1)]),
    2: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setOutputRecord((1 << channelIndex) & 0xFF, 0)]),
  },
  [CLASS_ROLLER_SHUTTER]: {
    0: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setPositionRecord(0, channelIndex, 100)]),
    1: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setPositionRecord(0, channelIndex, 0)]),
    2: (addr, _channelIndex, _params) => moduleCmdFrame(addr, [activateRecord(0x80)]),
    3: (addr, _channelIndex, _params) => moduleCmdFrame(addr, [deactivateRecord(0x01)]),
    4: (addr, _channelIndex, _params) => moduleCmdFrame(addr, [activateRecord(0x80)]),
    5: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setPositionRecord(0, channelIndex, 100)]),
    6: (addr, channelIndex, _params) => moduleCmdFrame(addr, [setPositionRecord(0, channelIndex, 0)]),
  },
};

// get feature index → TLV type returned in STATUS_POLL response
const GET_WIRE: Record<number, Record<number, number>> = {
  [CLASS_DIMM]: {
    0: TLVType.STATE,             // Value → STATE (0–1000 = 0–100%)
  },
  [CLASS_DOUT]: {
    0: TLVType.INPUT_BITMASK,     // Output → INPUT_BITMASK
  },
  [CLASS_ROLLER_SHUTTER]: {
    0: TLVType.ROLLER_POSITION,   // Position → ROLLER_POSITION
  },
};

// set feature index → frame builder; params[0] = value
// DIMM: 0=Value(dimmerSetValue), 1=RampTime(setRampTime)
const SET_WIRE: Record<number, Record<number, FrameFn>> = {
  [CLASS_DIMM]: {
    0: (addr, _channelIndex, params) => moduleCmdFrame(addr, [dimmerSetValueRecord(params[0])]),
    1: (addr, _channelIndex, params) => moduleCmdFrame(addr, [setRampTimeRecord(params[0])]),
  },
  [CLASS_DOUT]: {
    0: (addr, channelIndex, params) => moduleCmdFrame(addr, [setOutputRecord((1 << channelIndex) & 0xFF, params[0])]),
  },
  [CLASS_ROLLER_SHUTTER]: {
    0: (addr, channelIndex, params) => moduleCmdFrame(addr, [setPositionRecord(0, channelIndex, params[0])]),
  },
};

// ─── Resolved target ─────────────────────────────────────────────────────────

interface Target {
  addr: number;
  ioInfo: TFBusIOInfo | null;
  entry: ModuleEntry | null;
  label: string;
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

export async function runRepl(transport: TFBusTransport, options: ReplOptions = {}): Promise<void> {
  const {
    dir = resolve('docs/device-interfaces'),
    lang = 'pl',
    ompPath,
    cluSerial,
    rxTimeoutMs = 300,
    baud = 115200,
  } = options;

  const { output: transcript, errors } = transcribeModules(dir, { lang } satisfies TranscribeOptions);
  for (const error of errors) process.stderr.write(`warn: ${error}\n`);

  // name (lower) → { module, ioInfo }
  const nameIndex = new Map<string, { module: TFBusModuleInfo; ioInfo: TFBusIOInfo }>();
  const addrIndex = new Map<number, { module: TFBusModuleInfo; entry: ModuleEntry | null }>();
  let ompModules: TFBusModuleInfo[] = [];

  if (ompPath) {
    try {
      ompModules = readTFBusModules(ompPath);
      if (cluSerial) ompModules = ompModules.filter(ompModule => ompModule.cluSerial === cluSerial);
      for (const ompModule of ompModules) {
        const entry = findByFields(transcript, ompModule.hwType, ompModule.fwVer);
        addrIndex.set(ompModule.addr, { module: ompModule, entry });
        for (const ioInfo of ompModule.ios) {
          nameIndex.set(ioInfo.name.toLowerCase(), { module: ompModule, ioInfo });
        }
      }
      process.stdout.write(`Loaded ${ompModules.length} module(s) from OMP.\n`);
    } catch (error) {
      process.stderr.write(`warn: OMP load failed: ${(error as Error).message}\n`);
    }
  }

  const SERIAL_CMDS = new Set(['get', 'status', 'version', 'set', 'execute', 'exec', 'on', 'off', 'listen', 'busload']);
  const COMMANDS = ['list', 'ls', 'get', 'info', 'status', 'version', 'set', 'execute', 'exec', 'listen', 'busload', 'on', 'off', 'help', 'exit', 'quit'];
  const TARGET_CMDS = new Set(['get', 'info', 'status', 'version', 'set', 'execute', 'exec', 'listen', 'on', 'off']);

  printHelp();

  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer });

  prompt();
  await new Promise<void>((resolve) => readline.on('close', resolve));

  function prompt() {
    readline.question('tfbus> ', async (line) => {
      const parts = line.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? '';
      if (command === 'exit' || command === 'quit') {
        readline.close();
        return;
      }
      try {
        await dispatch(command, parts.slice(1));
      } catch (error) {
        process.stdout.write(`error: ${(error as Error).message}\n`);
      }
      prompt();
    });
  }

  async function dispatch(command: string, args: string[]) {
    const needsSerial = SERIAL_CMDS.has(command);
    if (needsSerial) await transport.open();
    try {
    switch (command) {
      case 'list':
      case 'ls': {
        if (ompModules.length === 0) { process.stdout.write('No modules loaded (provide --omp).\n'); return; }
        for (const ompModule of ompModules) {
          const entry = addrIndex.get(ompModule.addr)?.entry ?? null;
          const type = entry?.name ?? `hwType=0x${ompModule.hwType.toString(16)}`;
          const names = ompModule.ioNames.slice(0, 3).join(', ') + (ompModule.ioNames.length > 3 ? ` +${ompModule.ioNames.length - 3}` : '');
          process.stdout.write(`  addr=${String(ompModule.addr).padStart(2, '0')}  ${type.padEnd(24)}  serial=${ompModule.serialHex}  [${names}]\n`);
        }
        break;
      }

      case 'info': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        const hit = addrIndex.get(target.addr);
        process.stdout.write(`addr=${target.addr}  label=${target.label}\n`);
        if (hit) {
          const ompModule = hit.module;
          process.stdout.write(`  serial=${ompModule.serialHex}  hwType=0x${ompModule.hwType.toString(16)}  fwType=${ompModule.fwType}  fwVer=${ompModule.fwVer}\n`);
          for (const ioInfo of ompModule.ios) {
            process.stdout.write(`  io: ${ioInfo.name.padEnd(36)}  class=${ioInfo.ioClass}  chan=${ioInfo.chanIdx}\n`);
          }
        }
        if (target.entry) {
          process.stdout.write(`  type: ${target.entry.name}\n`);
          for (const obj of Object.values(target.entry.objects)) {
            process.stdout.write(`  [${obj.name}]\n`);
            const featureList = Object.values(obj.features).map(feature => `${feature.name}(${feature.index})`).join('  ');
            const methodList = Object.values(obj.methods).map(method => `${method.name}(${method.index})`).join('  ');
            if (featureList) process.stdout.write(`    features: ${featureList}\n`);
            if (methodList) process.stdout.write(`    methods:  ${methodList}\n`);
          }
        }
        break;
      }

      case 'get': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        transport.enqueue(statusPollFrame(target.addr));
        const rawFrame = await rxAfterTx(target.addr, 0x04);
        if (!rawFrame) { process.stdout.write('No response.\n'); return; }
        const frame = parseRxFrame(rawFrame);
        if (!frame) { process.stdout.write(`Bad frame: ${rawFrame.toString('hex')}\n`); return; }
        const { records, raw } = parseStatusPoll(frame.payload);
        if (records === null) { process.stdout.write(`raw: ${raw.toString('hex')}\n`); return; }
        if (records.length === 0) { process.stdout.write('Empty response.\n'); return; }
        const featureName = args[1];
        if (!featureName) {
          for (const record of records) process.stdout.write(`  ${decodeTlvRecord(record)}\n`);
          break;
        }
        const ioClass = target.ioInfo?.ioClass ?? CLASS_DIMM;
        const obj = target.entry?.objects[ioClass];
        const feature = obj ? Object.values(obj.features).find(candidate => candidate.name.toLowerCase() === featureName.toLowerCase()) : null;
        if (!feature) {
          const available = obj ? Object.values(obj.features).filter(candidate => candidate.get).map(candidate => candidate.name).join(', ') : '(no transcript)';
          process.stdout.write(`Unknown feature: ${featureName}. Readable: ${available}\n`);
          return;
        }
        if (!feature.get) { process.stdout.write(`Feature ${feature.name} is write-only.\n`); return; }
        const tlvType = GET_WIRE[ioClass]?.[feature.index];
        if (tlvType === undefined) {
          process.stdout.write(`No TLV mapping for ${feature.name} (class=${ioClass} idx=${feature.index}). All records:\n`);
          for (const record of records) process.stdout.write(`  ${decodeTlvRecord(record)}\n`);
          break;
        }
        const match = records.find(record => record.type === tlvType);
        if (!match) { process.stdout.write(`  ${feature.name}: (not present in response)\n`); break; }
        process.stdout.write(`  ${feature.name}: ${decodeValue(match.type, match.data)}\n`);
        break;
      }

      case 'status': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        transport.enqueue(statusPollFrame(target.addr));
        const rawFrame = await rxAfterTx(target.addr, 0x04);
        if (!rawFrame) { process.stdout.write('No response.\n'); return; }
        const frame = parseRxFrame(rawFrame);
        if (!frame) { process.stdout.write(`Bad frame: ${rawFrame.toString('hex')}\n`); return; }
        const { records, raw } = parseStatusPoll(frame.payload);
        if (records === null) { process.stdout.write(`raw: ${raw.toString('hex')}\n`); return; }
        if (records.length === 0) { process.stdout.write('Empty response.\n'); return; }
        for (const record of records) {
          process.stdout.write(`  ${decodeTlvRecord(record)}\n`);
        }
        break;
      }

      case 'version': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        transport.enqueue(versionQueryFrame(target.addr));
        const rawFrame = await rxAfterTx(target.addr, 0xF9);
        if (!rawFrame) { process.stdout.write('No response.\n'); return; }
        const frame = parseRxFrame(rawFrame);
        if (!frame || frame.payload.length === 0) { process.stdout.write('No version data.\n'); return; }
        const version = parseVersionResponse(frame.payload);
        process.stdout.write(`  raw: ${frame.payload.toString('hex')}\n`);
        if (version) process.stdout.write(`  ${JSON.stringify(version)}\n`);
        break;
      }

      case 'set': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        const featureName = args[1];
        const rawValue = args[2];
        if (!featureName || rawValue === undefined) { process.stdout.write('Usage: set <name|addr> <Feature> <value>\n'); return; }
        const value = Number(rawValue);
        if (isNaN(value)) { process.stdout.write(`Invalid value: ${rawValue}\n`); return; }
        const ioClass = target.ioInfo?.ioClass ?? CLASS_DIMM;
        const chanIdx = target.ioInfo?.chanIdx ?? 0;
        const obj = target.entry?.objects[ioClass];
        const feature = obj ? Object.values(obj.features).find(candidate => candidate.name.toLowerCase() === featureName.toLowerCase()) : null;
        if (!feature) {
          const available = obj ? Object.values(obj.features).filter(candidate => candidate.set).map(candidate => candidate.name).join(', ') : '(no transcript)';
          process.stdout.write(`Unknown feature: ${featureName}. Settable: ${available}\n`);
          return;
        }
        if (!feature.set) { process.stdout.write(`Feature ${feature.name} is read-only.\n`); return; }
        const frameBuilder = SET_WIRE[ioClass]?.[feature.index];
        if (!frameBuilder) {
          process.stdout.write(`No wire encoding for ${feature.name} (class=${ioClass} idx=${feature.index}).\n`);
          return;
        }
        transport.enqueue(frameBuilder(target.addr, chanIdx, [value]));
        process.stdout.write(`set ${feature.name}=${value} → addr=${target.addr} [${target.label}]\n`);
        await showResponse(target.addr, 0xF0);
        break;
      }

      case 'execute':
      case 'exec': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        const methodName = args[1];
        if (!methodName) { process.stdout.write('Usage: execute <name|addr> <Method> [param…]\n'); return; }
        const params = args.slice(2).map(Number);
        const ioClass = target.ioInfo?.ioClass ?? CLASS_DIMM;
        const chanIdx = target.ioInfo?.chanIdx ?? 0;
        const obj = target.entry?.objects[ioClass];
        const method = obj ? Object.values(obj.methods).find(candidate => candidate.name.toLowerCase() === methodName.toLowerCase()) : null;
        if (!method) {
          const available = obj ? Object.values(obj.methods).map(candidate => `${candidate.name}(${candidate.params.map(param => param.name).join(',')})`).join(', ') : '(no transcript)';
          process.stdout.write(`Unknown method: ${methodName}. Available: ${available}\n`);
          return;
        }
        const wire = method.call === 'set' ? SET_WIRE : EXEC_WIRE;
        const frameBuilder = wire[ioClass]?.[method.index];
        if (!frameBuilder) {
          process.stdout.write(`No wire encoding for ${method.name} (class=${ioClass} idx=${method.index} call=${method.call}).\n`);
          return;
        }
        transport.enqueue(frameBuilder(target.addr, chanIdx, params));
        const paramStr = method.params.map((param, i) => `${param.name}=${params[i] ?? '?'}`).join(', ');
        process.stdout.write(`execute ${method.name}(${paramStr}) → addr=${target.addr} [${target.label}]\n`);
        await showResponse(target.addr, 0xF0);
        break;
      }

      case 'listen': {
        const firstIsSeconds = args[0] !== undefined && /^\d+$/.test(args[0]);
        if (!args[0] || firstIsSeconds) {
          const seconds = firstIsSeconds ? Math.max(1, parseInt(args[0], 10)) : 5;
          const globalLabel = (addr: number) => {
            const hit = addrIndex.get(addr);
            return hit ? (hit.module.ioNames[0] ?? hit.entry?.name ?? `addr=${addr}`) : `addr=${addr}`;
          };
          await listenModule(transport, null, globalLabel, seconds);
        } else {
          const target = resolveTarget(args[0]);
          if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
          const seconds = Math.max(1, parseInt(args[1] ?? '5', 10));
          await listenModule(transport, target.addr, () => target.label, seconds);
        }
        break;
      }

      case 'busload': {
        const seconds = Math.max(1, parseInt(args[0] ?? '10', 10));
        await measureBusLoad(transport, seconds, baud);
        break;
      }

      case 'on': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        transport.enqueue(buildOnOff(target, true));
        process.stdout.write(`sent ON → addr=${target.addr} [${target.label}]\n`);
        await showResponse(target.addr, 0xF0);
        break;
      }

      case 'off': {
        const target = resolveTarget(args[0]);
        if (!target) { process.stdout.write(`Unknown target: ${args[0]}\n`); return; }
        transport.enqueue(buildOnOff(target, false));
        process.stdout.write(`sent OFF → addr=${target.addr} [${target.label}]\n`);
        await showResponse(target.addr, 0xF0);
        break;
      }

      case 'help':
        printHelp();
        break;

      case '':
        break;

      default:
        process.stdout.write(`Unknown command: ${command}. Type 'help' for usage.\n`);
    }
    } finally {
      if (needsSerial) await transport.close();
    }
  }

  function completer(line: string): [string[], string] {
    const parts = line.split(/\s+/);

    if (parts.length <= 1) {
      const prefix = parts[0] ?? '';
      const hits = COMMANDS.filter(command => command.startsWith(prefix));
      return [hits.length ? hits : COMMANDS, prefix];
    }

    const command = parts[0].toLowerCase();
    const argIdx = parts.length - 1;
    const current = parts[argIdx] ?? '';

    if (argIdx === 1 && TARGET_CMDS.has(command)) {
      const names = [...nameIndex.values()].map(indexEntry => indexEntry.ioInfo.name);
      const hits = names.filter(name => name.toLowerCase().startsWith(current.toLowerCase()));
      return [hits.length ? hits : names, current];
    }

    if (argIdx === 2 && (command === 'get' || command === 'set' || command === 'execute' || command === 'exec')) {
      const target = resolveTarget(parts[1]);
      if (target?.entry) {
        const ioClass = target.ioInfo?.ioClass ?? CLASS_DIMM;
        const obj = target.entry.objects[ioClass];
        if (obj) {
          const candidates = command === 'get'
            ? Object.values(obj.features).filter(feature => feature.get).map(feature => feature.name)
            : command === 'set'
              ? Object.values(obj.features).filter(feature => feature.set).map(feature => feature.name)
              : Object.values(obj.methods).map(method => method.name);
          const hits = candidates.filter(name => name.toLowerCase().startsWith(current.toLowerCase()));
          return [hits.length ? hits : candidates, current];
        }
      }
    }

    return [[], current];
  }

  function resolveTarget(arg: string): Target | null {
    if (!arg) return null;
    // numeric addr
    const numericAddr = arg.startsWith('0x') || arg.startsWith('0X')
      ? parseInt(arg.slice(2), 16)
      : /^\d+$/.test(arg) ? parseInt(arg, 10) : NaN;
    if (!isNaN(numericAddr)) {
      const hit = addrIndex.get(numericAddr);
      return { addr: numericAddr, ioInfo: null, entry: hit?.entry ?? null, label: `addr=${numericAddr}` };
    }
    // name lookup
    const hit = nameIndex.get(arg.toLowerCase());
    if (hit) {
      const { module: ompModule, ioInfo } = hit;
      return { addr: ompModule.addr, ioInfo, entry: addrIndex.get(ompModule.addr)?.entry ?? null, label: ioInfo.name };
    }
    return null;
  }

  async function showResponse(addr: number, txType: number): Promise<void> {
    const rawFrame = await rxAfterTx(addr, txType);
    if (!rawFrame) { process.stdout.write('  (no response)\n'); return; }
    const frame = parseRxFrame(rawFrame);
    if (!frame) { process.stdout.write(`  raw: ${rawFrame.toString('hex')}\n`); return; }
    if (frame.payload.length === 0) { process.stdout.write('  (ack)\n'); return; }
    const { records, raw } = parseStatusPoll(frame.payload);
    if (records === null) {
      process.stdout.write(`  raw: ${raw.toString('hex')}\n`);
    } else {
      for (const record of records) process.stdout.write(`  ${decodeTlvRecord(record)}\n`);
    }
  }

  // Send txType to addr, wait for the module's response (buf[1] === 0x00, always CLU addr).
  // Syncs on RS485 TX echo first to skip stale queued frames; RS485 is sequential so the
  // first 0x00 frame after our echo is the module's reply to our query.
  async function rxAfterTx(addr: number, txType: number): Promise<Buffer | null> {
    const deadline = Date.now() + rxTimeoutMs;
    let synced = false;

    while (Date.now() < deadline) {
      const rawFrame = await transport.dequeue();
      if (rawFrame === null || rawFrame.length < 3 || rawFrame[0] !== 0xAA) continue;

      if (!synced) {
        // Wait for our TX echo (dest=addr, type=txType)
        if (rawFrame[1] === addr && rawFrame[2] === txType) synced = true;
        continue;
      }

      // After echo: first frame addressed to CLU (0x00) is the module's response
      if (rawFrame[1] === 0x00) return rawFrame;
    }
    return null;
  }

  function printHelp() {
    process.stdout.write([
      '',
      'Commands:',
      '  list                              — list all known modules',
      '  info <name|addr>                  — module details + transcript features/methods',
      '  get <name|addr> [Feature]          — STATUS_POLL: all values, or one named feature',
      '  status <name|addr>                — send STATUS_POLL and decode response',
      '  version <name|addr>               — send VERSION_QUERY',
      '  set <name|addr> <Feature> <value> — set a feature by transcript name',
      '  execute <name|addr> <Method> [p…] — execute a method by transcript name',
      '  listen [name|addr] [seconds=5]    — passively watch module(s) for N seconds',
      '  busload [seconds=10]              — measure RS485 bus utilisation %',
      '  on <name|addr>                    — shortcut: ACTIVATE',
      '  off <name|addr>                   — shortcut: DEACTIVATE',
      '  help                              — this text',
      '  exit / quit                       — exit',
      '',
    ].join('\n'));
  }
}

// ─── Transcript lookup ────────────────────────────────────────────────────────

function findByFields(transcript: ModuleTranscript, hwType: number, fwVer: number): ModuleEntry | null {
  const byFwType = (transcript as Record<number, Record<number, Record<number, ModuleEntry>>>)[hwType];
  if (!byFwType) return null;
  for (const byFwApiVer of Object.values(byFwType)) {
    const entry = byFwApiVer[fwVer];
    if (entry) return entry;
  }
  return Object.values(Object.values(byFwType)[0] ?? {})[0] ?? null;
}

// ─── Listen helper ────────────────────────────────────────────────────────────

async function listenModule(
  transport: Pick<TFBusTransport, 'dequeue'>,
  addr: number | null,
  labelFn: (addr: number) => string,
  seconds: number,
): Promise<void> {
  process.stdout.write(`Listening to ${addr === null ? 'all modules' : `[${labelFn(addr)}]`} for ${seconds}s…\n`);
  const deadline = Date.now() + seconds * 1000;
  let lastTxType: number | null = null;
  let lastTxAddr: number | null = null;
  let pollCount = 0;
  const lastOutput = new Map<number, string>();

  while (Date.now() < deadline) {
    const rawFrame = await transport.dequeue();
    if (rawFrame === null || rawFrame.length < 4 || rawFrame[0] !== 0xAA) continue;

    if (addr !== null ? rawFrame[1] === addr : rawFrame[1] !== 0x00) {
      const txFrame = parseBusTxFrame(rawFrame);
      if (txFrame) {
        lastTxType = txFrame.type;
        if (addr === null) lastTxAddr = rawFrame[1];
      }
      continue;
    }

    if (rawFrame[1] !== 0x00 || lastTxType === null) continue;

    const sourceAddr = addr ?? lastTxAddr ?? 0;
    const sourceLabel = labelFn(sourceAddr);
    const rxFrame = parseRxFrame(rawFrame);
    if (!rxFrame) continue;

    if (lastTxType === 0x04) {
      const { records, raw } = parseStatusPoll(rxFrame.payload);
      if (records === null) {
        process.stdout.write(`[${timestamp()}] ${sourceLabel} raw: ${raw.toString('hex')}\n`);
      } else if (records.length > 0) {
        const decoded = records.map(record => decodeTlvRecord(record)).join(' | ');
        if (lastOutput.get(sourceAddr) !== decoded) {
          process.stdout.write(`[${timestamp()}] ${sourceLabel} ${decoded}\n`);
          lastOutput.set(sourceAddr, decoded);
          pollCount++;
        }
      }
    } else if (lastTxType === 0xF9) {
      const version = parseVersionResponse(rxFrame.payload);
      process.stdout.write(`[${timestamp()}] ${sourceLabel} version: ${rxFrame.payload.toString('hex')}${version ? ` ${JSON.stringify(version)}` : ''}\n`);
    }

    lastTxType = null;
    if (addr === null) lastTxAddr = null;
  }

  process.stdout.write(`Done — ${pollCount} STATUS_POLL frame(s) in ${seconds}s.\n`);
}

function timestamp() { return new Date().toISOString().slice(11, 23); }

// ─── Bus load measurement ─────────────────────────────────────────────────────

async function measureBusLoad(
  transport: Pick<TFBusTransport, 'dequeue'>,
  seconds: number,
  baud: number,
): Promise<void> {
  process.stdout.write(`Measuring bus load for ${seconds}s @ ${baud} baud…\n`);
  const deadline = Date.now() + seconds * 1000;
  const start = Date.now();

  let totalFrames = 0;
  let totalBytes = 0;
  let txFrames = 0; // CLU→module (buf[1] !== 0x00)
  let rxFrames = 0; // module→CLU (buf[1] === 0x00)
  let txBytes = 0;
  let rxBytes = 0;

  while (Date.now() < deadline) {
    const rawFrame = await transport.dequeue();
    if (rawFrame === null || rawFrame.length < 4 || rawFrame[0] !== 0xAA) continue;
    totalFrames++;
    totalBytes += rawFrame.length;
    if (rawFrame[1] === 0x00) {
      rxFrames++;
      rxBytes += rawFrame.length;
    } else {
      txFrames++;
      txBytes += rawFrame.length;
    }
  }

  const elapsed = (Date.now() - start) / 1000;
  // RS485: 10 bits per byte (8 data + start + stop)
  const configuredCapacity = baud / 10;               // bytes/s at configured baud
  const observedBps = totalBytes / elapsed;           // actual bytes/s observed
  const effectiveBaud = observedBps * 10;             // derive actual baud from traffic
  const utilizationPct = observedBps / configuredCapacity * 100;

  process.stdout.write(
    `\n  elapsed:     ${elapsed.toFixed(1)}s\n` +
    `  frames:      ${totalFrames} (${(totalFrames / elapsed).toFixed(1)}/s)\n` +
    `    TX→module: ${txFrames} frames, ${txBytes} B\n` +
    `    RX→CLU:    ${rxFrames} frames, ${rxBytes} B\n` +
    `  total bytes: ${totalBytes} (${observedBps.toFixed(0)} B/s)\n` +
    `  configured:  ${baud} baud  (capacity ${configuredCapacity.toFixed(0)} B/s)\n` +
    `  effective:   ${effectiveBaud.toFixed(0)} baud  (utilisation ${utilizationPct.toFixed(1)}%)\n`,
  );
}

// ─── ON/OFF frame builder ─────────────────────────────────────────────────────

function buildOnOff(target: Target, turnOn: boolean): Buffer {
  const ioClass = target.ioInfo?.ioClass ?? CLASS_DIMM;
  const chanIdx = target.ioInfo?.chanIdx ?? 0;

  if (ioClass === CLASS_DOUT) {
    const mask = (1 << chanIdx) & 0xFF;
    return moduleCmdFrame(target.addr, [setOutputRecord(mask, turnOn ? 1 : 0)]);
  }
  if (turnOn) {
    return moduleCmdFrame(target.addr, [activateRecord(0x80)]);
  }
  return moduleCmdFrame(target.addr, [deactivateRecord(0x01)]);
}

// ─── TLV decoding (shared with monitor) ──────────────────────────────────────

function decodeTlvRecord(record: { type: number; meta: number; data: Buffer }): string {
  const typeName = TLV_NAMES[record.type] ?? `0x${record.type.toString(16).padStart(2, '0')}`;
  return `${typeName}: ${decodeValue(record.type, record.data)}`;
}

const TLV_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(TLVType).map(([typeName, typeValue]) => [typeValue as number, typeName]),
);

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
