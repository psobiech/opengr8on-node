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
        const single = cluByName.size === 1;
        process.stdout.write([
            '',
            'Syntax:',
            single
                ? '  OBJECT                          — show object info'
                : '  CLU.objects                     — list objects on CLU',
            single
                ? '  OBJECT.get()                    — get all feature values'
                : '  CLU.OBJECT                      — show object info',
            single
                ? '  OBJECT.get(feature)             — get specific feature'
                : '  CLU.OBJECT.get()                — get all feature values',
            single
                ? '  OBJECT.set(feature, value)      — set feature (Lua literal value)'
                : '  CLU.OBJECT.get(feature)         — get specific feature',
            single
                ? '  OBJECT.method(args…)            — call method'
                : '  CLU.OBJECT.set(feature, value)  — set feature (Lua literal value)',
            single
                ? ''
                : '  CLU.OBJECT.method(args…)        — call method',
            '',
            'Commands:',
            '  list / ls                       — list all CLUs',
            '  exec <clu> <script…>            — execute arbitrary Lua script',
            '  help                            — this text',
            '  exit / quit                     — exit',
            '',
        ].filter(l => l !== undefined).join('\n'));
    }
    function parseCallExpr(expr) {
        const parenIdx = expr.indexOf('(');
        if (parenIdx === -1)
            return { name: expr.trim(), args: [] };
        const name = expr.slice(0, parenIdx).trim();
        const argsStr = expr.slice(parenIdx + 1, expr.lastIndexOf(')')).trim();
        const args = argsStr ? argsStr.split(',').map(s => s.trim()) : [];
        return { name, args };
    }
    function printObjInfo(obj) {
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
    }
    async function dispatchDotExpr(clu, objId, action, actionArgs) {
        if (action === 'objects') {
            if (clu.objects.size === 0) {
                process.stdout.write('No objects found.\n');
                return;
            }
            const names = [...clu.objects.values()].map(o => o.friendlyName);
            process.stdout.write(names.join('  ') + '\n');
            return;
        }
        const obj = resolveObj(clu, objId);
        if (!obj) {
            process.stdout.write(`Unknown object: ${objId}\n`);
            return;
        }
        if (action === 'info' || action === '') {
            printObjInfo(obj);
            return;
        }
        if (action === 'get') {
            const featureName = actionArgs[0];
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
            return;
        }
        if (action === 'set') {
            const [featureName, ...valueArgs] = actionArgs;
            const rawValue = valueArgs.join(', ');
            if (!featureName || !rawValue) {
                process.stdout.write(`Usage: ${obj.friendlyName}.set(feature, value)\n`);
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
            return;
        }
        // Try as method name
        const meth = obj.methods.find(m => m.name.toLowerCase() === action.toLowerCase());
        if (meth) {
            const params = actionArgs.join(', ');
            const script = params
                ? `${obj.nameOnClu}:execute(${meth.index}, ${params})`
                : `${obj.nameOnClu}:execute(${meth.index})`;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const result = await clu.client.execute(script);
            process.stdout.write(`  => ${result ?? 'nil'}\n`);
            return;
        }
        const availMethods = obj.methods.map(m => m.name).join(', ');
        process.stdout.write(`Unknown action: ${action}. Methods: ${availMethods || '(none)'}\n`);
    }
    async function dispatch(rawLine) {
        const trimmed = rawLine.trim();
        if (!trimmed)
            return;
        // Plain commands
        const spaceIdx = trimmed.indexOf(' ');
        const firstWord = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
        if (firstWord === 'list' || firstWord === 'ls') {
            if (cluByName.size === 0) {
                process.stdout.write('No CLUs found in OMP.\n');
                return;
            }
            for (const c of cluByName.values()) {
                process.stdout.write(`  ${c.name.padEnd(16)}  ip=${c.ipAddress.padEnd(15)}  serial=${c.serial}  objects=${c.objects.size}\n`);
            }
            return;
        }
        if (firstWord === 'exec') {
            const rest = trimmed.slice(spaceIdx + 1).trimStart();
            const sp2 = rest.indexOf(' ');
            const cluId = sp2 === -1 ? rest : rest.slice(0, sp2);
            const clu = resolveClu(cluId);
            if (!clu) {
                process.stdout.write(`Unknown CLU: ${cluId || '(none)'}\n`);
                return;
            }
            const script = sp2 === -1 ? '' : rest.slice(sp2 + 1).trimStart();
            if (!script) {
                process.stdout.write('Usage: exec <clu> <script>\n');
                return;
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const result = await clu.client.execute(script);
            process.stdout.write(`  => ${result ?? 'nil'}\n`);
            return;
        }
        if (firstWord === 'help') {
            printHelp();
            return;
        }
        // Dot-notation: PART1.PART2[.PART3[...]]
        const dotIdx = trimmed.indexOf('.');
        if (dotIdx !== -1) {
            const first = trimmed.slice(0, dotIdx);
            const rest = trimmed.slice(dotIdx + 1);
            // Try first segment as CLU name
            const cluByFirst = resolveClu(first);
            if (cluByFirst) {
                // CLU.objects  or  CLU.OBJECT[.action(args)]
                if (rest.toLowerCase() === 'objects') {
                    await dispatchDotExpr(cluByFirst, '', 'objects', []);
                    return;
                }
                const dot2 = rest.indexOf('.');
                if (dot2 === -1) {
                    // CLU.OBJECT — show info
                    await dispatchDotExpr(cluByFirst, rest, 'info', []);
                }
                else {
                    const objId = rest.slice(0, dot2);
                    const actionExpr = rest.slice(dot2 + 1);
                    const { name: action, args } = parseCallExpr(actionExpr);
                    await dispatchDotExpr(cluByFirst, objId, action, args);
                }
                return;
            }
            // Single-CLU shorthand: OBJECT.action(args)
            if (cluByName.size === 1) {
                const onlyClu = [...cluByName.values()][0];
                const { name: action, args } = parseCallExpr(rest);
                await dispatchDotExpr(onlyClu, first, action, args);
                return;
            }
            // Multi-CLU but first part not a CLU → check if it's an object shorthand with CLU prefix hint
            process.stdout.write(`Unknown CLU: ${first}. Available: ${cluNames.join(', ')}\n`);
            return;
        }
        // Single-CLU object shorthand: bare OBJECT name → info
        if (cluByName.size === 1) {
            const onlyClu = [...cluByName.values()][0];
            const obj = resolveObj(onlyClu, trimmed);
            if (obj) {
                printObjInfo(obj);
                return;
            }
        }
        process.stdout.write(`Unknown command: ${trimmed}. Type 'help' for usage.\n`);
    }
    // ─── Readline + autocomplete ───────────────────────────────────────────────
    const PLAIN_CMDS = ['list', 'ls', 'exec', 'help', 'exit', 'quit'];
    function completer(line) {
        const dotIdx = line.lastIndexOf('.');
        if (dotIdx !== -1) {
            const prefix = line.slice(0, dotIdx);
            const current = line.slice(dotIdx + 1);
            const segments = prefix.split('.');
            if (segments.length === 1) {
                // Could be CLU.? or OBJECT.? (single CLU)
                const cluByFirst = resolveClu(segments[0]);
                if (cluByFirst) {
                    const objNames = [...cluByFirst.objects.values()].map(o => o.friendlyName);
                    const suggestions = ['objects', ...objNames];
                    const hits = suggestions.filter(n => n.toLowerCase().startsWith(current.toLowerCase()));
                    const full = (hits.length ? hits : suggestions).map(n => prefix + '.' + n);
                    return [full, line];
                }
                if (cluByName.size === 1) {
                    const onlyClu = [...cluByName.values()][0];
                    const obj = resolveObj(onlyClu, segments[0]);
                    if (obj) {
                        const actions = ['get(', 'set(', 'info', ...obj.methods.map(m => m.name + '(')];
                        const hits = actions.filter(a => a.toLowerCase().startsWith(current.toLowerCase()));
                        const full = (hits.length ? hits : actions).map(a => prefix + '.' + a);
                        return [full, line];
                    }
                }
            }
            if (segments.length === 2) {
                // CLU.OBJECT.? — suggest actions
                const clu = resolveClu(segments[0]);
                if (clu) {
                    const obj = resolveObj(clu, segments[1]);
                    if (obj) {
                        const actions = ['get(', 'set(', 'info', ...obj.methods.map(m => m.name + '(')];
                        const hits = actions.filter(a => a.toLowerCase().startsWith(current.toLowerCase()));
                        const full = (hits.length ? hits : actions).map(a => prefix + '.' + a);
                        return [full, line];
                    }
                }
            }
            return [[], line];
        }
        // No dot — suggest plain commands + CLU names (as CLU.) + object names (single CLU)
        const current = line;
        const cluSuggestions = cluNames.map(n => n + '.');
        const singleCluObjs = cluByName.size === 1
            ? [...[...cluByName.values()][0].objects.values()].map(o => o.friendlyName + '.')
            : [];
        const all = [...PLAIN_CMDS, ...cluSuggestions, ...singleCluObjs];
        const hits = all.filter(s => s.toLowerCase().startsWith(current.toLowerCase()));
        return [hits.length ? hits : all, current];
    }
    printHelp();
    process.stdout.write(`Loaded ${cluByName.size} CLU(s), ${typeMap.size} object type(s). Type 'list' to see CLUs.\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer });
    function prompt() {
        rl.question('clu> ', async (line) => {
            const trimmed = line.trim();
            const cmd = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
            if (cmd === 'exit' || cmd === 'quit') {
                rl.close();
                return;
            }
            try {
                await dispatch(trimmed);
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
