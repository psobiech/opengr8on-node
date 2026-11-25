import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { readProjectClus, projectCluClient } from './project.js';
// @ts-ignore
import { readAllObjects, readTFBusModules } from '../parsers/omp/OmpReader.js';
import type { TFBusModuleInfo } from '../parsers/omp/OmpReader.js';
// @ts-ignore
import { InterfaceRegistry } from '../parsers/interfaces/InterfaceRegistry.js';

export interface CluReplOptions {
  ompFile: string;
  localAddress: string;
  cluPort?: number;
  /** Path to device-interfaces directory. Default: 'docs/device-interfaces' */
  interfacesDir?: string;
}

interface Feature { name: string; index: number; get: boolean; set: boolean; }
interface Method  {
  name: string;
  index: number;
  /** 'set' -> obj:set(index, value), 'execute' -> obj:execute(index, …) */
  call: string;
  /** Fixed argument from the interface XML (`set` attribute), used when the method takes none */
  fixedArgument?: string;
  params: Array<{ name: string }>;
}

interface ObjectEntry {
  /** OMP display name, used in Lua scripts (e.g. LAMPA_KUCHNIA) */
  friendlyName: string;
  /** CLU internal Lua variable (e.g. DIM1186) */
  nameOnClu: string;
  typeName: string;
  features: Feature[];
  methods: Method[];
}

interface CluEntry {
  name: string;
  serial: string;
  ipAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  /** keyed by friendlyName.toLowerCase() */
  objects: Map<string, ObjectEntry>;
}

type RawObj = Record<string, unknown>;

interface IoResEntry { hwType: number; fwType: number; fwVer: number; ioClass: number; }

export async function runCluRepl(options: CluReplOptions): Promise<void> {
  const { ompFile, localAddress, cluPort } = options;
  const interfacesDir = resolve(options.interfacesDir ?? 'docs/device-interfaces');

  // ─── Load interface type registry ─────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const interfaceRegistry = InterfaceRegistry.fromDirectory(interfacesDir) as unknown;
  const typeMap = buildTypeMap(interfaceRegistry);
  const ioResMap = buildIoResolutionMap(ompFile);

  // ─── Load all objects from OMP ─────────────────────────────────────────────
  // CLU hardware nodes are identified by ipAddress (only CLUs have it).
  // Device objects are identified by nameOnCLU + their clu.name back-reference.
  // name (friendly) = Lua script name; nameOnCLU = CLU internal Lua variable.

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const allObjects = readAllObjects(ompFile) as unknown as Map<unknown, RawObj>;

  // ─── Group device objects by CLU (friendly name → ObjectEntry) ────────────

  const devicesByClu = new Map<string, Map<string, ObjectEntry>>();

  for (const obj of allObjects.values()) {
    const nameOnClu   = textOf(obj['nameOnCLU']);
    const friendlyName = textOf(obj['name']);
    const typeName     = textOf(obj['type']);
    if (!nameOnClu || !friendlyName) continue;
    const cluRaw  = obj['clu'] as RawObj | null;
    const cluName = cluRaw ? textOf(cluRaw['name']) : '';
    if (!cluName) continue;

    const iface = resolveIface(interfaceRegistry, ioResMap, typeMap, friendlyName, typeName);
    const entry: ObjectEntry = {
      friendlyName,
      nameOnClu,
      typeName,
      features: iface.features,
      methods:  iface.methods,
    };

    if (!devicesByClu.has(cluName)) devicesByClu.set(cluName, new Map());
    devicesByClu.get(cluName)!.set(friendlyName.toLowerCase(), entry);
  }

  // ─── Build CLU entry map ───────────────────────────────────────────────────

  const cluByName = new Map<string, CluEntry>();

  for (const clu of readProjectClus(ompFile)) {
    cluByName.set(clu.name.toLowerCase(), {
      name: clu.name,
      serial: clu.serial,
      ipAddress: clu.ipAddress,
      client: projectCluClient(clu, localAddress, cluPort),
      objects: devicesByClu.get(clu.name) ?? new Map(),
    });
  }

  const cluNames = [...cluByName.values()].map(clu => clu.name);

  const PLAIN_CMDS = ['list', 'ls', 'exec', 'help', 'exit', 'quit'];

  printHelp();
  process.stdout.write(`Loaded ${cluByName.size} CLU(s), ${typeMap.size} object type(s). Type 'list' to see CLUs.\n`);

  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer });

  prompt();
  await new Promise<void>((resolvePromise) => readline.on('close', resolvePromise));

  function prompt() {
    readline.question('clu> ', async (line) => {
      const trimmed = line.trim();
      const command = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (command === 'exit' || command === 'quit') {
        readline.close();
        return;
      }
      try {
        await dispatch(trimmed);
      } catch (error) {
        process.stdout.write(`error: ${(error as Error).message}\n`);
      }
      prompt();
    });
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  async function dispatch(rawLine: string): Promise<void> {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    // Plain commands
    const spaceIdx = trimmed.indexOf(' ');
    const firstWord = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();

    if (firstWord === 'list' || firstWord === 'ls') {
      if (cluByName.size === 0) { process.stdout.write('No CLUs found in OMP.\n'); return; }
      for (const clu of cluByName.values()) {
        process.stdout.write(
          `  ${clu.name.padEnd(16)}  ip=${clu.ipAddress.padEnd(15)}  serial=${clu.serial}  objects=${clu.objects.size}\n`,
        );
      }
      return;
    }

    if (firstWord === 'exec') {
      const rest  = trimmed.slice(spaceIdx + 1).trimStart();
      const secondSpaceIdx = rest.indexOf(' ');
      const cluId = secondSpaceIdx === -1 ? rest : rest.slice(0, secondSpaceIdx);
      const clu   = resolveClu(cluId);
      if (!clu) { process.stdout.write(`Unknown CLU: ${cluId || '(none)'}\n`); return; }
      const script = secondSpaceIdx === -1 ? '' : rest.slice(secondSpaceIdx + 1).trimStart();
      if (!script) { process.stdout.write('Usage: exec <clu> <script>\n'); return; }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = await clu.client.execute(script) as string | null;
      process.stdout.write(`  => ${result ?? 'nil'}\n`);
      return;
    }

    if (firstWord === 'help') { printHelp(); return; }

    // Dot-notation: PART1.PART2[.PART3[...]]
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx !== -1) {
      const first = trimmed.slice(0, dotIdx);
      const rest  = trimmed.slice(dotIdx + 1);

      // Try first segment as CLU name
      const cluByFirst = resolveClu(first);
      if (cluByFirst) {
        // CLU.objects  or  CLU.OBJECT[.action(args)]
        if (rest.toLowerCase() === 'objects') {
          await dispatchDotExpr(cluByFirst, '', 'objects', []);
          return;
        }
        const secondDotIdx = rest.indexOf('.');
        if (secondDotIdx === -1) {
          // CLU.OBJECT — show info
          await dispatchDotExpr(cluByFirst, rest, 'info', []);
        } else {
          const objId      = rest.slice(0, secondDotIdx);
          const actionExpr = rest.slice(secondDotIdx + 1);
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
      if (obj) { printObjInfo(obj); return; }
    }

    process.stdout.write(`Unknown command: ${trimmed}. Type 'help' for usage.\n`);
  }

  async function dispatchDotExpr(clu: CluEntry, objId: string, action: string, actionArgs: string[]): Promise<void> {
    if (action === 'objects') {
      if (clu.objects.size === 0) { process.stdout.write('No objects found.\n'); return; }
      const names = [...clu.objects.values()].map(objectEntry => objectEntry.friendlyName);
      process.stdout.write(names.join('  ') + '\n');
      return;
    }

    const obj = resolveObj(clu, objId);
    if (!obj) { process.stdout.write(`Unknown object: ${objId}\n`); return; }

    if (action === 'info' || action === '') {
      printObjInfo(obj);
      return;
    }

    if (action === 'get') {
      const featureName = actionArgs[0];
      let script: string;
      if (featureName) {
        const feature = obj.features.find(candidate => candidate.name.toLowerCase() === featureName.toLowerCase());
        if (!feature) {
          const available = obj.features.filter(candidate => candidate.get).map(candidate => candidate.name).join(', ');
          process.stdout.write(`Unknown feature: ${featureName}. Readable: ${available || '(none)'}\n`);
          return;
        }
        if (!feature.get) { process.stdout.write(`Feature ${feature.name} is write-only.\n`); return; }
        script = `${obj.nameOnClu}:get(${feature.index})`;
      } else {
        script = `${obj.nameOnClu}:get()`;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = await clu.client.execute(script) as string | null;
      process.stdout.write(`  => ${result ?? 'nil'}\n`);
      return;
    }

    if (action === 'set') {
      const [featureName, ...valueArgs] = actionArgs;
      const rawValue = valueArgs.join(', ');
      if (!featureName || !rawValue) {
        process.stdout.write(`Usage: ${obj.friendlyName}.set(feature, value)\n`); return;
      }
      const feature = obj.features.find(candidate => candidate.name.toLowerCase() === featureName.toLowerCase());
      if (!feature) {
        const available = obj.features.filter(candidate => candidate.set).map(candidate => candidate.name).join(', ');
        process.stdout.write(`Unknown feature: ${featureName}. Settable: ${available || '(none)'}\n`);
        return;
      }
      if (!feature.set) { process.stdout.write(`Feature ${feature.name} is read-only.\n`); return; }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = await clu.client.execute(`${obj.nameOnClu}:set(${feature.index}, ${rawValue})`) as string | null;
      process.stdout.write(`  => ${result ?? 'nil'}\n`);
      return;
    }

    // Try as method name
    const method = obj.methods.find(candidate => candidate.name.toLowerCase() === action.toLowerCase());
    if (method) {
      const script = methodScript(obj.nameOnClu, method, actionArgs);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const result = await clu.client.execute(script) as string | null;
      process.stdout.write(`  => ${result ?? 'nil'}\n`);
      return;
    }

    const availMethods = obj.methods.map(candidate => candidate.name).join(', ');
    process.stdout.write(`Unknown action: ${action}. Methods: ${availMethods || '(none)'}\n`);
  }

  function resolveObj(clu: CluEntry, objId: string): ObjectEntry | null {
    return clu.objects.get(objId.toLowerCase()) ?? null;
  }

  function printObjInfo(obj: ObjectEntry): void {
    process.stdout.write(`  ${obj.friendlyName}  (${obj.typeName})  → ${obj.nameOnClu}\n`);
    if (obj.features.length) {
      process.stdout.write('  features:\n');
      for (const feature of obj.features) {
        const access = (feature.get ? 'r' : '') + (feature.set ? 'w' : '');
        process.stdout.write(`    [${feature.index}] ${feature.name.padEnd(28)} ${access}\n`);
      }
    }
    if (obj.methods.length) {
      process.stdout.write('  methods:\n');
      for (const method of obj.methods) {
        const params = method.params.map(param => param.name).join(', ');
        process.stdout.write(`    [${method.index}] ${method.name}(${params})\n`);
      }
    }
  }

  function parseCallExpr(expr: string): { name: string; args: string[] } {
    const parenIdx = expr.indexOf('(');
    if (parenIdx === -1) return { name: expr.trim(), args: [] };
    const name    = expr.slice(0, parenIdx).trim();
    const argsStr = expr.slice(parenIdx + 1, expr.lastIndexOf(')')).trim();
    const args    = argsStr ? argsStr.split(',').map(argument => argument.trim()) : [];
    return { name, args };
  }

  function resolveClu(id: string): CluEntry | null {
    return cluByName.get(id.toLowerCase()) ?? null;
  }

  // ─── Readline + autocomplete ───────────────────────────────────────────────

  function completer(line: string): [string[], string] {
    const dotIdx = line.lastIndexOf('.');

    if (dotIdx !== -1) {
      const prefix  = line.slice(0, dotIdx);
      const current = line.slice(dotIdx + 1);
      const segments = prefix.split('.');

      if (segments.length === 1) {
        // Could be CLU.? or OBJECT.? (single CLU)
        const cluByFirst = resolveClu(segments[0]);
        if (cluByFirst) {
          const objNames = [...cluByFirst.objects.values()].map(objectEntry => objectEntry.friendlyName);
          const suggestions = ['objects', ...objNames];
          const hits = suggestions.filter(name => name.toLowerCase().startsWith(current.toLowerCase()));
          const full = (hits.length ? hits : suggestions).map(name => prefix + '.' + name);
          return [full, line];
        }
        if (cluByName.size === 1) {
          const onlyClu = [...cluByName.values()][0];
          const obj = resolveObj(onlyClu, segments[0]);
          if (obj) {
            const actions = ['get(', 'set(', 'info', ...obj.methods.map(method => method.name + '(')];
            const hits = actions.filter(actionName => actionName.toLowerCase().startsWith(current.toLowerCase()));
            const full = (hits.length ? hits : actions).map(actionName => prefix + '.' + actionName);
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
            const actions = ['get(', 'set(', 'info', ...obj.methods.map(method => method.name + '(')];
            const hits = actions.filter(actionName => actionName.toLowerCase().startsWith(current.toLowerCase()));
            const full = (hits.length ? hits : actions).map(actionName => prefix + '.' + actionName);
            return [full, line];
          }
        }
      }

      return [[], line];
    }

    // No dot — suggest plain commands + CLU names (as CLU.) + object names (single CLU)
    const current = line;
    const cluSuggestions = cluNames.map(name => name + '.');
    const singleCluObjs  = cluByName.size === 1
      ? [...[...cluByName.values()][0].objects.values()].map(objectEntry => objectEntry.friendlyName + '.')
      : [];
    const all  = [...PLAIN_CMDS, ...cluSuggestions, ...singleCluObjs];
    const hits = all.filter(suggestion => suggestion.toLowerCase().startsWith(current.toLowerCase()));
    return [hits.length ? hits : all, current];
  }

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
    ].filter(line => line !== undefined).join('\n'));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTypeMap(interfaceRegistry: any): Map<string, { features: Feature[]; methods: Method[] }> {
  const map = new Map<string, { features: Feature[]; methods: Method[] }>();

  // from module firmware objects (DIMM, DOUT, ROLLER_SHUTTER, …)
  // Sort ascending by firmware version so the highest version wins (last-write).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const sortedModules = (interfaceRegistry.allModules() as unknown[]).slice().sort((left, right) => {
    const fwVer = (moduleDefinition: unknown) => {
      const firmware = (moduleDefinition as Record<string, unknown>)['firmware'] as Record<string, unknown> | null;
      return parseInt((firmware?.['version'] as string | undefined) ?? '0', 16);
    };
    return fwVer(left) - fwVer(right);
  });
  for (const moduleDefinition of sortedModules) {
    const moduleRecord = moduleDefinition as Record<string, unknown>;
    const firmware = moduleRecord['firmware'] as Record<string, unknown> | null;
    for (const obj of (firmware?.['objects'] as unknown[] ?? [])) {
      const objectRecord = obj as Record<string, unknown>;
      const objectName = objectRecord['name'] as string | undefined;
      if (objectName) {
        const iface = objectRecord['interface'] as Record<string, unknown> | undefined;
        map.set(objectName, {
          features: (iface?.['features'] as Feature[] | undefined) ?? [],
          methods:  (iface?.['methods']  as Method[]  | undefined) ?? [],
        });
      }
    }
  }

  // from standalone object XML files (Output, Input, Timer, …)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  for (const obj of (interfaceRegistry.allObjects() as unknown[])) {
    const objectRecord = obj as Record<string, unknown>;
    const objectName = objectRecord['name'] as string | undefined;
    if (objectName && !map.has(objectName)) {
      map.set(objectName, {
        features: (objectRecord['features'] as Feature[] | undefined) ?? [],
        methods:  (objectRecord['methods']  as Method[]  | undefined) ?? [],
      });
    }
  }

  return map;
}

function buildIoResolutionMap(ompFile: string): Map<string, IoResEntry> {
  const map = new Map<string, IoResEntry>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const modules = readTFBusModules(ompFile) as TFBusModuleInfo[];
  for (const moduleInfo of modules) {
    for (const ioInfo of moduleInfo.ios) {
      map.set(ioInfo.name, { hwType: moduleInfo.hwType, fwType: moduleInfo.fwType, fwVer: moduleInfo.fwVer, ioClass: ioInfo.ioClass });
    }
  }
  return map;
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') return (node as Record<string, string>)['#text'] ?? '';
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveIface(interfaceRegistry: any, ioRes: Map<string, IoResEntry>, typeMap: Map<string, { features: Feature[]; methods: Method[] }>, friendlyName: string, typeName: string): { features: Feature[]; methods: Method[] } {
  const ioResolution = ioRes.get(friendlyName);
  if (ioResolution) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const moduleDefinition = interfaceRegistry.getModule(ioResolution.hwType, ioResolution.fwType, ioResolution.fwVer) as Record<string, unknown> | null;
    if (moduleDefinition) {
      const firmware = moduleDefinition['firmware'] as Record<string, unknown> | null;
      const firmwareObjects = (firmware?.['objects'] as unknown[] | undefined) ?? [];
      const match = firmwareObjects.find(firmwareObject => parseInt((firmwareObject as Record<string, unknown>)['class'] as string ?? '-1', 10) === ioResolution.ioClass) as Record<string, unknown> | undefined;
      if (match) {
        const iface = match['interface'] as Record<string, unknown> | undefined;
        return {
          features: (iface?.['features'] as Feature[] | undefined) ?? [],
          methods:  (iface?.['methods']  as Method[]  | undefined) ?? [],
        };
      }
    }
  }
  return typeMap.get(typeName) ?? { features: [], methods: [] };
}

/**
 * Lua call of a method, as OM generates it: `call="set"` methods write their feature
 * (obj:set(index, value)); `call="execute"` methods without arguments pass the XML `set`
 * attribute (e.g. LedSwitchOn -> obj:execute(1, 2), 2 being the LED command).
 */
function methodScript(nameOnClu: string, method: Method, actionArgs: string[]): string {
  const callType = method.call === 'set' ? 'set' : 'execute';
  const args = actionArgs.length ? actionArgs : method.fixedArgument != null ? [method.fixedArgument] : [];
  return `${nameOnClu}:${callType}(${[String(method.index), ...args].join(', ')})`;
}
