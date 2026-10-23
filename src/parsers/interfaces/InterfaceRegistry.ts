import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const HARDWARE_TYPE_LENGTH = 16;
const HARDWARE_VERSION_LENGTH = 16;
const FIRMWARE_TYPE_LENGTH = 8;
const FIRMWARE_VERSION_LENGTH = 4;

type XmlNode = Record<string, unknown>;

function hexPad(value: number | bigint, length: number): string {
  const hex = BigInt.asUintN(64, BigInt(value)).toString(16).toUpperCase();
  return hex.padStart(length, '0');
}

function createKey(hardwareType: number, hardwareVersion: number, firmwareType: number, firmwareVersion: number): string {
  return `${hexPad(hardwareType, HARDWARE_TYPE_LENGTH)}:${hexPad(hardwareVersion, HARDWARE_VERSION_LENGTH)}:${hexPad(firmwareType, FIRMWARE_TYPE_LENGTH)}:${hexPad(firmwareVersion, FIRMWARE_VERSION_LENGTH)}`;
}

function hexInt(hexStr: string): number {
  return parseInt(hexStr, 16);
}

function createCluKeyFromNode(clu: XmlNode): string {
  const hwType = hexInt((clu['@_hardwareType'] as string | undefined) ?? '0');
  const hwVer = hexInt((clu['@_hardwareVersion'] as string | undefined) ?? '0');
  const fwType = hexInt((clu['@_firmwareType'] as string | undefined) ?? '0');
  const fwVer = hexInt((clu['@_firmwareVersion'] as string | undefined) ?? '0');
  return createKey(hwType >>> 0, hwVer, fwType, fwVer);
}

function createCluKeyFromParsed(clu: ParsedClu): string {
  const hwType = hexInt(clu.hardwareType ?? '0');
  const hwVer = hexInt(clu.hardwareVersion ?? '0');
  const fwType = hexInt(clu.firmwareType ?? '0');
  const fwVer = hexInt(clu.firmwareVersion ?? '0');
  return createKey(hwType >>> 0, hwVer, fwType, fwVer);
}

function createModuleKeyFromParsed(module: ParsedModule): string {
  const typeId = hexInt(module.typeId ?? '0');
  const fwTypeId = hexInt(module.firmware?.typeId ?? '0');
  const fwVersion = parseInt(module.firmware?.version ?? '0', 16);
  return createModuleKey(typeId, fwTypeId, fwVersion);
}

function createCluKeyFromParams(hardwareType: number, hardwareVersion: number, firmwareType: number, firmwareVersion: number): string {
  return createKey(hardwareType >>> 0, hardwareVersion, firmwareType, firmwareVersion);
}

function createModuleKey(hardwareType: number, firmwareType: number, firmwareVersion: number): string {
  return 'MOD:' + createKey(hardwareType, 1, firmwareType, firmwareVersion);
}

function createModuleKeyFromNode(module: XmlNode): string {
  const typeId = hexInt((module['@_typeId'] as string | undefined) ?? '0');
  const firmware = module['firmware'] as XmlNode | undefined;
  const fwTypeId = hexInt((firmware?.['@_typeId'] as string | undefined) ?? '0');
  const fwVersion = parseInt((firmware?.['@_version'] as string | undefined) ?? '0', 16);
  return createModuleKey(typeId, fwTypeId, fwVersion);
}

function createObjectVersionKey(version: number | string): string {
  const v = typeof version === 'string' ? hexInt(version) : version;
  return hexPad(v, 2);
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
});

const ARRAY_TAGS = new Set([
  'feature', 'method', 'event', 'enum', 'param', 'hint',
  'option', 'CLUModuleVersionConstraint', 'TreeObject',
]);

function toArray(v: unknown): XmlNode[] {
  if (v == null) return [];
  return Array.isArray(v) ? v as XmlNode[] : [v as XmlNode];
}

export interface ParsedEnumValue {
  name: string;
  resKey?: string;
  value: number;
}

export interface ParsedFeature {
  name: string;
  type: string;
  unit?: string;
  default?: string;
  get: boolean;
  set: boolean;
  index: number;
  range?: string;
  resKey?: string;
  enumValues?: string[] | null;
  enums: ParsedEnumValue[];
}

export interface ParsedMethodParam {
  name: string;
  type: string;
  range?: string;
  unit?: string;
  default?: string;
}

export interface ParsedMethod {
  index: number;
  call: string;
  name: string;
  return?: string;
  unit?: string;
  resKey?: string;
  params: ParsedMethodParam[];
}

export interface ParsedEvent {
  address: number;
  name: string;
  resKey?: string;
}

export interface ParsedInterface {
  features: ParsedFeature[];
  methods: ParsedMethod[];
  events: ParsedEvent[];
}

export interface ParsedModuleObject {
  class: string;
  count?: string;
  name: string;
  type: string;
  interface: ParsedInterface;
}

export interface ParsedModule {
  name?: string;
  typeId?: string;
  firmware: {
    typeId?: string;
    version?: string;
    objects: ParsedModuleObject[];
  } | null;
}

export interface ParsedCluObject {
  maxInstances: number;
  name: string;
  version: number;
}

export interface ParsedClu {
  className: string;
  firmwareType?: string;
  firmwareVersion?: string;
  hardwareType?: string;
  hardwareVersion?: string;
  typeName?: string;
  interface: ParsedInterface;
  objects: ParsedCluObject[];
  modulesVersionConstraints: { type: string; version: number }[];
  options: { name: string; value: string }[];
}

export interface ParsedObject {
  class: string;
  name: string;
  version: string;
  className: string;
  features: ParsedFeature[];
  methods: ParsedMethod[];
  events: ParsedEvent[];
}

function parseFeature(f: XmlNode): ParsedFeature {
  const desc = f['desc'] as XmlNode | undefined;
  return {
    name: f['@_name'] as string,
    type: f['@_type'] as string,
    unit: f['@_unit'] as string | undefined,
    default: f['@_default'] as string | undefined,
    get: f['@_get'] === 'true',
    set: f['@_set'] === 'true',
    index: f['@_index'] != null ? parseInt(f['@_index'] as string, 10) : 0,
    range: f['@_range'] as string | undefined,
    resKey: desc?.['@_resKey'] as string | undefined,
    enumValues: f['@_enum'] ? (f['@_enum'] as string).split(',') : null,
    enums: toArray(f['enum']).map(e => ({
      name: e['@_name'] as string,
      resKey: e['@_resKey'] as string | undefined,
      value: parseInt((e['@_value'] as string | undefined) ?? '0', 10),
    })),
  };
}

function parseMethod(m: XmlNode): ParsedMethod {
  const desc = m['desc'] as XmlNode | undefined;
  return {
    index: parseInt((m['@_index'] as string | undefined) ?? '0', 10),
    call: m['@_call'] as string,
    name: m['@_name'] as string,
    return: m['@_return'] as string | undefined,
    unit: m['@_unit'] as string | undefined,
    resKey: desc?.['@_resKey'] as string | undefined,
    params: toArray(m['param']).map(p => ({
      name: p['@_name'] as string,
      type: p['@_type'] as string,
      range: p['@_range'] as string | undefined,
      unit: p['@_unit'] as string | undefined,
      default: p['@_default'] as string | undefined,
    })),
  };
}

function parseEvent(e: XmlNode): ParsedEvent {
  const desc = e['desc'] as XmlNode | undefined;
  return {
    address: e['@_address'] != null ? parseInt(e['@_address'] as string, 10) : 0,
    name: e['@_name'] as string,
    resKey: desc?.['@_resKey'] as string | undefined,
  };
}

function parseInterface(iface: XmlNode | undefined): ParsedInterface {
  if (!iface) return { features: [], methods: [], events: [] };
  const features = iface['features'] as XmlNode | undefined;
  const methods = iface['methods'] as XmlNode | undefined;
  const events = iface['events'] as XmlNode | undefined;
  return {
    features: toArray(features?.['feature']).map(parseFeature),
    methods: toArray(methods?.['method']).map(parseMethod),
    events: toArray(events?.['event']).map(parseEvent),
  };
}

function parseCluXml(content: string): ParsedClu | null {
  const parsed = PARSER.parse(content) as XmlNode;
  const clu = (parsed['CLU'] ?? parsed['clu']) as XmlNode | undefined;
  if (!clu) return null;
  return {
    className: (clu['@_className'] as string | undefined) ?? 'CLU',
    firmwareType: clu['@_firmwareType'] as string | undefined,
    firmwareVersion: clu['@_firmwareVersion'] as string | undefined,
    hardwareType: clu['@_hardwareType'] as string | undefined,
    hardwareVersion: clu['@_hardwareVersion'] as string | undefined,
    typeName: clu['@_typeName'] as string | undefined,
    interface: parseInterface(clu['interface'] as XmlNode | undefined),
    objects: toArray((clu['objects'] as XmlNode | undefined)?.['object']).map(o => ({
      maxInstances: parseInt((o['@_maxInstances'] as string | undefined) ?? '0', 10),
      name: o['@_name'] as string,
      version: parseInt((o['@_version'] as string | undefined) ?? '0', 10),
    })),
    modulesVersionConstraints: toArray((clu['modulesVersionConstraints'] as XmlNode | undefined)?.['CLUModuleVersionConstraint']).map(c => ({
      type: c['@_type'] as string,
      version: parseInt((c['@_version'] as string | undefined) ?? '0', 10),
    })),
    options: toArray((clu['options'] as XmlNode | undefined)?.['option']).map(o => ({
      name: o['@_name'] as string,
      value: o['@_value'] as string,
    })),
  };
}

function parseModuleXml(content: string): ParsedModule | null {
  const parsed = PARSER.parse(content) as XmlNode;
  const m = (parsed['CLUModule'] ?? parsed['clumodule'] ?? parsed['module']) as XmlNode | undefined;
  if (!m) return null;
  const firmware = m['firmware'] as XmlNode | undefined;
  return {
    name: (m['@_name'] ?? m['name']) as string | undefined,
    typeId: (m['@_typeId'] ?? m['typeId']) as string | undefined,
    firmware: firmware ? {
      typeId: firmware['@_typeId'] as string | undefined,
      version: firmware['@_version'] as string | undefined,
      objects: toArray(firmware['object']).map(o => ({
        class: o['@_class'] as string,
        count: o['@_count'] as string | undefined,
        name: o['@_name'] as string,
        type: o['@_type'] as string,
        interface: parseInterface(o['interface'] as XmlNode | undefined),
      })),
    } : null,
  };
}

function parseObjectXml(content: string): ParsedObject | null {
  const parsed = PARSER.parse(content) as XmlNode;
  const obj = (parsed['object'] ?? parsed['CLUObject']) as XmlNode | undefined;
  if (!obj) return null;
  const classNameNode = obj['className'];
  const className = typeof classNameNode === 'string'
    ? classNameNode
    : ((classNameNode as XmlNode | undefined)?.['#text'] as string | undefined) ?? 'OBJECT';
  return {
    class: obj['@_class'] as string,
    name: obj['@_name'] as string,
    version: obj['@_version'] as string,
    className,
    features: toArray((obj['features'] as XmlNode | undefined)?.['feature']).map(parseFeature),
    methods: toArray((obj['methods'] as XmlNode | undefined)?.['method']).map(parseMethod),
    events: toArray((obj['events'] as XmlNode | undefined)?.['event']).map(parseEvent),
  };
}

export { parseModuleXml, parseCluXml, parseObjectXml };

export class InterfaceRegistry {
  #clus = new Map<string, ParsedClu>();
  #modules = new Map<string, ParsedModule>();
  #objects = new Map<string, Map<string, ParsedObject>>();

  static get EMPTY(): InterfaceRegistry {
    return new InterfaceRegistry();
  }

  static fromDirectory(dirPath: string): InterfaceRegistry {
    const registry = new InterfaceRegistry();
    const entries = readdirSync(dirPath);
    for (const fileName of entries) {
      const filePath = join(dirPath, fileName);
      registry.#loadFile(fileName, () => readFileSync(filePath, 'utf8'));
    }
    return registry;
  }

  static fromZip(zipPath: string): InterfaceRegistry {
    const registry = new InterfaceRegistry();
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      const fileName = basename(entry.entryName);
      registry.#loadFile(fileName, () => entry.getData().toString('utf8'));
    }
    return registry;
  }

  #loadFile(fileName: string, getContent: () => string): void {
    if (fileName.startsWith('clu_')) {
      try {
        const clu = parseCluXml(getContent());
        if (clu) {
          const key = createCluKeyFromParsed(clu);
          this.#clus.set(key, clu);
        }
      } catch { /* skip bad files */ }
    } else if (fileName.startsWith('module_')) {
      try {
        const module = parseModuleXml(getContent());
        if (module) {
          const key = createModuleKeyFromParsed(module);
          this.#modules.set(key, module);
        }
      } catch { /* skip bad files */ }
    } else if (fileName.startsWith('object_')) {
      try {
        const obj = parseObjectXml(getContent());
        if (obj) {
          const name = obj.name;
          const version = createObjectVersionKey(obj.version);
          if (!this.#objects.has(name)) this.#objects.set(name, new Map());
          this.#objects.get(name)!.set(version, obj);
        }
      } catch { /* skip bad files */ }
    }
  }

  getCLU(hardwareType: number, hardwareVersion: number, firmwareType: number, firmwareVersion: number): ParsedClu | null {
    const key = createCluKeyFromParams(hardwareType, hardwareVersion, firmwareType, firmwareVersion);
    return this.#clus.get(key) ?? null;
  }

  getModule(hardwareType: number, firmwareType: number, firmwareVersion: number): ParsedModule | null {
    const key = createModuleKey(hardwareType, firmwareType, firmwareVersion);
    return this.#modules.get(key) ?? null;
  }

  getObject(name: string, version: number | string): ParsedObject | null {
    const vKey = createObjectVersionKey(version);
    return this.#objects.get(name)?.get(vKey) ?? null;
  }

  allModules(): ParsedModule[] { return [...this.#modules.values()]; }
  allCLUs(): ParsedClu[] { return [...this.#clus.values()]; }
  allObjects(): ParsedObject[] {
    const result: ParsedObject[] = [];
    for (const versions of this.#objects.values()) {
      for (const obj of versions.values()) result.push(obj);
    }
    return result;
  }

  get cluCount(): number { return this.#clus.size; }
  get moduleCount(): number { return this.#modules.size; }
  get objectCount(): number {
    let n = 0;
    for (const v of this.#objects.values()) n += v.size;
    return n;
  }
}
