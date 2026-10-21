import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
// @ts-ignore - JS files
import { CLUClient } from '../CLUClient.js';
// @ts-ignore
import { CLUDevice } from '../device/CLUDevice.js';
// @ts-ignore
import { CipherKey } from '../CipherKey.js';
// @ts-ignore
import { readAllObjects, readTFBusModules } from '../parsers/omp/OmpReader.js';
// @ts-ignore
import { InterfaceRegistry } from '../parsers/interfaces/InterfaceRegistry.js';
function textOf(node) {
    if (typeof node === 'string')
        return node;
    if (node && typeof node === 'object')
        return node['#text'] ?? '';
    return '';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTypeMap(ir) {
    const map = new Map();
    // from module firmware objects (DIMM, DOUT, ROLLER_SHUTTER, …)
    // Sort ascending by firmware version so the highest version wins (last-write).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const sortedModules = ir.allModules().slice().sort((a, b) => {
        const fwVer = (m) => {
            const fw = m['firmware'];
            return parseInt(fw?.['version'] ?? '0', 16);
        };
        return fwVer(a) - fwVer(b);
    });
    for (const mod of sortedModules) {
        const m = mod;
        const fw = m['firmware'];
        for (const obj of (fw?.['objects'] ?? [])) {
            const o = obj;
            const n = o['name'];
            if (n) {
                const iface = o['interface'];
                map.set(n, {
                    features: iface?.['features'] ?? [],
                    methods: iface?.['methods'] ?? [],
                });
            }
        }
    }
    // from standalone object XML files (Output, Input, Timer, …)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    for (const obj of ir.allObjects()) {
        const o = obj;
        const n = o['name'];
        if (n && !map.has(n)) {
            map.set(n, {
                features: o['features'] ?? [],
                methods: o['methods'] ?? [],
            });
        }
    }
    return map;
}
function buildIoResolutionMap(ompFile) {
    const map = new Map();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const modules = readTFBusModules(ompFile);
    for (const mod of modules) {
        for (const io of mod.ios) {
            map.set(io.name, { hwType: mod.hwType, fwType: mod.fwType, fwVer: mod.fwVer, ioClass: io.ioClass });
        }
    }
    return map;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveIface(ir, ioRes, typeMap, friendlyName, typeName) {
    const res = ioRes.get(friendlyName);
    if (res) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const mod = ir.getModule(res.hwType, res.fwType, res.fwVer);
        if (mod) {
            const fw = mod['firmware'];
            const objs = fw?.['objects'] ?? [];
            const match = objs.find(o => parseInt(o['class'] ?? '-1', 10) === res.ioClass);
            if (match) {
                const iface = match['interface'];
                return {
                    features: iface?.['features'] ?? [],
                    methods: iface?.['methods'] ?? [],
                };
            }
        }
    }
    return typeMap.get(typeName) ?? { features: [], methods: [] };
}
export async function runCluRepl(options) {
    const { ompFile, localAddress, cluPort } = options;
    const interfacesDir = resolve(options.interfacesDir ?? 'docs/device-interfaces');
    // ─── Load interface type registry ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const ir = InterfaceRegistry.fromDirectory(interfacesDir);
    const typeMap = buildTypeMap(ir);
    const ioResMap = buildIoResolutionMap(ompFile);
    // ─── Load all objects from OMP ─────────────────────────────────────────────
    // CLU hardware nodes are identified by ipAddress (only CLUs have it).
    // Device objects are identified by nameOnCLU + their clu.name back-reference.
    // name (friendly) = Lua script name; nameOnCLU = CLU internal Lua variable.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const allObjects = readAllObjects(ompFile);
    // ─── Project cipher key ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let projectCipherKey = null;
    try {
        const keysPath = resolve(dirname(ompFile), 'keys.json');
        const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
        if (keys.key && keys.iv) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            projectCipherKey = new CipherKey(Buffer.from(keys.key, 'base64'), Buffer.from(keys.iv, 'base64'));
        }
    }
    catch { /* no keys.json */ }
    if (!projectCipherKey) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const { readProjectCipherKey } = await import('../parsers/omp/OmpReader.js');
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            projectCipherKey = readProjectCipherKey(ompFile);
        }
        catch { /* no project key */ }
    }
    // ─── Group device objects by CLU (friendly name → ObjectEntry) ────────────
    const devicesByClu = new Map();
    for (const obj of allObjects.values()) {
        const nameOnClu = textOf(obj['nameOnCLU']);
        const friendlyName = textOf(obj['name']);
        const typeName = textOf(obj['type']);
        if (!nameOnClu || !friendlyName)
            continue;
        const cluRaw = obj['clu'];
        const cluName = cluRaw ? textOf(cluRaw['name']) : '';
        if (!cluName)
            continue;
        const iface = resolveIface(ir, ioResMap, typeMap, friendlyName, typeName);
        const entry = {
            friendlyName,
            nameOnClu,
            typeName,
            features: iface.features,
            methods: iface.methods,
        };
        if (!devicesByClu.has(cluName))
            devicesByClu.set(cluName, new Map());
        devicesByClu.get(cluName).set(friendlyName.toLowerCase(), entry);
    }
    // ─── Build CLU entry map ───────────────────────────────────────────────────
    const cluByName = new Map();
    for (const obj of allObjects.values()) {
        const ip = textOf(obj['ipAddress']);
        if (!ip)
            continue;
        const name = textOf(obj['name']);
        const serial = textOf(obj['serialNumber']);
        if (!name)
            continue;
        if (cluByName.has(name.toLowerCase()))
            continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cipherKey;
        if (obj['cipherKeyType'] === 'PROJECT_KEY' && projectCipherKey) {
            cipherKey = projectCipherKey;
        }
        else {
            const ivStr = textOf(obj['iv']);
            const pkStr = textOf(obj['privateKey']);
            if (ivStr && pkStr) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                cipherKey = CipherKey.getInitialCipherKey(Buffer.from(ivStr, 'base64'), Buffer.from(pkStr, 'base64'));
            }
            else {
                cipherKey = projectCipherKey;
            }
        }
        if (!cipherKey)
            continue;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const device = new CLUDevice({ address: ip, port: cluPort, serialNumber: parseInt(serial, 16) });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const client = new CLUClient(localAddress, device, cipherKey);
        cluByName.set(name.toLowerCase(), {
            name,
            serial,
            ipAddress: ip,
            client,
            objects: devicesByClu.get(name) ?? new Map(),
        });
    }
    const cluNames = [...cluByName.values()].map(c => c.name);
    function resolveClu(id) {
        return cluByName.get(id.toLowerCase()) ?? null;
    }
    function resolveObj(clu, objId) {
        return clu.objects.get(objId.toLowerCase()) ?? null;
    }
    // ─── Commands ─────────────────────────────────────────────────────────────
    function printHelp() {
        process.stdout.write([
            '',
            'Commands:',
            '  list                                  — list all CLUs',
            '  objects <clu>                         — list objects on CLU',
            '  info <clu> <object>                   — show object features & methods',
            '  get <clu> <object> [feature]          — get object value or specific feature',
            '  set <clu> <object> <feature> <value>  — set feature by name (Lua literal)',
            '  call <clu> <object> <method> [args…]  — call method by name',
            '  exec <clu> <script…>                  — execute arbitrary Lua script',
            '  help                                  — this text',
            '  exit / quit                           — exit',
            '',
        ].join('\n'));
    }
    async function dispatch(cmd, args, rawLine) {
        switch (cmd) {
            case 'list':
            case 'ls': {
                if (cluByName.size === 0) {
                    process.stdout.write('No CLUs found in OMP.\n');
                    return;
                }
                for (const c of cluByName.values()) {
                    process.stdout.write(`  ${c.name.padEnd(16)}  ip=${c.ipAddress.padEnd(15)}  serial=${c.serial}  objects=${c.objects.size}\n`);
                }
                break;
            }
            case 'objects': {
                const clu = resolveClu(args[0] ?? '');
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${args[0] ?? '(none)'}\n`);
                    return;
                }
                if (clu.objects.size === 0) {
                    process.stdout.write('No objects found.\n');
                    return;
                }
                const names = [...clu.objects.values()].map(o => o.friendlyName);
                process.stdout.write(names.join('  ') + '\n');
                break;
            }
            case 'info': {
                const clu = resolveClu(args[0] ?? '');
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${args[0] ?? '(none)'}\n`);
                    return;
                }
                const obj = resolveObj(clu, args[1] ?? '');
                if (!obj) {
                    process.stdout.write(`Unknown object: ${args[1] ?? '(none)'}\n`);
                    return;
                }
                process.stdout.write(`  ${obj.friendlyName}  (${obj.typeName})  → ${obj.nameOnClu}\n`);
                if (obj.features.length) {
                    process.stdout.write('  features:\n');
                    for (const f of obj.features) {
                        const access = (f.get ? 'r' : '') + (f.set ? 'w' : '');
                        process.stdout.write(`    [${f.index}] ${f.name.padEnd(28)} ${access}\n`);
                    }
                }
                if (obj.methods.length) {
                    process.stdout.write('  methods:\n');
                    for (const m of obj.methods) {
                        const params = m.params.map(p => p.name).join(', ');
                        process.stdout.write(`    [${m.index}] ${m.name}(${params})\n`);
                    }
                }
                break;
            }
            case 'get': {
                const clu = resolveClu(args[0] ?? '');
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${args[0] ?? '(none)'}\n`);
                    return;
                }
                const obj = resolveObj(clu, args[1] ?? '');
                if (!obj) {
                    process.stdout.write(`Unknown object: ${args[1] ?? '(none)'}\n`);
                    return;
                }
                const featureName = args[2];
                let script;
                if (featureName) {
                    const feat = obj.features.find(f => f.name.toLowerCase() === featureName.toLowerCase());
                    if (!feat) {
                        const avail = obj.features.filter(f => f.get).map(f => f.name).join(', ');
                        process.stdout.write(`Unknown feature: ${featureName}. Readable: ${avail || '(none)'}\n`);
                        return;
                    }
                    if (!feat.get) {
                        process.stdout.write(`Feature ${feat.name} is write-only.\n`);
                        return;
                    }
                    script = `${obj.nameOnClu}:get(${feat.index})`;
                }
                else {
                    script = `${obj.nameOnClu}:get()`;
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const result = await clu.client.execute(script);
                process.stdout.write(`  => ${result ?? 'nil'}\n`);
                break;
            }
            case 'set': {
                const clu = resolveClu(args[0] ?? '');
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${args[0] ?? '(none)'}\n`);
                    return;
                }
                const obj = resolveObj(clu, args[1] ?? '');
                if (!obj) {
                    process.stdout.write(`Unknown object: ${args[1] ?? '(none)'}\n`);
                    return;
                }
                const featureName = args[2];
                const rawValue = args[3];
                if (!featureName || rawValue === undefined) {
                    process.stdout.write('Usage: set <clu> <object> <feature> <value>\n');
                    return;
                }
                const feat = obj.features.find(f => f.name.toLowerCase() === featureName.toLowerCase());
                if (!feat) {
                    const avail = obj.features.filter(f => f.set).map(f => f.name).join(', ');
                    process.stdout.write(`Unknown feature: ${featureName}. Settable: ${avail || '(none)'}\n`);
                    return;
                }
                if (!feat.set) {
                    process.stdout.write(`Feature ${feat.name} is read-only.\n`);
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const result = await clu.client.execute(`${obj.nameOnClu}:set(${feat.index}, ${rawValue})`);
                process.stdout.write(`  => ${result ?? 'nil'}\n`);
                break;
            }
            case 'call': {
                const clu = resolveClu(args[0] ?? '');
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${args[0] ?? '(none)'}\n`);
                    return;
                }
                const obj = resolveObj(clu, args[1] ?? '');
                if (!obj) {
                    process.stdout.write(`Unknown object: ${args[1] ?? '(none)'}\n`);
                    return;
                }
                const methodName = args[2];
                if (!methodName) {
                    process.stdout.write('Usage: call <clu> <object> <method> [args…]\n');
                    return;
                }
                const meth = obj.methods.find(m => m.name.toLowerCase() === methodName.toLowerCase());
                if (!meth) {
                    const avail = obj.methods.map(m => m.name).join(', ');
                    process.stdout.write(`Unknown method: ${methodName}. Available: ${avail || '(none)'}\n`);
                    return;
                }
                const params = args.slice(3).join(', ');
                const script = params
                    ? `${obj.nameOnClu}:execute(${meth.index}, ${params})`
                    : `${obj.nameOnClu}:execute(${meth.index})`;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const result = await clu.client.execute(script);
                process.stdout.write(`  => ${result ?? 'nil'}\n`);
                break;
            }
            case 'exec': {
                const cluId = args[0];
                if (!cluId) {
                    process.stdout.write('Usage: exec <clu> <script>\n');
                    return;
                }
                const clu = resolveClu(cluId);
                if (!clu) {
                    process.stdout.write(`Unknown CLU: ${cluId}\n`);
                    return;
                }
                const afterCmd = rawLine.slice(rawLine.toLowerCase().indexOf('exec') + 4).trimStart();
                const afterClu = afterCmd.slice(afterCmd.toLowerCase().indexOf(cluId.toLowerCase()) + cluId.length).trimStart();
                if (!afterClu) {
                    process.stdout.write('Usage: exec <clu> <script>\n');
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const result = await clu.client.execute(afterClu);
                process.stdout.write(`  => ${result ?? 'nil'}\n`);
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
    // ─── Readline + autocomplete ───────────────────────────────────────────────
    const COMMANDS = ['list', 'ls', 'objects', 'info', 'get', 'set', 'call', 'exec', 'help', 'exit', 'quit'];
    const CLU_CMDS = new Set(['objects', 'info', 'get', 'set', 'call', 'exec']);
    const OBJ_CMDS = new Set(['info', 'get', 'set', 'call']);
    const FEAT_CMDS = new Set(['get', 'set']);
    const METH_CMDS = new Set(['call']);
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
        // arg[1]: CLU name
        if (argIdx === 1 && CLU_CMDS.has(cmd)) {
            const hits = cluNames.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
            return [hits.length ? hits : cluNames, current];
        }
        // arg[2]: object friendly name
        if (argIdx === 2 && OBJ_CMDS.has(cmd)) {
            const clu = resolveClu(parts[1]);
            if (clu) {
                const names = [...clu.objects.values()].map(o => o.friendlyName);
                const hits = names.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
                return [hits.length ? hits : names, current];
            }
        }
        // arg[3]: feature name (for get/set) or method name (for call)
        if (argIdx === 3) {
            const clu = resolveClu(parts[1]);
            const obj = clu ? resolveObj(clu, parts[2]) : null;
            if (obj) {
                if (FEAT_CMDS.has(cmd)) {
                    const names = cmd === 'set'
                        ? obj.features.filter(f => f.set).map(f => f.name)
                        : obj.features.filter(f => f.get).map(f => f.name);
                    const hits = names.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
                    return [hits.length ? hits : names, current];
                }
                if (METH_CMDS.has(cmd)) {
                    const names = obj.methods.map(m => m.name);
                    const hits = names.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
                    return [hits.length ? hits : names, current];
                }
            }
        }
        return [[], current];
    }
    printHelp();
    process.stdout.write(`Loaded ${cluByName.size} CLU(s), ${typeMap.size} object type(s). Type 'list' to see CLUs.\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer });
    function prompt() {
        rl.question('clu> ', async (line) => {
            const trimmed = line.trim();
            const parts = trimmed.split(/\s+/);
            const cmd = parts[0]?.toLowerCase() ?? '';
            if (cmd === 'exit' || cmd === 'quit') {
                rl.close();
                return;
            }
            try {
                await dispatch(cmd, parts.slice(1), trimmed);
            }
            catch (err) {
                process.stdout.write(`error: ${err.message}\n`);
            }
            prompt();
        });
    }
    prompt();
    await new Promise((res) => rl.on('close', res));
}
