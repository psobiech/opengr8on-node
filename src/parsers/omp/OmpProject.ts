import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';

/**
 * Object Manager project (.omp) reader for importers: CLUs with their features, events (OM action
 * strings), modules, IOs and scripts, as stored in system.xml. Values are kept as the raw strings
 * OM wrote (serials, hw/fw types, init values); interpreting them is up to the consumer.
 * XStream `id` / `reference` attributes are resolved, so shared nodes appear in full everywhere.
 */

const SYSTEM_XML = 'system.xml';
const PROJECT_FILE = '.project';
const PROPERTIES_FILE = 'properties.xml';

type XmlNode = Record<string, unknown>;

const ARRAY_TAGS = new Set(['TreeObject', 'Input', 'Output', 'EmbeddedFeature', 'Event', 'string', 'Script', 'InputOutputDefinition', 'HardwarePeripheryCLU']);

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
});

export interface OmpFeature {
  name: string;
  index: number;
  /** raw initValue as stored by OM; undefined when the element is absent */
  initValue?: string;
  defaultInitValue?: string;
  /** NUMBER, BOOLEAN, STRING, ... */
  paramType?: string;
  /** ALL, READ, WRITE, ... */
  accessType?: string;
}

export interface OmpEvent {
  name: string;
  index: number;
  /** OM action strings, e.g. `CLU_1->LAMP->Switch(0)` */
  commands: string[];
}

export interface OmpModule {
  /** raw moduleID (serial as stored by OM) */
  moduleID: string;
  moduleClass?: string;
  moduleInterface?: string;
  moduleTypeFirmware?: string;
  moduleVersion?: string;
  innerName?: string;
  active?: string;
}

export interface OmpIo {
  kind: 'Input' | 'Output';
  /** OM display name (NAME_IO) */
  name: string;
  /** object id on the CLU (e.g. DIM1186) */
  nameOnCLU: string;
  type?: string;
  number?: string;
  classTypeId?: string;
  active?: string;
  isRemoved?: string;
  tfBusOrder?: string;
  module?: OmpModule;
  features: OmpFeature[];
  events: OmpEvent[];
}

export interface OmpScript {
  name: string;
  parameters: string[];
  isManualEdit?: string;
  /** scripts/<CLU name>/<name>.lua from the archive, if present */
  source?: string;
}

/** Virtual object ("periphery": Timer, Thermostat, Scheduler, ...) of a CLU. */
export interface OmpPeriphery {
  /** OM display name (NAME_PERIPHERY) */
  name: string;
  /** object id on the CLU (e.g. TIM8908) */
  nameOnCLU: string;
  /** interface object name (Timer, Thermostat, ...) */
  typeName?: string;
  /** object class (OBJECT:new first argument) */
  typeId?: string;
  typeVersion?: string;
  isRemoved?: string;
  existsOnCLU?: string;
  features: OmpFeature[];
  events: OmpEvent[];
}

export interface OmpClu {
  name: string;
  nameOnCLU: string;
  serialNumber: string;
  macAddress?: string;
  ipAddress: string;
  hardwareType?: string;
  hardwareVersion?: string;
  firmwareType?: string;
  firmwareVersion?: string;
  cipherKeyType?: string;
  /** "true": the CLU is in OM's trash (deleted from the project tree, still stored in system.xml) */
  isRemoved?: string;
  features: OmpFeature[];
  events: OmpEvent[];
  modules: OmpModule[];
  ios: OmpIo[];
  /** virtual objects, in project order (incl. removed ones, see isRemoved) */
  periphery: OmpPeriphery[];
  scripts: OmpScript[];
}

export interface OmpProject {
  name: string;
  clus: OmpClu[];
  /**
   * Project network settings (properties.xml `gateway` / `netmask`, dotted IPv4). OM writes them into
   * every GATE's OM.LUA (`GATE:new(5000, ip, netmask, gateway, "", "")`). Only these two fields are
   * read from properties.xml (it also holds the project key, see readProjectCipherKey).
   */
  network: { gateway?: string; netmask?: string };
}

const toArray = (v: unknown): XmlNode[] => (v == null ? [] : Array.isArray(v) ? (v as XmlNode[]) : [v as XmlNode]);

function text(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in (node as XmlNode)) return String((node as XmlNode)['#text']);
  if (typeof node === 'object') return '';
  return undefined;
}

class Refs {
  private readonly byId = new Map<string, XmlNode>();
  constructor(root: unknown) {
    this.index(root);
  }
  private index(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) this.index(n);
      return;
    }
    const obj = node as XmlNode;
    if (obj['@_id'] != null) this.byId.set(String(obj['@_id']), obj);
    for (const v of Object.values(obj)) this.index(v);
  }
  resolve(node: unknown): XmlNode | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as XmlNode;
    return obj['@_reference'] != null ? this.byId.get(String(obj['@_reference'])) : obj;
  }
}

function features(list: unknown, refs: Refs): OmpFeature[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['EmbeddedFeature'])
    .map(f => refs.resolve(f))
    .filter((f): f is XmlNode => !!f)
    .map(f => {
      const type = refs.resolve(f['type']);
      return {
        name: text(f['name']) ?? '',
        index: Number(text(f['index']) ?? NaN),
        initValue: text(f['initValue']),
        defaultInitValue: text(f['defaultInitValue']),
        paramType: text(type?.['paramType']),
        accessType: text(f['accessType']),
      };
    });
}

function events(list: unknown, refs: Refs): OmpEvent[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['Event'])
    .map(e => refs.resolve(e))
    .filter((e): e is XmlNode => !!e)
    .map(e => ({
      name: text(e['name']) ?? '',
      index: Number(text(e['index']) ?? NaN),
      commands: toArray(refs.resolve(e['commands'])?.['string']).map(s => text(s) ?? ''),
    }));
}

function moduleOf(node: unknown, refs: Refs): OmpModule | undefined {
  const m = refs.resolve(node);
  if (!m) return undefined;
  return {
    moduleID: text(m['moduleID']) ?? '',
    moduleClass: text(m['moduleClass']),
    moduleInterface: text(m['moduleInterface']),
    moduleTypeFirmware: text(m['moduleTypeFirmware']),
    moduleVersion: text(m['moduleVersion']),
    innerName: text(m['innerName']),
    active: text(m['active']),
  };
}

function ios(list: unknown, refs: Refs): OmpIo[] {
  const holder = refs.resolve(list);
  if (!holder) return [];
  const out: OmpIo[] = [];
  // keep document order across Input/Output siblings: walk the raw keys in order of appearance
  const items: Array<{ kind: 'Input' | 'Output'; node: XmlNode; order: number }> = [];
  for (const kind of ['Input', 'Output'] as const) {
    for (const n of toArray(holder[kind])) {
      const r = refs.resolve(n);
      if (r) items.push({ kind, node: r, order: Number(r['@_id'] ?? NaN) });
    }
  }
  items.sort((a, b) => a.order - b.order); // XStream ids follow document order
  for (const { kind, node } of items) {
    out.push({
      kind,
      name: text(node['name']) ?? '',
      nameOnCLU: text(node['nameOnCLU']) ?? '',
      type: text(node['type']),
      number: text(node['number']),
      classTypeId: text(node['classTypeId']),
      active: text(node['active']),
      isRemoved: text(node['isRemoved']),
      tfBusOrder: text(node['tfBusOrder']),
      module: moduleOf(node['module'], refs),
      features: features(node['features'], refs),
      events: events(node['events'], refs),
    });
  }
  return out;
}

function periphery(list: unknown, refs: Refs): OmpPeriphery[] {
  const holder = refs.resolve(list);
  if (!holder) return [];
  const nodes: XmlNode[] = [];
  for (const [key, v] of Object.entries(holder)) {
    if (key.startsWith('@_') || key === '#text') continue;
    for (const n of toArray(v)) {
      const r = refs.resolve(n);
      if (r) nodes.push(r);
    }
  }
  nodes.sort((a, b) => Number(a['@_id'] ?? NaN) - Number(b['@_id'] ?? NaN)); // document order
  return nodes.map(p => ({
    name: text(p['name']) ?? '',
    nameOnCLU: text(p['nameOnCLU']) ?? '',
    typeName: text(p['typeName']),
    typeId: text(p['typeId']),
    typeVersion: text(p['typeVersion']),
    isRemoved: text(p['isRemoved']),
    existsOnCLU: text(p['existsOnCLU']),
    features: features(p['features'], refs),
    events: events(p['events'], refs),
  }));
}

function scripts(list: unknown, refs: Refs, cluName: string, zip: AdmZip): OmpScript[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['Script'])
    .map(s => refs.resolve(s))
    .filter((s): s is XmlNode => !!s)
    .map(s => {
      const name = text(s['name']) ?? '';
      const entry = zip.getEntry(`scripts/${cluName}/${name}.lua`);
      return {
        name,
        parameters: toArray(refs.resolve(s['parameters'])?.['string']).map(p => text(p) ?? ''),
        isManualEdit: text(s['isManualEdit']),
        source: entry ? entry.getData().toString('utf8') : undefined,
      };
    });
}

/**
 * CLU nodes anywhere in the document: XStream defines an object where it first occurs, which for
 * CLUs is often inside an IO's <clu> element rather than in the project tree. A CLU is any node
 * with serialNumber + iosList; references resolve to the same node, so identity dedupes.
 */
function collectClus(node: unknown, refs: Refs, out: Map<XmlNode, true>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectClus(n, refs, out);
    return;
  }
  const obj = refs.resolve(node);
  if (!obj) return;
  if (obj !== node) return; // a reference: the definition is visited where it occurs
  if ('serialNumber' in obj && 'iosList' in obj) out.set(obj, true);
  for (const v of Object.values(obj)) if (v && typeof v === 'object') collectClus(v, refs, out);
}

function zipOf(source: string | Buffer): AdmZip {
  return new AdmZip(source);
}

/** Reads the CLUs of an .omp (path or archive bytes). */
export function readOmpProject(source: string | Buffer): OmpProject {
  const zip = zipOf(source);
  const entry = zip.getEntry(SYSTEM_XML);
  if (!entry) throw new Error(`${SYSTEM_XML} not found in the project archive`);
  const parsed = PARSER.parse(entry.getData().toString('utf8')) as XmlNode;
  const root = parsed['object-stream'] as XmlNode | undefined;
  const refs = new Refs(parsed);

  const found = new Map<XmlNode, true>();
  collectClus(root, refs, found);

  const clus: OmpClu[] = [...found.keys()].map(c => {
    const name = text(c['name']) ?? '';
    return {
      name,
      nameOnCLU: text(c['nameOnCLU']) ?? '',
      serialNumber: text(c['serialNumber']) ?? '',
      macAddress: text(c['macAddress']),
      ipAddress: text(c['ipAddress']) ?? '',
      hardwareType: text(c['hardwareType']),
      hardwareVersion: text(c['hardwareVersion']),
      firmwareType: text(c['firmwareType']),
      firmwareVersion: text(c['firmwareVersion']),
      cipherKeyType: text(c['cipherKeyType']),
      isRemoved: text(c['isRemoved']),
      features: features(c['embeddedFeaturesList'], refs),
      events: events(c['eventsList'], refs),
      modules: toArray(refs.resolve(c['modulesList'])?.['InputOutputDefinition']).map(m => moduleOf(m, refs)).filter((m): m is OmpModule => !!m),
      ios: ios(c['iosList'], refs),
      periphery: periphery(c['peripheryList'], refs),
      scripts: scripts(c['scripts'], refs, name, zip),
    };
  });

  const projectXml = zip.getEntry(PROJECT_FILE)?.getData().toString('utf8');
  const projectName = projectXml ? /<name>([^<]*)<\/name>/.exec(projectXml)?.[1] ?? '' : '';
  const propertiesXml = zip.getEntry(PROPERTIES_FILE)?.getData().toString('utf8') ?? '';
  const ipv4 = (tag: string) => new RegExp(`<${tag}>\\s*(\\d{1,3}(?:\\.\\d{1,3}){3})\\s*</${tag}>`).exec(propertiesXml)?.[1];
  return { name: projectName, clus, network: { gateway: ipv4('gateway'), netmask: ipv4('netmask') } };
}

/**
 * Files OM cached from each CLU (`diagnostics/<serial>/<file>/<version>`): the latest version per
 * file, keyed by the serial directory name and the lower-case file name (om.lua, user.lua, ...).
 */
export function readOmpDiagnostics(source: string | Buffer): Map<string, Map<string, Buffer>> {
  const zip = zipOf(source);
  const latest = new Map<string, { name: string; data: () => Buffer }>();
  for (const e of zip.getEntries()) {
    const m = /^diagnostics\/([^/]+)\/([^/]+)\/(.+)$/.exec(e.entryName);
    if (!m || e.isDirectory) continue;
    const key = `${m[1]}/${m[2].toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || prev.name.localeCompare(e.entryName) < 0) latest.set(key, { name: e.entryName, data: () => e.getData() });
  }
  const out = new Map<string, Map<string, Buffer>>();
  for (const [key, v] of latest) {
    const [serial, file] = key.split('/');
    if (!out.has(serial)) out.set(serial, new Map());
    out.get(serial)!.set(file, v.data());
  }
  return out;
}
