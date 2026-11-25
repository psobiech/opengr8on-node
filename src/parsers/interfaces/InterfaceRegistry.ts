import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const HARDWARE_TYPE_LENGTH = 16;
const HARDWARE_VERSION_LENGTH = 16;
const FIRMWARE_TYPE_LENGTH = 8;
const FIRMWARE_VERSION_LENGTH = 4;

type XmlNode = Record<string, unknown>;

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
  /** XML `set` attribute: fixed argument OM passes to execute(index, …), e.g. the LED command of LedSwitchOn */
  fixedArgument?: string;
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
    const versionKey = createObjectVersionKey(version);
    return this.#objects.get(name)?.get(versionKey) ?? null;
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
    let count = 0;
    for (const versions of this.#objects.values()) count += versions.size;
    return count;
  }
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
    objects: toArray((clu['objects'] as XmlNode | undefined)?.['object']).map(objectNode => ({
      maxInstances: parseInt((objectNode['@_maxInstances'] as string | undefined) ?? '0', 10),
      name: objectNode['@_name'] as string,
      version: parseInt((objectNode['@_version'] as string | undefined) ?? '0', 10),
    })),
    modulesVersionConstraints: toArray((clu['modulesVersionConstraints'] as XmlNode | undefined)?.['CLUModuleVersionConstraint']).map(constraintNode => ({
      type: constraintNode['@_type'] as string,
      version: parseInt((constraintNode['@_version'] as string | undefined) ?? '0', 10),
    })),
    options: toArray((clu['options'] as XmlNode | undefined)?.['option']).map(optionNode => ({
      name: optionNode['@_name'] as string,
      value: optionNode['@_value'] as string,
    })),
  };
}

function parseModuleXml(content: string): ParsedModule | null {
  const parsed = PARSER.parse(content) as XmlNode;
  const moduleNode = (parsed['CLUModule'] ?? parsed['clumodule'] ?? parsed['module']) as XmlNode | undefined;
  if (!moduleNode) return null;
  const firmware = moduleNode['firmware'] as XmlNode | undefined;
  return {
    name: (moduleNode['@_name'] ?? moduleNode['name']) as string | undefined,
    typeId: (moduleNode['@_typeId'] ?? moduleNode['typeId']) as string | undefined,
    firmware: firmware ? {
      typeId: firmware['@_typeId'] as string | undefined,
      version: firmware['@_version'] as string | undefined,
      objects: toArray(firmware['object']).map(objectNode => ({
        class: objectNode['@_class'] as string,
        count: objectNode['@_count'] as string | undefined,
        name: objectNode['@_name'] as string,
        type: objectNode['@_type'] as string,
        interface: parseInterface(objectNode['interface'] as XmlNode | undefined),
      })),
    } : null,
  };
}

function parseObjectXml(content: string): ParsedObject | null {
  const parsed = PARSER.parse(content) as XmlNode;
  const objectNode = (parsed['object'] ?? parsed['CLUObject']) as XmlNode | undefined;
  if (!objectNode) return null;
  // usually an attribute (<object class="120" className="GATE" ...>), sometimes a child element
  const classNameNode = objectNode['@_className'] ?? objectNode['className'];
  const className = typeof classNameNode === 'string'
    ? classNameNode
    : ((classNameNode as XmlNode | undefined)?.['#text'] as string | undefined) ?? 'OBJECT';
  return {
    class: objectNode['@_class'] as string,
    name: objectNode['@_name'] as string,
    version: objectNode['@_version'] as string,
    className,
    features: toArray((objectNode['features'] as XmlNode | undefined)?.['feature']).map(parseFeature),
    methods: toArray((objectNode['methods'] as XmlNode | undefined)?.['method']).map(parseMethod),
    events: toArray((objectNode['events'] as XmlNode | undefined)?.['event']).map(parseEvent),
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

function parseFeature(featureNode: XmlNode): ParsedFeature {
  const desc = featureNode['desc'] as XmlNode | undefined;
  return {
    name: featureNode['@_name'] as string,
    type: featureNode['@_type'] as string,
    unit: featureNode['@_unit'] as string | undefined,
    default: featureNode['@_default'] as string | undefined,
    get: featureNode['@_get'] === 'true',
    set: featureNode['@_set'] === 'true',
    index: featureNode['@_index'] != null ? parseInt(featureNode['@_index'] as string, 10) : 0,
    range: featureNode['@_range'] as string | undefined,
    resKey: desc?.['@_resKey'] as string | undefined,
    enumValues: featureNode['@_enum'] ? (featureNode['@_enum'] as string).split(',') : null,
    enums: toArray(featureNode['enum']).map(enumNode => ({
      name: enumNode['@_name'] as string,
      resKey: enumNode['@_resKey'] as string | undefined,
      value: parseInt((enumNode['@_value'] as string | undefined) ?? '0', 10),
    })),
  };
}

function parseMethod(methodNode: XmlNode): ParsedMethod {
  const desc = methodNode['desc'] as XmlNode | undefined;
  return {
    index: parseInt((methodNode['@_index'] as string | undefined) ?? '0', 10),
    call: methodNode['@_call'] as string,
    name: methodNode['@_name'] as string,
    return: methodNode['@_return'] as string | undefined,
    unit: methodNode['@_unit'] as string | undefined,
    resKey: desc?.['@_resKey'] as string | undefined,
    fixedArgument: methodNode['@_set'] as string | undefined,
    params: toArray(methodNode['param']).map(paramNode => ({
      name: paramNode['@_name'] as string,
      type: paramNode['@_type'] as string,
      range: paramNode['@_range'] as string | undefined,
      unit: paramNode['@_unit'] as string | undefined,
      default: paramNode['@_default'] as string | undefined,
    })),
  };
}

function parseEvent(eventNode: XmlNode): ParsedEvent {
  const desc = eventNode['desc'] as XmlNode | undefined;
  return {
    address: eventNode['@_address'] != null ? parseInt(eventNode['@_address'] as string, 10) : 0,
    name: eventNode['@_name'] as string,
    resKey: desc?.['@_resKey'] as string | undefined,
  };
}

function toArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  return Array.isArray(value) ? value as XmlNode[] : [value as XmlNode];
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

function createObjectVersionKey(version: number | string): string {
  const numericVersion = typeof version === 'string' ? hexInt(version) : version;
  return hexPad(numericVersion, 2);
}

function createKey(hardwareType: number, hardwareVersion: number, firmwareType: number, firmwareVersion: number): string {
  return `${hexPad(hardwareType, HARDWARE_TYPE_LENGTH)}:${hexPad(hardwareVersion, HARDWARE_VERSION_LENGTH)}:${hexPad(firmwareType, FIRMWARE_TYPE_LENGTH)}:${hexPad(firmwareVersion, FIRMWARE_VERSION_LENGTH)}`;
}

function hexInt(hexString: string): number {
  return parseInt(hexString, 16);
}

function hexPad(value: number | bigint, length: number): string {
  const hex = BigInt.asUintN(64, BigInt(value)).toString(16).toUpperCase();
  return hex.padStart(length, '0');
}
