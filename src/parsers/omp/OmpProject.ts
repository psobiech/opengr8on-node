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

const ARRAY_TAGS = new Set(['TreeObject', 'Input', 'Output', 'EmbeddedFeature', 'Event', 'string', 'Script', 'InputOutputDefinition', 'HardwarePeripheryCLU', 'ScriptParameter', 'DefinedFeature']);

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

/** Script parameter (OM 1.13: <ScriptParameter>), e.g. dd NUMBER default 1, RANGE 1..10. */
export interface OmpScriptParameter {
  name: string;
  /** default used when the caller passes nil (rendered into USER.LUA --ARG / --BEGIN_INIT) */
  defaultValue?: string;
  /** value last set in OM's editor (not in OM output) */
  value?: string;
  /** STRING / NUMBER / BOOLEAN / ... */
  paramType?: string;
  /** e.g. RANGE with restrictionValues [min, max] */
  restrictionType?: string;
  restrictionValues: string[];
  optional?: string;
}

/** CLU user feature ("variable", <DefinedFeature>): global Lua variable with a type and default. */
export interface OmpUserFeature {
  name: string;
  /** STRING / NUMBER / BOOLEAN / OTHER */
  paramType?: string;
  defaultValue?: string;
  /** "true": kept across restarts (OM.LUA: STO99999:execute(4, name) instead of 2) */
  persist?: string;
}

export interface OmpScript {
  name: string;
  parameters: OmpScriptParameter[];
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
  /** user features ("variables") in project order */
  userFeatures: OmpUserFeature[];
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

  const clus: OmpClu[] = [...found.keys()].map(cluNode => {
    const name = text(cluNode['name']) ?? '';
    return {
      name,
      nameOnCLU: text(cluNode['nameOnCLU']) ?? '',
      serialNumber: text(cluNode['serialNumber']) ?? '',
      macAddress: text(cluNode['macAddress']),
      ipAddress: text(cluNode['ipAddress']) ?? '',
      hardwareType: text(cluNode['hardwareType']),
      hardwareVersion: text(cluNode['hardwareVersion']),
      firmwareType: text(cluNode['firmwareType']),
      firmwareVersion: text(cluNode['firmwareVersion']),
      cipherKeyType: text(cluNode['cipherKeyType']),
      isRemoved: text(cluNode['isRemoved']),
      features: features(cluNode['embeddedFeaturesList'], refs),
      events: events(cluNode['eventsList'], refs),
      modules: toArray(refs.resolve(cluNode['modulesList'])?.['InputOutputDefinition']).map(moduleNode => moduleOf(moduleNode, refs)).filter((module): module is OmpModule => !!module),
      ios: ios(cluNode['iosList'], refs),
      periphery: periphery(cluNode['peripheryList'], refs),
      userFeatures: userFeatures(cluNode['definedFeaturesList'], refs),
      scripts: scripts(cluNode['scripts'], refs, name, zip),
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
  for (const zipEntry of zip.getEntries()) {
    const match = /^diagnostics\/([^/]+)\/([^/]+)\/(.+)$/.exec(zipEntry.entryName);
    if (!match || zipEntry.isDirectory) continue;
    const key = `${match[1]}/${match[2].toLowerCase()}`;
    const previous = latest.get(key);
    if (!previous || previous.name.localeCompare(zipEntry.entryName) < 0) latest.set(key, { name: zipEntry.entryName, data: () => zipEntry.getData() });
  }
  const result = new Map<string, Map<string, Buffer>>();
  for (const [key, latestEntry] of latest) {
    const [serial, file] = key.split('/');
    if (!result.has(serial)) result.set(serial, new Map());
    result.get(serial)!.set(file, latestEntry.data());
  }
  return result;
}

function zipOf(source: string | Buffer): AdmZip {
  return new AdmZip(source);
}

class Refs {
  private readonly byId = new Map<string, XmlNode>();
  constructor(root: unknown) {
    this.index(root);
  }
  private index(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) this.index(child);
      return;
    }
    const objectNode = node as XmlNode;
    if (objectNode['@_id'] != null) this.byId.set(String(objectNode['@_id']), objectNode);
    for (const value of Object.values(objectNode)) this.index(value);
  }
  resolve(node: unknown): XmlNode | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const objectNode = node as XmlNode;
    return objectNode['@_reference'] != null ? this.byId.get(String(objectNode['@_reference'])) : objectNode;
  }
}

/**
 * CLU nodes anywhere in the document: XStream defines an object where it first occurs, which for
 * CLUs is often inside an IO's <clu> element rather than in the project tree. A CLU is any node
 * with serialNumber + iosList; references resolve to the same node, so identity dedupes.
 */
function collectClus(node: unknown, refs: Refs, out: Map<XmlNode, true>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectClus(child, refs, out);
    return;
  }
  const objectNode = refs.resolve(node);
  if (!objectNode) return;
  if (objectNode !== node) return; // a reference: the definition is visited where it occurs
  if ('serialNumber' in objectNode && 'iosList' in objectNode) out.set(objectNode, true);
  for (const value of Object.values(objectNode)) if (value && typeof value === 'object') collectClus(value, refs, out);
}

function features(list: unknown, refs: Refs): OmpFeature[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['EmbeddedFeature'])
    .map(featureNode => refs.resolve(featureNode))
    .filter((featureNode): featureNode is XmlNode => !!featureNode)
    .map(featureNode => {
      const type = refs.resolve(featureNode['type']);
      return {
        name: text(featureNode['name']) ?? '',
        index: Number(text(featureNode['index']) ?? NaN),
        initValue: text(featureNode['initValue']),
        defaultInitValue: text(featureNode['defaultInitValue']),
        paramType: text(type?.['paramType']),
        accessType: text(featureNode['accessType']),
      };
    });
}

function events(list: unknown, refs: Refs): OmpEvent[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['Event'])
    .map(eventNode => refs.resolve(eventNode))
    .filter((eventNode): eventNode is XmlNode => !!eventNode)
    .map(eventNode => ({
      name: text(eventNode['name']) ?? '',
      index: Number(text(eventNode['index']) ?? NaN),
      commands: toArray(refs.resolve(eventNode['commands'])?.['string']).map(commandNode => text(commandNode) ?? ''),
    }));
}

function moduleOf(node: unknown, refs: Refs): OmpModule | undefined {
  const moduleNode = refs.resolve(node);
  if (!moduleNode) return undefined;
  return {
    moduleID: text(moduleNode['moduleID']) ?? '',
    moduleClass: text(moduleNode['moduleClass']),
    moduleInterface: text(moduleNode['moduleInterface']),
    moduleTypeFirmware: text(moduleNode['moduleTypeFirmware']),
    moduleVersion: text(moduleNode['moduleVersion']),
    innerName: text(moduleNode['innerName']),
    active: text(moduleNode['active']),
  };
}

function ios(list: unknown, refs: Refs): OmpIo[] {
  const holder = refs.resolve(list);
  if (!holder) return [];
  const result: OmpIo[] = [];
  // keep document order across Input/Output siblings: walk the raw keys in order of appearance
  const items: Array<{ kind: 'Input' | 'Output'; node: XmlNode; order: number }> = [];
  for (const kind of ['Input', 'Output'] as const) {
    for (const ioNode of toArray(holder[kind])) {
      const resolved = refs.resolve(ioNode);
      if (resolved) items.push({ kind, node: resolved, order: Number(resolved['@_id'] ?? NaN) });
    }
  }
  items.sort((left, right) => left.order - right.order); // XStream ids follow document order
  for (const { kind, node } of items) {
    result.push({
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
  return result;
}

function periphery(list: unknown, refs: Refs): OmpPeriphery[] {
  const holder = refs.resolve(list);
  if (!holder) return [];
  const nodes: XmlNode[] = [];
  for (const [key, value] of Object.entries(holder)) {
    if (key.startsWith('@_') || key === '#text') continue;
    for (const peripheryNode of toArray(value)) {
      const resolved = refs.resolve(peripheryNode);
      if (resolved) nodes.push(resolved);
    }
  }
  nodes.sort((left, right) => Number(left['@_id'] ?? NaN) - Number(right['@_id'] ?? NaN)); // document order
  return nodes.map(peripheryNode => ({
    name: text(peripheryNode['name']) ?? '',
    nameOnCLU: text(peripheryNode['nameOnCLU']) ?? '',
    typeName: text(peripheryNode['typeName']),
    typeId: text(peripheryNode['typeId']),
    typeVersion: text(peripheryNode['typeVersion']),
    isRemoved: text(peripheryNode['isRemoved']),
    existsOnCLU: text(peripheryNode['existsOnCLU']),
    features: features(peripheryNode['features'], refs),
    events: events(peripheryNode['events'], refs),
  }));
}

function userFeatures(list: unknown, refs: Refs): OmpUserFeature[] {
  return toArray(refs.resolve(list)?.['DefinedFeature'])
    .map(featureNode => refs.resolve(featureNode))
    .filter((featureNode): featureNode is XmlNode => !!featureNode)
    .map(featureNode => ({
      name: text(featureNode['name']) ?? '',
      paramType: text(refs.resolve(featureNode['type'])?.['paramType']),
      defaultValue: text(featureNode['defaultValue']),
      persist: text(featureNode['persist']),
    }));
}

function scripts(list: unknown, refs: Refs, cluName: string, zip: AdmZip): OmpScript[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['Script'])
    .map(scriptNode => refs.resolve(scriptNode))
    .filter((scriptNode): scriptNode is XmlNode => !!scriptNode)
    .map(scriptNode => {
      const name = text(scriptNode['name']) ?? '';
      const entry = zip.getEntry(`scripts/${cluName}/${name}.lua`);
      return {
        name,
        parameters: scriptParameters(scriptNode['parameters'], refs),
        isManualEdit: text(scriptNode['isManualEdit']),
        source: entry ? entry.getData().toString('utf8') : undefined,
      };
    });
}

function scriptParameters(list: unknown, refs: Refs): OmpScriptParameter[] {
  const holder = refs.resolve(list);
  return toArray(holder?.['ScriptParameter'])
    .map(parameterNode => refs.resolve(parameterNode))
    .filter((parameterNode): parameterNode is XmlNode => !!parameterNode)
    .map(parameterNode => {
      const type = refs.resolve(parameterNode['extendParamType']);
      return {
        name: text(parameterNode['name']) ?? '',
        defaultValue: text(parameterNode['defaultValue']),
        value: text(parameterNode['value']),
        paramType: text(type?.['paramType']),
        restrictionType: text(type?.['restrictionType']),
        restrictionValues: toArray(refs.resolve(type?.['restrictionValues'])?.['string']).map(restrictionNode => text(restrictionNode) ?? ''),
        optional: text(parameterNode['optional']),
      };
    });
}

function text(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in (node as XmlNode)) return String((node as XmlNode)['#text']);
  if (typeof node === 'object') return '';
  return undefined;
}

function toArray(value: unknown): XmlNode[] {
  return value == null ? [] : Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode];
}
