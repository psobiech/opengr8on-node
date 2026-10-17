import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export interface ProjectFeature {
  name: string;
  index: number;
  accessGet: boolean;
  accessSet: boolean;
  type: string;
}

export interface ProjectEvent {
  name: string;
  index: number;
}

export interface ProjectObject {
  name: string;
  nameOnClu: string;
  typeName: string;
  typeId: number;
  features: ProjectFeature[];
  events: ProjectEvent[];
  cluName: string;
}

export interface ProjectClu {
  id: string;
  name: string;
  nameOnClu: string;
  ipAddress: string;
  serialNumber?: string;
  macAddress?: string;
  objects: ProjectObject[];
}

export interface ProjectProperties {
  projectKey?: Buffer;
  projectIV?: Buffer;
  encryptedClus: Map<string, boolean>;
}

export class ProjectRegistry {
  private readonly _cluById = new Map<string, ProjectClu>();
  private readonly _cluByName = new Map<string, ProjectClu>();
  private readonly _properties: ProjectProperties;

  private constructor(clus: ProjectClu[], properties: ProjectProperties) {
    this._properties = properties;
    for (const clu of clus) {
      this._cluById.set(clu.id, clu);
      this._cluByName.set(clu.name, clu);
    }
  }

  static empty(): ProjectRegistry {
    return new ProjectRegistry([], { encryptedClus: new Map() });
  }

  /** Load from a project.omp ZIP file. Requires optional 'adm-zip' package. */
  static async loadFromOmp(ompPath: string): Promise<ProjectRegistry> {
    let systemXml: string | null = null;
    let propertiesXml: string | null = null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: AdmZip } = await import('adm-zip') as any;
      const zip = new AdmZip(ompPath);
      systemXml = zip.readAsText('system.xml') ?? null;
      propertiesXml = zip.readAsText('properties.xml') ?? null;
    } catch {
      const sibling = resolve(ompPath, '../system.xml');
      if (existsSync(sibling)) systemXml = readFileSync(sibling, 'utf8');
      const propSibling = resolve(ompPath, '../properties.xml');
      if (existsSync(propSibling)) propertiesXml = readFileSync(propSibling, 'utf8');
    }

    if (systemXml == null) {
      console.warn(`[ProjectRegistry] cannot read system.xml from ${ompPath} — registry empty`);
      return ProjectRegistry.empty();
    }

    return ProjectRegistry.parseXml(systemXml, propertiesXml ?? '');
  }

  /** Load from an already-extracted system.xml path. */
  static loadFromFile(systemXmlPath: string, propertiesXmlPath?: string): ProjectRegistry {
    const systemXml = readFileSync(systemXmlPath, 'utf8');
    const propertiesXml = propertiesXmlPath && existsSync(propertiesXmlPath)
      ? readFileSync(propertiesXmlPath, 'utf8')
      : '';
    return ProjectRegistry.parseXml(systemXml, propertiesXml);
  }

  static parseXml(systemXml: string, propertiesXml: string): ProjectRegistry {
    const properties = parseProperties(propertiesXml);
    const clus = parseSystem(systemXml);
    return new ProjectRegistry(clus, properties);
  }

  isEmpty(): boolean { return this._cluByName.size === 0; }

  getClus(): ProjectClu[] { return [...this._cluByName.values()]; }

  getClu(name: string): ProjectClu | null {
    return this._cluByName.get(name) ?? null;
  }

  getCluByIp(ip: string): ProjectClu | null {
    for (const clu of this._cluByName.values()) {
      if (clu.ipAddress === ip) return clu;
    }
    return null;
  }

  getObjectsForClu(cluName: string): ProjectObject[] {
    return this._cluByName.get(cluName)?.objects ?? [];
  }

  getObjectOnClu(cluName: string, nameOnClu: string): ProjectObject | null {
    return this.getObjectsForClu(cluName).find((o) => o.nameOnClu === nameOnClu) ?? null;
  }

  get properties(): ProjectProperties { return this._properties; }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

const PROPS_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (name: string) => name === 'entry',
});

// XStream serialization: elements can carry id="N" and reference other elements
// via a sibling or ancestor <foo reference="N"/> node.
const SYSTEM_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (name: string) =>
    name === 'specificObject' ||
    name === 'ProgrammablePeripheryCLU' ||
    name === 'EmbeddedFeature' ||
    name === 'EmbeddedEvent',
});

// ---------------------------------------------------------------------------
// Parse properties.xml
// ---------------------------------------------------------------------------

function parseProperties(xml: string): ProjectProperties {
  const result: ProjectProperties = { encryptedClus: new Map() };
  if (!xml) return result;

  try {
    const doc = PROPS_PARSER.parse(xml) as Record<string, unknown>;
    const root = rootOf(doc);

    if (typeof root['keyBytes'] === 'string') result.projectKey = Buffer.from(root['keyBytes'], 'base64');
    if (typeof root['ivBytes'] === 'string') result.projectIV = Buffer.from(root['ivBytes'], 'base64');

    const encClu = root['encryptedCLU'] as Record<string, unknown> | undefined;
    for (const e of toArray(encClu?.['entry'])) {
      const entry = e as Record<string, unknown>;
      const ip = str(entry['string']);
      if (ip) result.encryptedClus.set(ip, entry['boolean'] === true || entry['boolean'] === 'true');
    }
  } catch (e) {
    console.warn('[ProjectRegistry] failed to parse properties.xml:', e);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Parse system.xml (XStream format)
// ---------------------------------------------------------------------------

function parseSystem(xml: string): ProjectClu[] {
  const clus: ProjectClu[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = SYSTEM_PARSER.parse(xml) as Record<string, unknown>;
  } catch (e) {
    console.warn('[ProjectRegistry] failed to parse system.xml:', e);
    return clus;
  }

  const root = rootOf(doc);

  // Walk entire tree once to build id → object map (XStream reference resolution)
  const idMap = new Map<number, Record<string, unknown>>();
  collectIds(root, idMap);

  const soList = root['specificObjectList'] as Record<string, unknown> | undefined;
  if (!soList) return clus;

  for (const so of toArray(soList['specificObject'])) {
    const soObj = so as Record<string, unknown>;
    if (soObj['class'] !== 'ProgrammablePeripheryCLU') continue;

    // CLU definition must be inline (not an XStream reference to another element)
    const cluNode = soObj['clu'] as Record<string, unknown> | undefined;
    if (!cluNode || 'reference' in cluNode) continue;

    const cluId = toNum(cluNode['id']);
    const cluName = str(cluNode['name']);
    const ipAddress = str(cluNode['ipAddress']);
    if (!cluName || !ipAddress || isNaN(cluId)) continue;

    const objects: ProjectObject[] = [];
    const peripheryList = resolveRef(soObj['peripheryList'] as Record<string, unknown> | undefined, idMap);

    if (peripheryList) {
      for (const dev of toArray(peripheryList['ProgrammablePeripheryCLU'])) {
        const devNode = dev as Record<string, unknown>;

        // Filter: device must reference this CLU
        const devClu = devNode['clu'] as Record<string, unknown> | undefined;
        if (!devClu || toNum(devClu['reference']) !== cluId) continue;

        const devName = str(devNode['name']);
        const devNameOnClu = str(devNode['nameOnCLU']) ?? str(devNode['nameOnClu']);
        if (!devName || !devNameOnClu) continue;

        const typeId = toNum(devNode['typeId']);
        objects.push({
          name: devName,
          nameOnClu: devNameOnClu,
          typeName: str(devNode['typeName']) ?? '',
          typeId: isNaN(typeId) ? 0 : typeId,
          features: parseEmbeddedFeatures(devNode, idMap),
          events: parseEmbeddedEvents(devNode, idMap),
          cluName,
        });
      }
    }

    clus.push({
      id: String(soObj['id'] ?? ''),
      name: cluName,
      nameOnClu: str(cluNode['nameOnCLU']) ?? str(cluNode['nameOnClu']) ?? cluName,
      ipAddress,
      serialNumber: str(cluNode['serialNumber']) ?? undefined,
      macAddress: str(cluNode['macAddress']) ?? undefined,
      objects,
    });
  }

  return clus;
}

function parseEmbeddedFeatures(devNode: Record<string, unknown>, idMap: Map<number, Record<string, unknown>>): ProjectFeature[] {
  const featuresNode = resolveRef(devNode['features'] as Record<string, unknown> | undefined, idMap);
  if (!featuresNode) return [];

  return toArray(featuresNode['EmbeddedFeature']).flatMap((ef) => {
    const e = ef as Record<string, unknown>;
    const name = str(e['name']);
    const index = toNum(e['index']);
    if (!name || isNaN(index)) return [];
    const access = str(e['accessType']) ?? 'READ';
    return [{
      name,
      index,
      accessGet: access === 'READ' || access === 'ALL',
      accessSet: access === 'WRITE' || access === 'ALL',
      type: str(e['paramType']) ?? 'NUMBER',
    }];
  });
}

function parseEmbeddedEvents(devNode: Record<string, unknown>, idMap: Map<number, Record<string, unknown>>): ProjectEvent[] {
  const eventsNode = resolveRef(devNode['events'] as Record<string, unknown> | undefined, idMap);
  if (!eventsNode) return [];

  return toArray(eventsNode['EmbeddedEvent']).flatMap((ee) => {
    const e = ee as Record<string, unknown>;
    const name = str(e['name']);
    const index = toNum(e['index']);
    if (!name || isNaN(index)) return [];
    return [{ name, index }];
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk parsed tree, registering every object that has an id attribute. */
function collectIds(node: unknown, map: Map<number, Record<string, unknown>>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, map);
    return;
  }
  const obj = node as Record<string, unknown>;
  const id = toNum(obj['id']);
  if (!isNaN(id) && !map.has(id)) map.set(id, obj);
  for (const val of Object.values(obj)) collectIds(val, map);
}

/** If node has a reference attribute, return the referenced object from idMap. */
function resolveRef(
  node: Record<string, unknown> | undefined,
  idMap: Map<number, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  if (!('reference' in node)) return node;
  const id = toNum(node['reference']);
  return isNaN(id) ? node : idMap.get(id);
}

/** Get the first non-processing-instruction element from a parsed document. */
function rootOf(doc: Record<string, unknown>): Record<string, unknown> {
  const entry = Object.entries(doc).find(([k]) => !k.startsWith('?'));
  return (entry?.[1] ?? {}) as Record<string, unknown>;
}

function toArray(v: unknown): unknown[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v, 10);
  return NaN;
}
