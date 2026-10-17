import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export class ProjectRegistry {
    _cluById = new Map();
    _cluByName = new Map();
    _properties;
    constructor(clus, properties) {
        this._properties = properties;
        for (const clu of clus) {
            this._cluById.set(clu.id, clu);
            this._cluByName.set(clu.name, clu);
        }
    }
    static empty() {
        return new ProjectRegistry([], { encryptedClus: new Map() });
    }
    /** Load from a project.omp ZIP file. Requires optional 'adm-zip' package. */
    static async loadFromOmp(ompPath) {
        // try adm-zip first
        let systemXml = null;
        let propertiesXml = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { default: AdmZip } = await import('adm-zip');
            const zip = new AdmZip(ompPath);
            systemXml = zip.readAsText('system.xml') ?? null;
            propertiesXml = zip.readAsText('properties.xml') ?? null;
        }
        catch {
            // adm-zip not available — try sibling system.xml
            const sibling = resolve(ompPath, '../system.xml');
            if (existsSync(sibling)) {
                systemXml = readFileSync(sibling, 'utf8');
            }
            const propSibling = resolve(ompPath, '../properties.xml');
            if (existsSync(propSibling)) {
                propertiesXml = readFileSync(propSibling, 'utf8');
            }
        }
        if (systemXml == null) {
            console.warn(`[ProjectRegistry] cannot read system.xml from ${ompPath} — registry empty`);
            return ProjectRegistry.empty();
        }
        return ProjectRegistry.parseXml(systemXml, propertiesXml ?? '');
    }
    /** Load from an already-extracted system.xml path. */
    static loadFromFile(systemXmlPath, propertiesXmlPath) {
        const systemXml = readFileSync(systemXmlPath, 'utf8');
        const propertiesXml = propertiesXmlPath && existsSync(propertiesXmlPath)
            ? readFileSync(propertiesXmlPath, 'utf8')
            : '';
        return ProjectRegistry.parseXml(systemXml, propertiesXml);
    }
    static parseXml(systemXml, propertiesXml) {
        const properties = parseProperties(propertiesXml);
        const clus = parseSystem(systemXml);
        return new ProjectRegistry(clus, properties);
    }
    isEmpty() { return this._cluByName.size === 0; }
    getClus() { return [...this._cluByName.values()]; }
    getClu(name) {
        return this._cluByName.get(name) ?? null;
    }
    getCluByIp(ip) {
        for (const clu of this._cluByName.values()) {
            if (clu.ipAddress === ip)
                return clu;
        }
        return null;
    }
    getObjectsForClu(cluName) {
        return this._cluByName.get(cluName)?.objects ?? [];
    }
    getObjectOnClu(cluName, nameOnClu) {
        const obj = this.getObjectsForClu(cluName).find((o) => o.nameOnClu === nameOnClu);
        return obj ?? null;
    }
    get properties() { return this._properties; }
}
// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------
/** Extract first text content of <tag>text</tag> within xml string. */
function txt(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 's');
    return xml.match(re)?.[1]?.trim() ?? null;
}
/** Extract all occurrences of <tag ...>content</tag> */
function elems(xml, tag) {
    const results = [];
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
    let m;
    while ((m = openRe.exec(xml)) !== null) {
        const closeTag = `</${tag}>`;
        const start = m.index + m[0].length;
        const end = xml.indexOf(closeTag, start);
        if (end === -1)
            continue;
        results.push(xml.slice(start, end));
        openRe.lastIndex = end + closeTag.length;
    }
    return results;
}
/** Extract attribute value from opening tag text */
function attr(tagText, name) {
    const re = new RegExp(`${name}="([^"]*)"`, 's');
    return tagText.match(re)?.[1] ?? null;
}
// ---------------------------------------------------------------------------
// Parse properties.xml
// ---------------------------------------------------------------------------
function parseProperties(xml) {
    const result = { encryptedClus: new Map() };
    if (!xml)
        return result;
    const keyBytes = txt(xml, 'keyBytes');
    const ivBytes = txt(xml, 'ivBytes');
    if (keyBytes)
        result.projectKey = Buffer.from(keyBytes, 'base64');
    if (ivBytes)
        result.projectIV = Buffer.from(ivBytes, 'base64');
    // <encryptedCLU class="tree-map">
    //   <entry><string>192.168.31.39</string><boolean>true</boolean></entry>
    // </encryptedCLU>
    const encBlock = xml.match(/<encryptedCLU[^>]*>([\s\S]*?)<\/encryptedCLU>/)?.[1] ?? '';
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let entry;
    while ((entry = entryRe.exec(encBlock)) !== null) {
        const ip = txt(entry[1], 'string');
        const boolVal = txt(entry[1], 'boolean');
        if (ip)
            result.encryptedClus.set(ip, boolVal === 'true');
    }
    return result;
}
// ---------------------------------------------------------------------------
// Parse system.xml (XStream format)
// ---------------------------------------------------------------------------
function buildIdMap(xml, map) {
    const re = /<(\w+)[^>]+\bid="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        if (!map.has(m[2]))
            map.set(m[2], m[3]);
        buildIdMap(m[3], map);
    }
}
function parseSystem(xml) {
    // ------------------------------------------------------------------
    // Step 1: Build id → raw body map for all elements with id= attribute
    //         (XStream reference resolution — recursive so nested ids are captured)
    // ------------------------------------------------------------------
    const idMap = new Map();
    buildIdMap(xml, idMap);
    // ------------------------------------------------------------------
    // Step 2: Extract CLU definitions
    //         <specificObject class="ProgrammablePeripheryCLU" id="N">
    //           <clu id="M">...</clu>
    //           <peripheryList ...>...</peripheryList>
    //         </specificObject>
    // ------------------------------------------------------------------
    const clus = [];
    const soRe = /<specificObject class="ProgrammablePeripheryCLU" id="(\d+)">([\s\S]*?)<\/specificObject>/g;
    let m;
    while ((m = soRe.exec(xml)) !== null) {
        const soId = m[1];
        const soBody = m[2];
        // Must contain inline <clu id="N"> (not a reference)
        const cluInlineMatch = soBody.match(/<clu id="(\d+)">([\s\S]*?)<\/clu>/);
        if (cluInlineMatch == null)
            continue;
        const cluId = cluInlineMatch[1];
        const cluBody = cluInlineMatch[2];
        const cluName = txt(cluBody, 'name');
        const ipAddress = txt(cluBody, 'ipAddress');
        const nameOnClu = txt(cluBody, 'nameOnCLU') ?? txt(cluBody, 'nameOnClu');
        const serialNumber = txt(cluBody, 'serialNumber') ?? undefined;
        const macAddress = txt(cluBody, 'macAddress') ?? undefined;
        if (cluName == null || ipAddress == null)
            continue;
        // ------------------------------------------------------------------
        // Step 3: Extract device objects from peripheryList
        //         <ProgrammablePeripheryCLU id="N">
        //           <clu reference="M"/>  ← M == cluId
        //           <name>...</name>
        //           <nameOnCLU>...</nameOnCLU>
        //           <typeName>...</typeName>
        //           <typeId>...</typeId>
        //           <features>...</features>
        //           <events>...</events>
        //         </ProgrammablePeripheryCLU>
        // ------------------------------------------------------------------
        const objects = [];
        const peripheryMatch = soBody.match(/<peripheryList[^>]*>([\s\S]*?)<\/peripheryList>/);
        if (peripheryMatch != null) {
            const peripheryBody = peripheryMatch[1];
            const devRe = /<ProgrammablePeripheryCLU id="(\d+)">([\s\S]*?)<\/ProgrammablePeripheryCLU>/g;
            let dev;
            while ((dev = devRe.exec(peripheryBody)) !== null) {
                const devBody = dev[2];
                // Must reference the correct parent CLU
                if (!devBody.includes(`<clu reference="${cluId}"/>`))
                    continue;
                const devName = txt(devBody, 'name');
                const devNameOnClu = txt(devBody, 'nameOnCLU') ?? txt(devBody, 'nameOnClu');
                const typeName = txt(devBody, 'typeName');
                const typeIdStr = txt(devBody, 'typeId');
                if (devName == null || devNameOnClu == null)
                    continue;
                const features = parseEmbeddedFeatures(devBody, idMap);
                const events = parseEmbeddedEvents(devBody, idMap);
                objects.push({
                    name: devName,
                    nameOnClu: devNameOnClu,
                    typeName: typeName ?? '',
                    typeId: typeIdStr != null ? parseInt(typeIdStr, 10) : 0,
                    features,
                    events,
                    cluName,
                });
            }
        }
        clus.push({
            id: soId,
            name: cluName,
            nameOnClu: nameOnClu ?? cluName,
            ipAddress,
            serialNumber,
            macAddress,
            objects,
        });
        void cluId; // used for reference checks above
    }
    return clus;
}
function parseEmbeddedFeatures(body, idMap) {
    const features = [];
    // Resolve features block (may be inline or referenced)
    let featuresBody = '';
    const inlineMatch = body.match(/<features[^>]*>([\s\S]*?)<\/features>/);
    if (inlineMatch != null) {
        featuresBody = inlineMatch[1];
    }
    else {
        const refMatch = body.match(/<features reference="(\d+)"\/>/);
        if (refMatch != null)
            featuresBody = idMap.get(refMatch[1]) ?? '';
    }
    if (!featuresBody)
        return features;
    for (const ef of elems(featuresBody, 'EmbeddedFeature')) {
        const name = txt(ef, 'name');
        const indexStr = txt(ef, 'index');
        const access = txt(ef, 'accessType') ?? 'READ';
        const paramType = txt(ef, 'paramType') ?? 'NUMBER';
        if (name == null || indexStr == null)
            continue;
        features.push({
            name,
            index: parseInt(indexStr, 10),
            accessGet: access === 'READ' || access === 'ALL',
            accessSet: access === 'WRITE' || access === 'ALL',
            type: paramType,
        });
    }
    return features;
}
function parseEmbeddedEvents(body, idMap) {
    const events = [];
    let eventsBody = '';
    const inlineMatch = body.match(/<events[^>]*>([\s\S]*?)<\/events>/);
    if (inlineMatch != null) {
        eventsBody = inlineMatch[1];
    }
    else {
        const refMatch = body.match(/<events reference="(\d+)"\/>/);
        if (refMatch != null)
            eventsBody = idMap.get(refMatch[1]) ?? '';
    }
    if (!eventsBody)
        return events;
    for (const ee of elems(eventsBody, 'EmbeddedEvent')) {
        const name = txt(ee, 'name');
        const indexStr = txt(ee, 'index');
        if (name == null || indexStr == null)
            continue;
        events.push({ name, index: parseInt(indexStr, 10) });
    }
    return events;
}
void attr; // exported util used externally if needed
