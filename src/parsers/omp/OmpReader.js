import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { CipherKey } from '../../CipherKey.js';
import { specificObjectClassFrom } from './system/specificObjects/SpecificObjectClass.js';
import { specificObjectTypeFrom } from './system/specificObjects/SpecificObjectType.js';

const PROPERTIES_XML = 'properties.xml';
const SYSTEM_XML = 'system.xml';

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
  isArray: (tagName) => tagName === 'TreeObject',
});

function getTextValue(node) {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') return node['#text'] ?? '';
  return '';
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function readProjectCipherKey(projectFilePath) {
  const zip = new AdmZip(projectFilePath);
  const entry = zip.getEntry(PROPERTIES_XML);
  if (!entry) throw new Error(`${PROPERTIES_XML} not found in ${projectFilePath}`);

  const xml = entry.getData().toString('utf8');
  const parsed = PROPERTIES_PARSER.parse(xml);
  const props = parsed['object-stream']?.['ProjectProperties'];
  if (!props) throw new Error(`ProjectProperties not found in ${PROPERTIES_XML}`);

  const cipherKey = props['projectCipherKey'];
  if (!cipherKey) throw new Error('projectCipherKey not found in ProjectProperties');

  const keyB64 = getTextValue(cipherKey['keyBytes']);
  const ivB64 = getTextValue(cipherKey['ivBytes']);

  return new CipherKey(
    Buffer.from(keyB64, 'base64'),
    Buffer.from(ivB64, 'base64'),
  );
}

function buildIdMap(node, map = new Map()) {
  if (!node || typeof node !== 'object') return map;

  const id = node['@_id'];
  if (id != null) map.set(String(id), node);

  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) buildIdMap(item, map);
    } else if (val && typeof val === 'object') {
      buildIdMap(val, map);
    }
  }
  return map;
}

function resolveRef(node, idMap) {
  if (!node || typeof node !== 'object') return node;
  const ref = node['@_reference'];
  if (ref != null) return idMap.get(String(ref)) ?? null;
  return node;
}

function parseSpecificObject(node, idMap) {
  if (!node) return null;
  const resolved = resolveRef(node, idMap);
  if (!resolved) return null;

  const objectClass = resolved['@_class'];
  const id = resolved['@_id'] != null ? Number(resolved['@_id']) : null;
  const reference = resolved['@_reference'] != null ? Number(resolved['@_reference']) : null;

  const obj = {
    id,
    reference,
    objectClass,
    objectClassEnum: specificObjectClassFrom(objectClass),
    name: resolved.name,
    nameOnCLU: resolved.nameOnCLU,
    type: resolved.type,
    typeEnum: specificObjectTypeFrom(resolved.type),
    ipAddress: resolved.ipAddress,
    serialNumber: resolved.serialNumber,
    macAddress: resolved.macAddress,
    hardwareType: resolved.hardwareType,
    hardwareVersion: resolved.hardwareVersion,
    firmwareType: resolved.firmwareType,
    firmwareVersion: resolved.firmwareVersion,
    cipherKeyType: resolved.cipherKeyType,
    iv: resolved.iv,
    privateKey: resolved.privateKey,
  };

  const cluNode = resolved.clu ? resolveRef(resolved.clu, idMap) : null;
  obj.clu = cluNode ? parseSpecificObject(cluNode, idMap) : null;

  obj.iosList = toArray(resolved.iosList?.IO ?? resolved.iosList?.io).map(io => parseSpecificObject(io, idMap)).filter(Boolean);

  return obj;
}

function extractAllObjects(nodes, idMap, resultMap = new Map()) {
  for (const node of toArray(nodes)) {
    extractFromTreeNode(node, idMap, resultMap);
  }
  return resultMap;
}

function extractFromTreeNode(node, idMap, resultMap) {
  if (!node) return;

  for (const child of toArray(node.children?.TreeObject ?? node.children)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      extractFromTreeNode(child, idMap, resultMap);
    }
  }

  if (node.specificObject) {
    extractFromSpecificObject(node.specificObject, idMap, resultMap);
  }
}

function extractFromSpecificObject(node, idMap, resultMap) {
  if (!node) return;

  const obj = parseSpecificObject(node, idMap);
  if (obj?.id != null) resultMap.set(obj.id, obj);

  for (const io of obj?.iosList ?? []) {
    if (io?.id != null) resultMap.set(io.id, io);
  }

  if (obj?.clu?.id != null) resultMap.set(obj.clu.id, obj.clu);
}

/**
 * @typedef {{ name: string, ioClass: number, chanIdx: number }} TFBusIOInfo
 * @typedef {{ cluSerial: string, addr: number, serialHex: string, serial: number, hwType: number, fwType: number, fwVer: number, ios: TFBusIOInfo[], ioNames: string[] }} TFBusModuleInfo
 */

/**
 * Returns TFBus modules from the OMP project file.
 * RS485 address derived from 1-based line order in config.txt (after 7-line CLU header).
 * @param {string} projectFilePath
 * @returns {TFBusModuleInfo[]}
 */
export function readTFBusModules(projectFilePath) {
  const zip = new AdmZip(projectFilePath);
  const results = [];

  const cluSerials = new Set();
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
    const moduleLines = configLines.slice(7); // skip 7-line CLU header

    const ioNamesBySerial = omEntries.length > 0
      ? parseOmLuaIoNames(omEntries[omEntries.length - 1].getData().toString('utf8'))
      : new Map();

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

/**
 * @param {string} lua
 * @returns {Map<string, TFBusIOInfo[]>} serialHex → IO info list
 */
function parseOmLuaIoNames(lua) {
  const mmToSerial = new Map();
  // ioVar → { mmVar, ioClass, chanIdx }
  const ioMeta = new Map();
  const ioToName = new Map();

  for (const line of lua.split('\n')) {
    const t = line.trim();

    // mm_320112459 = OBJECT:new(2, 0x1314874b, ...)
    const mmMatch = t.match(/^(mm_\d+)\s*=\s*OBJECT:new\s*\(\s*2\s*,\s*(0x[0-9a-fA-F]+)/);
    if (mmMatch) {
      mmToSerial.set(mmMatch[1], mmMatch[2].slice(2).toLowerCase().padStart(8, '0'));
      continue;
    }

    // DIM1186 = OBJECT:new(5, mm_320112459, 0, "DIM1186")  — skip --INACTIVE
    if (!t.startsWith('--')) {
      const ioMatch = t.match(/^(\w+)\s*=\s*OBJECT:new\s*\(\s*(\d+)\s*,\s*(mm_\d+)\s*,\s*(\d+)/);
      if (ioMatch) {
        ioMeta.set(ioMatch[1], { mmVar: ioMatch[3], ioClass: parseInt(ioMatch[2], 10), chanIdx: parseInt(ioMatch[4], 10) });
        continue;
      }
    }

    // -- NAME_IO LAMPA_KORYTARZ_PIETRO=DIM1186
    const nameMatch = t.match(/^--\s*NAME_IO\s+([^=]+)=(\w+)/);
    if (nameMatch) ioToName.set(nameMatch[2].trim(), nameMatch[1].trim());
  }

  const result = new Map();
  for (const [ioVar, meta] of ioMeta) {
    const serialHex = mmToSerial.get(meta.mmVar);
    if (!serialHex) continue;
    const friendly = ioToName.get(ioVar);
    if (!friendly) continue;
    if (!result.has(serialHex)) result.set(serialHex, []);
    result.get(serialHex).push({ name: friendly, ioClass: meta.ioClass, chanIdx: meta.chanIdx });
  }
  return result;
}

export function readAllObjects(projectFilePath) {
  const zip = new AdmZip(projectFilePath);
  const entry = zip.getEntry(SYSTEM_XML);
  if (!entry) throw new Error(`${SYSTEM_XML} not found in ${projectFilePath}`);

  let xml = entry.getData().toString('utf8');
  xml = xml.replace(/<(\/?)\s*id\s*>/g, '<$1_id>');

  const parsed = SYSTEM_PARSER.parse(xml);
  const root = parsed['object-stream'];
  const topLevel = toArray(root?.TreeObject);

  const idMap = buildIdMap(parsed);
  const resultMap = new Map();
  extractAllObjects(topLevel, idMap, resultMap);

  return resultMap;
}
