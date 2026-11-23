import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { CipherKey } from '../../CipherKey.js';
import { specificObjectClassFrom } from './system/specificObjects/SpecificObjectClass.js';
import { specificObjectTypeFrom } from './system/specificObjects/SpecificObjectType.js';

const PROPERTIES_XML = 'properties.xml';
const SYSTEM_XML = 'system.xml';

type XmlNode = Record<string, unknown>;

const PROPERTIES_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
});

const SYSTEM_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  isArray: (tagName: string) => tagName === 'TreeObject',
});

export interface TFBusIOInfo {
  name: string;
  ioClass: number;
  chanIdx: number;
}

export interface TFBusModuleInfo {
  cluSerial: string;
  addr: number;
  serialHex: string;
  serial: number;
  hwType: number;
  fwType: number;
  fwVer: number;
  ios: TFBusIOInfo[];
  ioNames: string[];
}

export interface ParsedSpecificObject {
  id: number | null;
  reference: number | null;
  objectClass: string | undefined;
  objectClassEnum: string;
  name: unknown;
  nameOnCLU: unknown;
  type: unknown;
  typeEnum: string;
  ipAddress: unknown;
  serialNumber: unknown;
  macAddress: unknown;
  hardwareType: unknown;
  hardwareVersion: unknown;
  firmwareType: unknown;
  firmwareVersion: unknown;
  cipherKeyType: string | undefined;
  iv: unknown;
  privateKey: unknown;
  clu: ParsedSpecificObject | null;
  iosList: ParsedSpecificObject[];
}

export function readProjectCipherKey(projectFilePath: string): CipherKey {
  const zip = new AdmZip(projectFilePath);
  const entry = zip.getEntry(PROPERTIES_XML);
  if (!entry) throw new Error(`${PROPERTIES_XML} not found in ${projectFilePath}`);

  const xml = entry.getData().toString('utf8');
  const parsed = PROPERTIES_PARSER.parse(xml) as XmlNode;
  const properties = (parsed['object-stream'] as XmlNode | undefined)?.['ProjectProperties'] as XmlNode | undefined;
  if (!properties) throw new Error(`ProjectProperties not found in ${PROPERTIES_XML}`);

  const cipherKey = properties['projectCipherKey'] as XmlNode | undefined;
  if (!cipherKey) throw new Error('projectCipherKey not found in ProjectProperties');

  const keyB64 = getTextValue(cipherKey['keyBytes']);
  const ivB64 = getTextValue(cipherKey['ivBytes']);

  return new CipherKey(
    Buffer.from(keyB64, 'base64'),
    Buffer.from(ivB64, 'base64'),
  );
}

export function readTFBusModules(projectFilePath: string): TFBusModuleInfo[] {
  const zip = new AdmZip(projectFilePath);
  const results: TFBusModuleInfo[] = [];

  const cluSerials = new Set<string>();
  for (const entry of zip.getEntries()) {
    const match = entry.entryName.match(/^diagnostics\/(\d+)\//);
    if (match && match[1] !== '1') cluSerials.add(match[1]);
  }

  for (const cluSerial of cluSerials) {
    const prefix = `diagnostics/${cluSerial}/`;

    const configEntries = zip.getEntries()
      .filter(entry => entry.entryName.startsWith(`${prefix}config.txt/`) && !entry.entryName.endsWith('/'))
      .sort((left, right) => left.entryName.localeCompare(right.entryName));
    if (configEntries.length === 0) continue;

    const omEntries = zip.getEntries()
      .filter(entry => entry.entryName.startsWith(`${prefix}om.lua/`) && !entry.entryName.endsWith('/'))
      .sort((left, right) => left.entryName.localeCompare(right.entryName));

    const configLines = configEntries[configEntries.length - 1].getData().toString('utf8').trim().split('\n');
    const moduleLines = configLines.slice(7);

    const ioNamesBySerial = omEntries.length > 0
      ? parseOmLuaIoNames(omEntries[omEntries.length - 1].getData().toString('utf8'))
      : new Map<string, TFBusIOInfo[]>();

    for (let i = 0; i < moduleLines.length; i++) {
      const line = moduleLines[i].trim();
      if (!line) continue;
      const parts = line.split(':');
      if (parts.length < 4) continue;
      const [serialHex, hwTypeStr, fwTypeStr, fwVerStr] = parts;
      const normalizedSerial = serialHex.toLowerCase().padStart(8, '0');
      const ios = ioNamesBySerial.get(normalizedSerial) ?? [];
      results.push({
        cluSerial,
        addr: i + 1,
        serialHex: normalizedSerial,
        serial: parseInt(serialHex, 16),
        hwType: parseInt(hwTypeStr, 16),
        fwType: parseInt(fwTypeStr, 16),
        fwVer: parseInt(fwVerStr, 16),
        ios,
        ioNames: ios.map(ioInfo => ioInfo.name),
      });
    }
  }

  return results;
}

export function readAllObjects(projectFilePath: string): Map<number, ParsedSpecificObject> {
  const zip = new AdmZip(projectFilePath);
  const entry = zip.getEntry(SYSTEM_XML);
  if (!entry) throw new Error(`${SYSTEM_XML} not found in ${projectFilePath}`);

  let xml = entry.getData().toString('utf8');
  xml = xml.replace(/<(\/?)\s*id\s*>/g, '<$1_id>');

  const parsed = SYSTEM_PARSER.parse(xml) as XmlNode;
  const root = parsed['object-stream'] as XmlNode | undefined;
  const topLevel = toArray(root?.['TreeObject']);

  const idMap = buildIdMap(parsed);
  const resultMap = new Map<number, ParsedSpecificObject>();
  extractAllObjects(topLevel, idMap, resultMap);

  return resultMap;
}

function getTextValue(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && '#text' in node) return String((node as XmlNode)['#text'] ?? '');
  return '';
}

function parseOmLuaIoNames(lua: string): Map<string, TFBusIOInfo[]> {
  const mmToSerial = new Map<string, string>();
  const ioMeta = new Map<string, { mmVar: string; ioClass: number; chanIdx: number }>();
  const ioToName = new Map<string, string>();

  for (const line of lua.split('\n')) {
    const trimmed = line.trim();

    const mmMatch = trimmed.match(/^(mm_\d+)\s*=\s*OBJECT:new\s*\(\s*2\s*,\s*(0x[0-9a-fA-F]+)/);
    if (mmMatch) {
      mmToSerial.set(mmMatch[1], mmMatch[2].slice(2).toLowerCase().padStart(8, '0'));
      continue;
    }

    if (!trimmed.startsWith('--')) {
      const ioMatch = trimmed.match(/^(\w+)\s*=\s*OBJECT:new\s*\(\s*(\d+)\s*,\s*(mm_\d+)\s*,\s*(\d+)/);
      if (ioMatch) {
        ioMeta.set(ioMatch[1], { mmVar: ioMatch[3], ioClass: parseInt(ioMatch[2], 10), chanIdx: parseInt(ioMatch[4], 10) });
        continue;
      }
    }

    const nameMatch = trimmed.match(/^--\s*NAME_IO\s+([^=]+)=(\w+)/);
    if (nameMatch) ioToName.set(nameMatch[2].trim(), nameMatch[1].trim());
  }

  const result = new Map<string, TFBusIOInfo[]>();
  for (const [ioVar, meta] of ioMeta) {
    const serialHex = mmToSerial.get(meta.mmVar);
    if (!serialHex) continue;
    const friendly = ioToName.get(ioVar);
    if (!friendly) continue;
    if (!result.has(serialHex)) result.set(serialHex, []);
    result.get(serialHex)!.push({ name: friendly, ioClass: meta.ioClass, chanIdx: meta.chanIdx });
  }
  return result;
}

function buildIdMap(node: unknown, map = new Map<string, XmlNode>()): Map<string, XmlNode> {
  if (!node || typeof node !== 'object') return map;
  const objectNode = node as XmlNode;
  const objectId = objectNode['@_id'];
  if (objectId != null) map.set(String(objectId), objectNode);
  for (const value of Object.values(objectNode)) {
    if (Array.isArray(value)) {
      for (const item of value) buildIdMap(item, map);
    } else if (value && typeof value === 'object') {
      buildIdMap(value, map);
    }
  }
  return map;
}

function extractAllObjects(nodes: XmlNode[], idMap: Map<string, XmlNode>, resultMap: Map<number, ParsedSpecificObject>): void {
  for (const node of nodes) {
    extractFromTreeNode(node, idMap, resultMap);
  }
}

function extractFromTreeNode(node: XmlNode | null | undefined, idMap: Map<string, XmlNode>, resultMap: Map<number, ParsedSpecificObject>): void {
  if (!node) return;

  const children = node['children'] as XmlNode | undefined;
  for (const child of toArray(children?.['TreeObject'] ?? children)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      extractFromTreeNode(child as XmlNode, idMap, resultMap);
    }
  }

  if (node['specificObject']) {
    extractFromSpecificObject(node['specificObject'] as XmlNode, idMap, resultMap);
  }
}

function extractFromSpecificObject(node: XmlNode, idMap: Map<string, XmlNode>, resultMap: Map<number, ParsedSpecificObject>): void {
  if (!node) return;

  const parsedObject = parseSpecificObject(node, idMap);
  if (parsedObject?.id != null) resultMap.set(parsedObject.id, parsedObject);

  for (const ioObject of parsedObject?.iosList ?? []) {
    if (ioObject?.id != null) resultMap.set(ioObject.id, ioObject);
  }

  if (parsedObject?.clu?.id != null) resultMap.set(parsedObject.clu.id, parsedObject.clu);
}

function parseSpecificObject(node: unknown, idMap: Map<string, XmlNode>): ParsedSpecificObject | null {
  if (!node) return null;
  const resolved = resolveRef(node, idMap);
  if (!resolved) return null;

  const objectClass = (resolved['@_class'] ?? (node as XmlNode)['@_class']) as string | undefined;
  const objectId = resolved['@_id'] != null ? Number(resolved['@_id']) : null;
  const reference = resolved['@_reference'] != null ? Number(resolved['@_reference']) : null;

  const parsedObject: ParsedSpecificObject = {
    id: objectId,
    reference,
    objectClass,
    objectClassEnum: specificObjectClassFrom(objectClass),
    name: resolved['name'],
    nameOnCLU: resolved['nameOnCLU'],
    type: resolved['type'],
    typeEnum: specificObjectTypeFrom(resolved['type'] as string | undefined),
    ipAddress: resolved['ipAddress'],
    serialNumber: resolved['serialNumber'],
    macAddress: resolved['macAddress'],
    hardwareType: resolved['hardwareType'],
    hardwareVersion: resolved['hardwareVersion'],
    firmwareType: resolved['firmwareType'],
    firmwareVersion: resolved['firmwareVersion'],
    cipherKeyType: resolved['cipherKeyType'] as string | undefined,
    iv: resolved['iv'],
    privateKey: resolved['privateKey'],
    clu: null,
    iosList: [],
  };

  const cluNode = resolved['clu'] ? resolveRef(resolved['clu'], idMap) : null;
  parsedObject.clu = cluNode ? parseSpecificObject(cluNode, idMap) : null;

  const iosListNode = resolved['iosList'] as XmlNode | undefined;
  const ioItems = toArray(iosListNode?.['IO'] ?? iosListNode?.['io']);
  parsedObject.iosList = ioItems
    .map(ioNode => parseSpecificObject(ioNode, idMap))
    .filter((ioObject): ioObject is ParsedSpecificObject => ioObject !== null);

  return parsedObject;
}

function resolveRef(node: unknown, idMap: Map<string, XmlNode>): XmlNode | null {
  if (!node || typeof node !== 'object') return null;
  const objectNode = node as XmlNode;
  const reference = objectNode['@_reference'];
  if (reference != null) return idMap.get(String(reference)) ?? null;
  return objectNode;
}

function toArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  return Array.isArray(value) ? value as XmlNode[] : [value as XmlNode];
}
