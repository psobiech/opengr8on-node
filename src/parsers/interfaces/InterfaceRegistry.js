import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const HARDWARE_TYPE_LENGTH = 16;
const HARDWARE_VERSION_LENGTH = 16;
const FIRMWARE_TYPE_LENGTH = 8;
const FIRMWARE_VERSION_LENGTH = 4;

function hexPad(value, length) {
  const hex = BigInt.asUintN(64, BigInt(value)).toString(16).toUpperCase();
  return hex.padStart(length, '0');
}

function createKey(hardwareType, hardwareVersion, firmwareType, firmwareVersion) {
  return `${hexPad(hardwareType, HARDWARE_TYPE_LENGTH)}:${hexPad(hardwareVersion, HARDWARE_VERSION_LENGTH)}:${hexPad(firmwareType, FIRMWARE_TYPE_LENGTH)}:${hexPad(firmwareVersion, FIRMWARE_VERSION_LENGTH)}`;
}

function hexInt(hexStr) {
  return parseInt(hexStr, 16);
}

function createCluKeyFromNode(clu) {
  const hwType = hexInt(clu.hardwareType ?? '0');
  const hwVer = hexInt(clu.hardwareVersion ?? '0');
  const fwType = hexInt(clu.firmwareType ?? '0');
  const fwVer = hexInt(clu.firmwareVersion ?? '0');
  return createKey(hwType >>> 0, hwVer, fwType, fwVer);
}

function createCluKeyFromParams(hardwareType, hardwareVersion, firmwareType, firmwareVersion) {
  return createKey(hardwareType >>> 0, hardwareVersion, firmwareType, firmwareVersion);
}

function createModuleKey(hardwareType, firmwareType, firmwareVersion) {
  return 'MOD:' + createKey(hardwareType, 1, firmwareType, firmwareVersion);
}

function createModuleKeyFromNode(module) {
  const typeId = hexInt(module.typeId ?? '0');
  const fwTypeId = hexInt(module.firmware?.typeId ?? '0');
  const fwVersion = parseInt(module.firmware?.version ?? '0', 16);
  return createModuleKey(typeId, fwTypeId, fwVersion);
}

function createObjectVersionKey(version) {
  const v = typeof version === 'string' ? hexInt(version) : version;
  return hexPad(v, 2);
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const ARRAY_TAGS = new Set([
  'feature', 'method', 'event', 'enum', 'param', 'hint',
  'option', 'CLUModuleVersionConstraint', 'TreeObject',
]);

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseFeature(f) {
  return {
    name: f['@_name'],
    type: f['@_type'],
    unit: f['@_unit'],
    default: f['@_default'],
    get: f['@_get'] === 'true',
    set: f['@_set'] === 'true',
    index: f['@_index'] != null ? parseInt(f['@_index'], 10) : 0,
    range: f['@_range'],
    resKey: f.desc?.['@_resKey'],
    enumValues: f['@_enum'] ? f['@_enum'].split(',') : null,
    enums: toArray(f['enum']).map(e => ({
      name: e['@_name'],
      resKey: e['@_resKey'],
      value: parseInt(e['@_value'] ?? '0', 10),
    })),
  };
}

function parseMethod(m) {
  return {
    index: parseInt(m['@_index'] ?? '0', 10),
    call: m['@_call'],
    name: m['@_name'],
    return: m['@_return'],
    unit: m['@_unit'],
    resKey: m.desc?.['@_resKey'],
    params: toArray(m['param']).map(p => ({
      name: p['@_name'],
      type: p['@_type'],
      range: p['@_range'],
      unit: p['@_unit'],
      default: p['@_default'],
    })),
  };
}

function parseEvent(e) {
  return {
    address: e['@_address'] != null ? parseInt(e['@_address'], 10) : 0,
    name: e['@_name'],
    resKey: e.desc?.['@_resKey'],
  };
}

function parseInterface(iface) {
  if (!iface) return { features: [], methods: [], events: [] };
  return {
    features: toArray(iface.features?.feature).map(parseFeature),
    methods: toArray(iface.methods?.method).map(parseMethod),
    events: toArray(iface.events?.event).map(parseEvent),
  };
}

function parseCluXml(content) {
  const parsed = PARSER.parse(content);
  const clu = parsed['CLU'] ?? parsed['clu'];
  if (!clu) return null;
  return {
    className: clu['@_className'] ?? 'CLU',
    firmwareType: clu['@_firmwareType'],
    firmwareVersion: clu['@_firmwareVersion'],
    hardwareType: clu['@_hardwareType'],
    hardwareVersion: clu['@_hardwareVersion'],
    typeName: clu['@_typeName'],
    interface: parseInterface(clu.interface),
    objects: toArray(clu.objects?.object).map(o => ({
      maxInstances: parseInt(o['@_maxInstances'] ?? '0', 10),
      name: o['@_name'],
      version: parseInt(o['@_version'] ?? '0', 10),
    })),
    modulesVersionConstraints: toArray(clu.modulesVersionConstraints?.CLUModuleVersionConstraint).map(c => ({
      type: c['@_type'],
      version: parseInt(c['@_version'] ?? '0', 10),
    })),
    options: toArray(clu.options?.option).map(o => ({
      name: o['@_name'],
      value: o['@_value'],
    })),
  };
}

function parseModuleXml(content) {
  const parsed = PARSER.parse(content);
  const m = parsed['CLUModule'] ?? parsed['clumodule'] ?? parsed['module'];
  if (!m) return null;
  return {
    name: m['@_name'] ?? m.name,
    typeId: m['@_typeId'] ?? m.typeId,
    firmware: m.firmware ? {
      typeId: m.firmware['@_typeId'],
      version: m.firmware['@_version'],
      objects: toArray(m.firmware.object).map(o => ({
        class: o['@_class'],
        count: o['@_count'],
        name: o['@_name'],
        type: o['@_type'],
        interface: parseInterface(o.interface),
      })),
    } : null,
  };
}

function parseObjectXml(content) {
  const parsed = PARSER.parse(content);
  const obj = parsed['object'] ?? parsed['CLUObject'];
  if (!obj) return null;
  return {
    class: obj['@_class'],
    name: obj['@_name'],
    version: obj['@_version'],
    className: typeof obj.className === 'string' ? obj.className : (obj.className?.['#text'] ?? 'OBJECT'),
    features: toArray(obj.features?.feature).map(parseFeature),
    methods: toArray(obj.methods?.method).map(parseMethod),
    events: toArray(obj.events?.event).map(parseEvent),
  };
}

export { parseModuleXml, parseCluXml, parseObjectXml };

export class InterfaceRegistry {
  #clus = new Map();
  #modules = new Map();
  #objects = new Map();

  static get EMPTY() {
    return new InterfaceRegistry();
  }

  static fromDirectory(dirPath) {
    const registry = new InterfaceRegistry();
    const entries = readdirSync(dirPath);
    for (const fileName of entries) {
      const filePath = join(dirPath, fileName);
      registry.#loadFile(fileName, () => readFileSync(filePath, 'utf8'));
    }
    return registry;
  }

  static fromZip(zipPath) {
    const registry = new InterfaceRegistry();
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      const fileName = basename(entry.entryName);
      registry.#loadFile(fileName, () => entry.getData().toString('utf8'));
    }
    return registry;
  }

  #loadFile(fileName, getContent) {
    if (fileName.startsWith('clu_')) {
      try {
        const clu = parseCluXml(getContent());
        if (clu) {
          const key = createCluKeyFromNode(clu);
          this.#clus.set(key, clu);
        }
      } catch { /* skip bad files */ }
    } else if (fileName.startsWith('module_')) {
      try {
        const module = parseModuleXml(getContent());
        if (module) {
          const key = createModuleKeyFromNode(module);
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
          this.#objects.get(name).set(version, obj);
        }
      } catch { /* skip bad files */ }
    }
  }

  getCLU(hardwareType, hardwareVersion, firmwareType, firmwareVersion) {
    const key = createCluKeyFromParams(hardwareType, hardwareVersion, firmwareType, firmwareVersion);
    return this.#clus.get(key) ?? null;
  }

  getModule(hardwareType, firmwareType, firmwareVersion) {
    const key = createModuleKey(hardwareType, firmwareType, firmwareVersion);
    return this.#modules.get(key) ?? null;
  }

  getObject(name, version) {
    const vKey = createObjectVersionKey(version);
    return this.#objects.get(name)?.get(vKey) ?? null;
  }

  allModules() { return [...this.#modules.values()]; }
  allCLUs() { return [...this.#clus.values()]; }
  allObjects() {
    const result = [];
    for (const versions of this.#objects.values()) {
      for (const obj of versions.values()) result.push(obj);
    }
    return result;
  }

  get cluCount() { return this.#clus.size; }
  get moduleCount() { return this.#modules.size; }
  get objectCount() {
    let n = 0;
    for (const v of this.#objects.values()) n += v.size;
    return n;
  }
}
