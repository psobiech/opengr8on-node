import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { moduleCmdFrame, activateRecord, deactivateRecord, dimmerSetValueRecord, setRampTimeRecord, setOutputRecord, setPositionRecord, statusPollFrame, versionQueryFrame, } from './TFBusCommands.js';
import { parseRxFrame, parseBusTxFrame } from './TFBusFrame.js';
import { parseStatusPoll, TLVType } from './StatusPollResponse.js';
import { parseVersionResponse } from './VersionQueryResponse.js';
import { transcribeModules } from '../parsers/interfaces/transcribeModules.js';
import { readTFBusModules } from '../parsers/omp/OmpReader.js';
// ─── IO class constants ───────────────────────────────────────────────────────
const CLASS_DOUT = 4;
const CLASS_DIMM = 5;
const CLASS_ROLLER_SHUTTER = 24;
// execute method index → frame builder
// DIMM indices from DIMMER_MOSFET_DIN XML: 0=HoldValue, 1=Switch, 2=SwitchOn, 3=SwitchOff
const EXEC_WIRE = {
    [CLASS_DIMM]: {
        0: (addr, _, p) => moduleCmdFrame(addr, p[0] ? [setRampTimeRecord(p[0]), activateRecord(0x80)] : [activateRecord(0x80)]),
        1: (addr, _, p) => moduleCmdFrame(addr, p[1] ? [setRampTimeRecord(p[1]), activateRecord(0x80)] : [activateRecord(0x80)]),
        2: (addr, _, p) => moduleCmdFrame(addr, p[1] ? [setRampTimeRecord(p[1]), activateRecord(0x80)] : [activateRecord(0x80)]),
        3: (addr, _, p) => moduleCmdFrame(addr, p[1] ? [setRampTimeRecord(p[1]), deactivateRecord(0x01)] : [deactivateRecord(0x01)]),
    },
    [CLASS_DOUT]: {
        0: (addr, ch, _) => moduleCmdFrame(addr, [setOutputRecord((1 << ch) & 0xFF, 1)]),
        1: (addr, ch, _) => moduleCmdFrame(addr, [setOutputRecord((1 << ch) & 0xFF, 1)]),
        2: (addr, ch, _) => moduleCmdFrame(addr, [setOutputRecord((1 << ch) & 0xFF, 0)]),
    },
    [CLASS_ROLLER_SHUTTER]: {
        0: (addr, ch, _) => moduleCmdFrame(addr, [setPositionRecord(0, ch, 100)]),
        1: (addr, ch, _) => moduleCmdFrame(addr, [setPositionRecord(0, ch, 0)]),
        2: (addr, _, __) => moduleCmdFrame(addr, [activateRecord(0x80)]),
        3: (addr, _, __) => moduleCmdFrame(addr, [deactivateRecord(0x01)]),
        4: (addr, _, __) => moduleCmdFrame(addr, [activateRecord(0x80)]),
        5: (addr, ch, _) => moduleCmdFrame(addr, [setPositionRecord(0, ch, 100)]),
        6: (addr, ch, _) => moduleCmdFrame(addr, [setPositionRecord(0, ch, 0)]),
    },
};
// get feature index → TLV type returned in STATUS_POLL response
const GET_WIRE = {
    [CLASS_DIMM]: {
        0: TLVType.STATE, // Value → STATE (0–1000 = 0–100%)
    },
    [CLASS_DOUT]: {
        0: TLVType.INPUT_BITMASK, // Output → INPUT_BITMASK
    },
    [CLASS_ROLLER_SHUTTER]: {
        0: TLVType.ROLLER_POSITION, // Position → ROLLER_POSITION
    },
};
// set feature index → frame builder; params[0] = value
// DIMM: 0=Value(dimmerSetValue), 1=RampTime(setRampTime)
const SET_WIRE = {
    [CLASS_DIMM]: {
        0: (addr, _, p) => moduleCmdFrame(addr, [dimmerSetValueRecord(p[0])]),
        1: (addr, _, p) => moduleCmdFrame(addr, [setRampTimeRecord(p[0])]),
    },
    [CLASS_DOUT]: {
        0: (addr, ch, p) => moduleCmdFrame(addr, [setOutputRecord((1 << ch) & 0xFF, p[0])]),
    },
    [CLASS_ROLLER_SHUTTER]: {
        0: (addr, ch, p) => moduleCmdFrame(addr, [setPositionRecord(0, ch, p[0])]),
    },
};
// ─── TLV decoding (shared with monitor) ──────────────────────────────────────
function decodeValue(type, data) {
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
            if (data.length >= 2)
                return `${(data.readUInt16LE(0) / 10).toFixed(1)}%`;
            return data[0] === 0 ? 'idle' : 'active';
        case TLVType.DIGITAL_STATE:
            return data[0] === 0 ? 'idle' : 'active';
        case TLVType.POLL_COUNTER:
            return String(data[0]);
        default:
            return data.toString('hex');
    }
}
const TLV_NAMES = Object.fromEntries(Object.entries(TLVType).map(([k, v]) => [v, k]));
function decodeTlvRecord(rec) {
    const typeName = TLV_NAMES[rec.type] ?? `0x${rec.type.toString(16).padStart(2, '0')}`;
    return `${typeName}: ${decodeValue(rec.type, rec.data)}`;
}
// ─── Transcript lookup ────────────────────────────────────────────────────────
function findByFields(transcript, hwType, fwVer) {
    const byFwType = transcript[hwType];
    if (!byFwType)
        return null;
    for (const byFwApiVer of Object.values(byFwType)) {
        const e = byFwApiVer[fwVer];
        if (e)
            return e;
    }
    return Object.values(Object.values(byFwType)[0] ?? {})[0] ?? null;
}
// ─── REPL ─────────────────────────────────────────────────────────────────────
export async function runRepl(transport, options = {}) {
    const { dir = resolve('docs/device-interfaces'), lang = 'pl', ompPath, cluSerial, rxTimeoutMs = 300, baud = 115200, } = options;
    const { output: transcript, errors } = transcribeModules(dir, { lang });
    for (const e of errors)
        process.stderr.write(`warn: ${e}\n`);
    // name (lower) → { module, io }
    const nameIndex = new Map();
    const addrIndex = new Map();
    let ompModules = [];
    if (ompPath) {
        try {
            ompModules = readTFBusModules(ompPath);
            if (cluSerial)
                ompModules = ompModules.filter(m => m.cluSerial === cluSerial);
            for (const m of ompModules) {
                const entry = findByFields(transcript, m.hwType, m.fwVer);
                addrIndex.set(m.addr, { module: m, entry });
                for (const io of m.ios) {
                    nameIndex.set(io.name.toLowerCase(), { module: m, io });
                }
            }
            process.stdout.write(`Loaded ${ompModules.length} module(s) from OMP.\n`);
        }
        catch (e) {
            process.stderr.write(`warn: OMP load failed: ${e.message}\n`);
        }
    }
    // Send txType to addr, wait for the module's response (buf[1] === 0x00, always CLU addr).
    // Syncs on RS485 TX echo first to skip stale queued frames; RS485 is sequential so the
    // first 0x00 frame after our echo is the module's reply to our query.
    async function rxAfterTx(addr, txType) {
        const deadline = Date.now() + rxTimeoutMs;
        let synced = false;
        while (Date.now() < deadline) {
            const buf = await transport.dequeue();
            if (buf === null || buf.length < 3 || buf[0] !== 0xAA)
                continue;
            if (!synced) {
                // Wait for our TX echo (dest=addr, type=txType)
                if (buf[1] === addr && buf[2] === txType)
                    synced = true;
                continue;
            }
            // After echo: first frame addressed to CLU (0x00) is the module's response
            if (buf[1] === 0x00)
                return buf;
        }
        return null;
    }
    async function showResponse(addr, txType) {
        const buf = await rxAfterTx(addr, txType);
        if (!buf) {
            process.stdout.write('  (no response)\n');
            return;
        }
        const frame = parseRxFrame(buf);
        if (!frame) {
            process.stdout.write(`  raw: ${buf.toString('hex')}\n`);
            return;
        }
        if (frame.payload.length === 0) {
            process.stdout.write('  (ack)\n');
            return;
        }
        const { records, raw } = parseStatusPoll(frame.payload);
        if (records === null) {
            process.stdout.write(`  raw: ${raw.toString('hex')}\n`);
        }
        else {
            for (const r of records)
                process.stdout.write(`  ${decodeTlvRecord(r)}\n`);
        }
    }
    function resolveTarget(arg) {
        if (!arg)
            return null;
        // numeric addr
        const n = arg.startsWith('0x') || arg.startsWith('0X')
            ? parseInt(arg.slice(2), 16)
            : /^\d+$/.test(arg) ? parseInt(arg, 10) : NaN;
        if (!isNaN(n)) {
            const hit = addrIndex.get(n);
            return { addr: n, io: null, entry: hit?.entry ?? null, label: `addr=${n}` };
        }
        // name lookup
        const hit = nameIndex.get(arg.toLowerCase());
        if (hit) {
            const { module: m, io } = hit;
            return { addr: m.addr, io, entry: addrIndex.get(m.addr)?.entry ?? null, label: io.name };
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
    const SERIAL_CMDS = new Set(['get', 'status', 'version', 'set', 'execute', 'exec', 'on', 'off', 'listen', 'busload']);
    async function dispatch(cmd, args) {
        const needsSerial = SERIAL_CMDS.has(cmd);
        if (needsSerial)
            await transport.open();
        try {
            switch (cmd) {
                case 'list':
                case 'ls': {
                    if (ompModules.length === 0) {
                        process.stdout.write('No modules loaded (provide --omp).\n');
                        return;
                    }
                    for (const m of ompModules) {
                        const entry = addrIndex.get(m.addr)?.entry ?? null;
                        const type = entry?.name ?? `hwType=0x${m.hwType.toString(16)}`;
                        const names = m.ioNames.slice(0, 3).join(', ') + (m.ioNames.length > 3 ? ` +${m.ioNames.length - 3}` : '');
                        process.stdout.write(`  addr=${String(m.addr).padStart(2, '0')}  ${type.padEnd(24)}  serial=${m.serialHex}  [${names}]\n`);
                    }
                    break;
                }
                case 'info': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    const hit = addrIndex.get(t.addr);
                    process.stdout.write(`addr=${t.addr}  label=${t.label}\n`);
                    if (hit) {
                        const m = hit.module;
                        process.stdout.write(`  serial=${m.serialHex}  hwType=0x${m.hwType.toString(16)}  fwType=${m.fwType}  fwVer=${m.fwVer}\n`);
                        for (const io of m.ios) {
                            process.stdout.write(`  io: ${io.name.padEnd(36)}  class=${io.ioClass}  chan=${io.chanIdx}\n`);
                        }
                    }
                    if (t.entry) {
                        process.stdout.write(`  type: ${t.entry.name}\n`);
                        for (const obj of Object.values(t.entry.objects)) {
                            process.stdout.write(`  [${obj.name}]\n`);
                            const feats = Object.values(obj.features).map(f => `${f.name}(${f.index})`).join('  ');
                            const meths = Object.values(obj.methods).map(m => `${m.name}(${m.index})`).join('  ');
                            if (feats)
                                process.stdout.write(`    features: ${feats}\n`);
                            if (meths)
                                process.stdout.write(`    methods:  ${meths}\n`);
                        }
                    }
                    break;
                }
                case 'get': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    transport.enqueue(statusPollFrame(t.addr));
                    const buf = await rxAfterTx(t.addr, 0x04);
                    if (!buf) {
                        process.stdout.write('No response.\n');
                        return;
                    }
                    const frame = parseRxFrame(buf);
                    if (!frame) {
                        process.stdout.write(`Bad frame: ${buf.toString('hex')}\n`);
                        return;
                    }
                    const { records, raw } = parseStatusPoll(frame.payload);
                    if (records === null) {
                        process.stdout.write(`raw: ${raw.toString('hex')}\n`);
                        return;
                    }
                    if (records.length === 0) {
                        process.stdout.write('Empty response.\n');
                        return;
                    }
                    const featureName = args[1];
                    if (!featureName) {
                        for (const r of records)
                            process.stdout.write(`  ${decodeTlvRecord(r)}\n`);
                        break;
                    }
                    const ioClass = t.io?.ioClass ?? CLASS_DIMM;
                    const obj = t.entry?.objects[ioClass];
                    const feature = obj ? Object.values(obj.features).find(f => f.name.toLowerCase() === featureName.toLowerCase()) : null;
                    if (!feature) {
                        const avail = obj ? Object.values(obj.features).filter(f => f.get).map(f => f.name).join(', ') : '(no transcript)';
                        process.stdout.write(`Unknown feature: ${featureName}. Readable: ${avail}\n`);
                        return;
                    }
                    if (!feature.get) {
                        process.stdout.write(`Feature ${feature.name} is write-only.\n`);
                        return;
                    }
                    const tlvType = GET_WIRE[ioClass]?.[feature.index];
                    if (tlvType === undefined) {
                        process.stdout.write(`No TLV mapping for ${feature.name} (class=${ioClass} idx=${feature.index}). All records:\n`);
                        for (const r of records)
                            process.stdout.write(`  ${decodeTlvRecord(r)}\n`);
                        break;
                    }
                    const match = records.find(r => r.type === tlvType);
                    if (!match) {
                        process.stdout.write(`  ${feature.name}: (not present in response)\n`);
                        break;
                    }
                    process.stdout.write(`  ${feature.name}: ${decodeValue(match.type, match.data)}\n`);
                    break;
                }
                case 'status': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    transport.enqueue(statusPollFrame(t.addr));
                    const buf = await rxAfterTx(t.addr, 0x04);
                    if (!buf) {
                        process.stdout.write('No response.\n');
                        return;
                    }
                    const frame = parseRxFrame(buf);
                    if (!frame) {
                        process.stdout.write(`Bad frame: ${buf.toString('hex')}\n`);
                        return;
                    }
                    const { records, raw } = parseStatusPoll(frame.payload);
                    if (records === null) {
                        process.stdout.write(`raw: ${raw.toString('hex')}\n`);
                        return;
                    }
                    if (records.length === 0) {
                        process.stdout.write('Empty response.\n');
                        return;
                    }
                    for (const r of records) {
                        process.stdout.write(`  ${decodeTlvRecord(r)}\n`);
                    }
                    break;
                }
                case 'version': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    transport.enqueue(versionQueryFrame(t.addr));
                    const buf = await rxAfterTx(t.addr, 0xF9);
                    if (!buf) {
                        process.stdout.write('No response.\n');
                        return;
                    }
                    const frame = parseRxFrame(buf);
                    if (!frame || frame.payload.length === 0) {
                        process.stdout.write('No version data.\n');
                        return;
                    }
                    const ver = parseVersionResponse(frame.payload);
                    process.stdout.write(`  raw: ${frame.payload.toString('hex')}\n`);
                    if (ver)
                        process.stdout.write(`  ${JSON.stringify(ver)}\n`);
                    break;
                }
                case 'set': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    const featureName = args[1];
                    const rawValue = args[2];
                    if (!featureName || rawValue === undefined) {
                        process.stdout.write('Usage: set <name|addr> <Feature> <value>\n');
                        return;
                    }
                    const value = Number(rawValue);
                    if (isNaN(value)) {
                        process.stdout.write(`Invalid value: ${rawValue}\n`);
                        return;
                    }
                    const ioClass = t.io?.ioClass ?? CLASS_DIMM;
                    const chanIdx = t.io?.chanIdx ?? 0;
                    const obj = t.entry?.objects[ioClass];
                    const feature = obj ? Object.values(obj.features).find(f => f.name.toLowerCase() === featureName.toLowerCase()) : null;
                    if (!feature) {
                        const avail = obj ? Object.values(obj.features).filter(f => f.set).map(f => f.name).join(', ') : '(no transcript)';
                        process.stdout.write(`Unknown feature: ${featureName}. Settable: ${avail}\n`);
                        return;
                    }
                    if (!feature.set) {
                        process.stdout.write(`Feature ${feature.name} is read-only.\n`);
                        return;
                    }
                    const fn = SET_WIRE[ioClass]?.[feature.index];
                    if (!fn) {
                        process.stdout.write(`No wire encoding for ${feature.name} (class=${ioClass} idx=${feature.index}).\n`);
                        return;
                    }
                    transport.enqueue(fn(t.addr, chanIdx, [value]));
                    process.stdout.write(`set ${feature.name}=${value} → addr=${t.addr} [${t.label}]\n`);
                    await showResponse(t.addr, 0xF0);
                    break;
                }
                case 'execute':
                case 'exec': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    const methodName = args[1];
                    if (!methodName) {
                        process.stdout.write('Usage: execute <name|addr> <Method> [param…]\n');
                        return;
                    }
                    const params = args.slice(2).map(Number);
                    const ioClass = t.io?.ioClass ?? CLASS_DIMM;
                    const chanIdx = t.io?.chanIdx ?? 0;
                    const obj = t.entry?.objects[ioClass];
                    const method = obj ? Object.values(obj.methods).find(m => m.name.toLowerCase() === methodName.toLowerCase()) : null;
                    if (!method) {
                        const avail = obj ? Object.values(obj.methods).map(m => `${m.name}(${m.params.map(p => p.name).join(',')})`).join(', ') : '(no transcript)';
                        process.stdout.write(`Unknown method: ${methodName}. Available: ${avail}\n`);
                        return;
                    }
                    const wire = method.call === 'set' ? SET_WIRE : EXEC_WIRE;
                    const fn = wire[ioClass]?.[method.index];
                    if (!fn) {
                        process.stdout.write(`No wire encoding for ${method.name} (class=${ioClass} idx=${method.index} call=${method.call}).\n`);
                        return;
                    }
                    transport.enqueue(fn(t.addr, chanIdx, params));
                    const paramStr = method.params.map((p, i) => `${p.name}=${params[i] ?? '?'}`).join(', ');
                    process.stdout.write(`execute ${method.name}(${paramStr}) → addr=${t.addr} [${t.label}]\n`);
                    await showResponse(t.addr, 0xF0);
                    break;
                }
                case 'listen': {
                    const firstIsSeconds = args[0] !== undefined && /^\d+$/.test(args[0]);
                    if (!args[0] || firstIsSeconds) {
                        const secs = firstIsSeconds ? Math.max(1, parseInt(args[0], 10)) : 5;
                        const globalLabel = (addr) => {
                            const hit = addrIndex.get(addr);
                            return hit ? (hit.module.ioNames[0] ?? hit.entry?.name ?? `addr=${addr}`) : `addr=${addr}`;
                        };
                        await listenModule(transport, null, globalLabel, secs);
                    }
                    else {
                        const t = resolveTarget(args[0]);
                        if (!t) {
                            process.stdout.write(`Unknown target: ${args[0]}\n`);
                            return;
                        }
                        const secs = Math.max(1, parseInt(args[1] ?? '5', 10));
                        await listenModule(transport, t.addr, () => t.label, secs);
                    }
                    break;
                }
                case 'busload': {
                    const secs = Math.max(1, parseInt(args[0] ?? '10', 10));
                    await measureBusLoad(transport, secs, baud);
                    break;
                }
                case 'on': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    transport.enqueue(buildOnOff(t, true));
                    process.stdout.write(`sent ON → addr=${t.addr} [${t.label}]\n`);
                    await showResponse(t.addr, 0xF0);
                    break;
                }
                case 'off': {
                    const t = resolveTarget(args[0]);
                    if (!t) {
                        process.stdout.write(`Unknown target: ${args[0]}\n`);
                        return;
                    }
                    transport.enqueue(buildOnOff(t, false));
                    process.stdout.write(`sent OFF → addr=${t.addr} [${t.label}]\n`);
                    await showResponse(t.addr, 0xF0);
                    break;
                }
                case 'help':
                    printHelp();
                    break;
                case '':
                    break;
                default:
                    process.stdout.write(`Unknown command: ${cmd}. Type 'help' for usage.\n`);
            }
        }
        finally {
            if (needsSerial)
                await transport.close();
        }
    }
    printHelp();
    const COMMANDS = ['list', 'ls', 'get', 'info', 'status', 'version', 'set', 'execute', 'exec', 'listen', 'busload', 'on', 'off', 'help', 'exit', 'quit'];
    const TARGET_CMDS = new Set(['get', 'info', 'status', 'version', 'set', 'execute', 'exec', 'listen', 'on', 'off']);
    function completer(line) {
        const parts = line.split(/\s+/);
        if (parts.length <= 1) {
            const prefix = parts[0] ?? '';
            const hits = COMMANDS.filter(c => c.startsWith(prefix));
            return [hits.length ? hits : COMMANDS, prefix];
        }
        const cmd = parts[0].toLowerCase();
        const argIdx = parts.length - 1;
        const current = parts[argIdx] ?? '';
        if (argIdx === 1 && TARGET_CMDS.has(cmd)) {
            const names = [...nameIndex.values()].map(v => v.io.name);
            const hits = names.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
            return [hits.length ? hits : names, current];
        }
        if (argIdx === 2 && (cmd === 'get' || cmd === 'set' || cmd === 'execute' || cmd === 'exec')) {
            const t = resolveTarget(parts[1]);
            if (t?.entry) {
                const ioClass = t.io?.ioClass ?? CLASS_DIMM;
                const obj = t.entry.objects[ioClass];
                if (obj) {
                    const candidates = cmd === 'get'
                        ? Object.values(obj.features).filter(f => f.get).map(f => f.name)
                        : cmd === 'set'
                            ? Object.values(obj.features).filter(f => f.set).map(f => f.name)
                            : Object.values(obj.methods).map(m => m.name);
                    const hits = candidates.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
                    return [hits.length ? hits : candidates, current];
                }
            }
        }
        return [[], current];
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer });
    function prompt() {
        rl.question('tfbus> ', async (line) => {
            const parts = line.trim().split(/\s+/);
            const cmd = parts[0]?.toLowerCase() ?? '';
            if (cmd === 'exit' || cmd === 'quit') {
                rl.close();
                return;
            }
            try {
                await dispatch(cmd, parts.slice(1));
            }
            catch (err) {
                process.stdout.write(`error: ${err.message}\n`);
            }
            prompt();
        });
    }
    prompt();
    await new Promise((resolve) => rl.on('close', resolve));
}
// ─── Listen helper ────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(11, 23); }
async function listenModule(transport, addr, labelFn, secs) {
    process.stdout.write(`Listening to ${addr === null ? 'all modules' : `[${labelFn(addr)}]`} for ${secs}s…\n`);
    const deadline = Date.now() + secs * 1000;
    let lastTxType = null;
    let lastTxAddr = null;
    let pollCount = 0;
    const lastOutput = new Map();
    while (Date.now() < deadline) {
        const buf = await transport.dequeue();
        if (buf === null || buf.length < 4 || buf[0] !== 0xAA)
            continue;
        if (addr !== null ? buf[1] === addr : buf[1] !== 0x00) {
            const txf = parseBusTxFrame(buf);
            if (txf) {
                lastTxType = txf.type;
                if (addr === null)
                    lastTxAddr = buf[1];
            }
            continue;
        }
        if (buf[1] !== 0x00 || lastTxType === null)
            continue;
        const srcAddr = addr ?? lastTxAddr ?? 0;
        const src = labelFn(srcAddr);
        const rxFrame = parseRxFrame(buf);
        if (!rxFrame)
            continue;
        if (lastTxType === 0x04) {
            const { records, raw } = parseStatusPoll(rxFrame.payload);
            if (records === null) {
                process.stdout.write(`[${ts()}] ${src} raw: ${raw.toString('hex')}\n`);
            }
            else if (records.length > 0) {
                const decoded = records.map(r => decodeTlvRecord(r)).join(' | ');
                if (lastOutput.get(srcAddr) !== decoded) {
                    process.stdout.write(`[${ts()}] ${src} ${decoded}\n`);
                    lastOutput.set(srcAddr, decoded);
                    pollCount++;
                }
            }
        }
        else if (lastTxType === 0xF9) {
            const ver = parseVersionResponse(rxFrame.payload);
            process.stdout.write(`[${ts()}] ${src} version: ${rxFrame.payload.toString('hex')}${ver ? ` ${JSON.stringify(ver)}` : ''}\n`);
        }
        lastTxType = null;
        if (addr === null)
            lastTxAddr = null;
    }
    process.stdout.write(`Done — ${pollCount} STATUS_POLL frame(s) in ${secs}s.\n`);
}
// ─── Bus load measurement ─────────────────────────────────────────────────────
async function measureBusLoad(transport, secs, baud) {
    process.stdout.write(`Measuring bus load for ${secs}s @ ${baud} baud…\n`);
    const deadline = Date.now() + secs * 1000;
    const start = Date.now();
    let totalFrames = 0;
    let totalBytes = 0;
    let txFrames = 0; // CLU→module (buf[1] !== 0x00)
    let rxFrames = 0; // module→CLU (buf[1] === 0x00)
    let txBytes = 0;
    let rxBytes = 0;
    while (Date.now() < deadline) {
        const buf = await transport.dequeue();
        if (buf === null || buf.length < 4 || buf[0] !== 0xAA)
            continue;
        totalFrames++;
        totalBytes += buf.length;
        if (buf[1] === 0x00) {
            rxFrames++;
            rxBytes += buf.length;
        }
        else {
            txFrames++;
            txBytes += buf.length;
        }
    }
    const elapsed = (Date.now() - start) / 1000;
    // RS485: 10 bits per byte (8 data + start + stop)
    const configuredCapacity = baud / 10; // bytes/s at configured baud
    const observedBps = totalBytes / elapsed; // actual bytes/s observed
    const effectiveBaud = observedBps * 10; // derive actual baud from traffic
    const utilPct = observedBps / configuredCapacity * 100;
    process.stdout.write(`\n  elapsed:     ${elapsed.toFixed(1)}s\n` +
        `  frames:      ${totalFrames} (${(totalFrames / elapsed).toFixed(1)}/s)\n` +
        `    TX→module: ${txFrames} frames, ${txBytes} B\n` +
        `    RX→CLU:    ${rxFrames} frames, ${rxBytes} B\n` +
        `  total bytes: ${totalBytes} (${observedBps.toFixed(0)} B/s)\n` +
        `  configured:  ${baud} baud  (capacity ${configuredCapacity.toFixed(0)} B/s)\n` +
        `  effective:   ${effectiveBaud.toFixed(0)} baud  (utilisation ${utilPct.toFixed(1)}%)\n`);
}
// ─── ON/OFF frame builder ─────────────────────────────────────────────────────
function buildOnOff(t, on) {
    const ioClass = t.io?.ioClass ?? CLASS_DIMM;
    const chanIdx = t.io?.chanIdx ?? 0;
    if (ioClass === CLASS_DOUT) {
        const mask = (1 << chanIdx) & 0xFF;
        return moduleCmdFrame(t.addr, [setOutputRecord(mask, on ? 1 : 0)]);
    }
    if (on) {
        return moduleCmdFrame(t.addr, [activateRecord(0x80)]);
    }
    return moduleCmdFrame(t.addr, [deactivateRecord(0x01)]);
}
