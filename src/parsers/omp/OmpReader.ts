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

function getTextValue(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && '#text' in node) return String((node as XmlNode)['#text'] ?? '');
  return '';
}

function toArray(v: unknown): XmlNode[] {
  if (v == null) return [];
  return Array.isArray(v) ? v as XmlNode[] : [v as XmlNode];
}

export function readProjectCipherKey(projectFilePath: string): CipherKey {
  const zip = new AdmZip(projectFilePath);
  const entry = zip.getEntry(PROPERTIES_XML);
  if (!entry) throw new Error(`${PROPERTIES_XML} not found in ${projectFilePath}`);

  const xml = entry.getData().toString('utf8');
  const parsed = PROPERTIES_PARSER.parse(xml) as XmlNode;
  const props = (parsed['object-stream'] as XmlNode | undefined)?.['ProjectProperties'] as XmlNode | undefined;
  if (!props) throw new Error(`ProjectProperties not found in ${PROPERTIES_XML}`);

  const cipherKey = props['projectCipherKey'] as XmlNode | undefined;
  if (!cipherKey) throw new Error('projectCipherKey not found in ProjectProperties');

  const keyB64 = getTextValue(cipherKey['keyBytes']);
  const ivB64 = getTextValue(cipherKey['ivBytes']);

  return new CipherKey(
    Buffer.from(keyB64, 'base64'),
    Buffer.from(ivB64, 'base64'),
  );
}

function buildIdMap(node: unknown, map = new Map<string, XmlNode>()): Map<string, XmlNode> {
  if (!node || typeof node !== 'object') return map;
  const obj = node as XmlNode;
  const id = obj['@_id'];
  if (id != null) map.set(String(id), obj);
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      for (const item of val) buildIdMap(item, map);
    } else if (val && typeof val === 'object') {
      buildIdMap(val, map);
    }
  }
  return map;
}

function resolveRef(node: unknown, idMap: Map<string, XmlNode>): XmlNode | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as XmlNode;
  const ref = obj['@_reference'];
  if (ref != null) return idMap.get(String(ref)) ?? null;
  return obj;
}

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

function parseSpecificObject(node: unknown, idMap: Map<string, XmlNode>): ParsedSpecificObject | null {
  if (!node) return null;
  const resolved = resolveRef(node, idMap);
  if (!resolved) return null;

  const objectClass = (resolved['@_class'] ?? (node as XmlNode)['@_class']) as string | undefined;
  const id = resolved['@_id'] != null ? Number(resolved['@_id']) : null;
  const reference = resolved['@_reference'] != null ? Number(resolved['@_reference']) : null;

  const obj: ParsedSpecificObject = {
    id,
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
  obj.clu = cluNode ? parseSpecificObject(cluNode, idMap) : null;

  const iosListNode = resolved['iosList'] as XmlNode | undefined;
  const ioItems = toArray(iosListNode?.['IO'] ?? iosListNode?.['io']);
  obj.iosList = ioItems
    .map(io => parseSpecificObject(io, idMap))
    .filter((o): o is ParsedSpecificObject => o !== null);

  return obj;
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

  const obj = parseSpecificObject(node, idMap);
  if (obj?.id != null) resultMap.set(obj.id, obj);

  for (const io of obj?.iosList ?? []) {
    if (io?.id != null) resultMap.set(io.id, io);
  }

  if (obj?.clu?.id != null) resultMap.set(obj.clu.id, obj.clu);
}

export function readTFBusModules(projectFilePath: string): TFBusModuleInfo[] {
  const zip = new AdmZip(projectFilePath);
  const results: TFBusModuleInfo[] = [];

  const cluSerials = new Set<string>();
  for (const entry of zip.getEntries()) {
    const m = entry.entryName.match(/^diagnostics\/(\d+)\//);
    if (m && m[1] !== '1') cluSerials.add(m[1]);
  }

  for (const cluSerial of cluSerials) {
    const prefix = `diagnostics/${cluSerial}/`;

    const configEntries = zip.getEntries()
      .filter(e => e.entryName.startsWith(`${prefix}config.txt/`) && !e.entryName.endsWith('/'))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));
    if (configEntries.length === 0) continue;

    const omEntries = zip.getEntries()
      .filter(e => e.entryName.startsWith(`${prefix}om.lua/`) && !e.entryName.endsWith('/'))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

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
        ioNames: ios.map(io => io.name),
      });
    }
  }

  return results;
}

function parseOmLuaIoNames(lua: string): Map<string, TFBusIOInfo[]> {
  const mmToSerial = new Map<string, string>();
  const ioMeta = new Map<string, { mmVar: string; ioClass: number; chanIdx: number }>();
  const ioToName = new Map<string, string>();

  for (const line of lua.split('\n')) {
    const t = line.trim();

    const mmMatch = t.match(/^(mm_\d+)\s*=\s*OBJECT:new\s*\(\s*2\s*,\s*(0x[0-9a-fA-F]+)/);
    if (mmMatch) {
      mmToSerial.set(mmMatch[1], mmMatch[2].slice(2).toLowerCase().padStart(8, '0'));
      continue;
    }

    if (!t.startsWith('--')) {
      const ioMatch = t.match(/^(\w+)\s*=\s*OBJECT:new\s*\(\s*(\d+)\s*,\s*(mm_\d+)\s*,\s*(\d+)/);
      if (ioMatch) {
        ioMeta.set(ioMatch[1], { mmVar: ioMatch[3], ioClass: parseInt(ioMatch[2], 10), chanIdx: parseInt(ioMatch[4], 10) });
        continue;
      }
    }

    const nameMatch = t.match(/^--\s*NAME_IO\s+([^=]+)=(\w+)/);
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
