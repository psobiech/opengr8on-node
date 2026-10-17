import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseModuleXml } from './InterfaceRegistry.js';
export function loadProperties(filePath) {
    const map = new Map();
    if (!existsSync(filePath))
        return map;
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
        if (line.startsWith('#') || !line.includes('='))
            continue;
        const eq = line.indexOf('=');
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim()
            .replace(/\\u([0-9a-fA-F]{4})/g, (_match, c) => String.fromCharCode(parseInt(c, 16)));
        map.set(key, val);
    }
    return map;
}
function makeTranslator(resDir, lang) {
    const translations = loadProperties(join(resDir, `device-interfaces_${lang}.properties`));
    const fallback = lang !== 'en'
        ? loadProperties(join(resDir, 'device-interfaces_en.properties'))
        : new Map();
    return (resKey) => {
        if (!resKey)
            return undefined;
        return translations.get(resKey) ?? fallback.get(resKey);
    };
}
function withDesc(t, obj) {
    const { resKey, ...rest } = obj;
    const desc = t(resKey);
    const result = rest;
    if (desc !== undefined)
        result.desc = desc;
    return result;
}
function indexBy(arr, keyFn) {
    const out = {};
    for (const item of arr)
        out[keyFn(item)] = item;
    return out;
}
function setNested(obj, keys, value) {
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!(k in cur))
            cur[k] = {};
        cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
}
/**
 * Reads all `module_*.xml` files from `dir`, parses them, resolves translations,
 * and returns a nested lookup keyed by `[hwType][fwType][fwApiVer]`.
 */
export function transcribeModules(dir, options = {}) {
    const lang = options.lang ?? 'pl';
    const t = makeTranslator(join(dir, 'text-resources'), lang);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wd = (obj) => withDesc(t, obj);
    const files = readdirSync(dir).filter((f) => f.startsWith('module_') && f.endsWith('.xml'));
    const output = {};
    const errors = [];
    for (const fileName of files) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const m = parseModuleXml(readFileSync(join(dir, fileName), 'utf8'));
            if (!m) {
                errors.push(`${fileName}: no root element`);
                continue;
            }
            const hwType = m.typeId != null ? parseInt(m.typeId, 16) : NaN;
            const fwType = m.firmware?.typeId != null ? parseInt(m.firmware.typeId, 16) : NaN;
            const fwApiVer = m.firmware?.version != null ? parseInt(m.firmware.version, 16) : NaN;
            if (isNaN(hwType) || isNaN(fwType) || isNaN(fwApiVer)) {
                errors.push(`${fileName}: missing hwType/fwType/fwApiVer`);
                continue;
            }
            const objects = {};
            for (const o of (m.firmware?.objects ?? [])) {
                objects[parseInt(o.class, 10)] = {
                    name: o.name,
                    type: o.type,
                    features: indexBy(o.interface.features.map((f) => wd({ ...f, enums: f.enums.map(wd) })), (f) => f.index),
                    methods: indexBy(o.interface.methods.map(wd), (m) => m.index),
                    events: indexBy(o.interface.events.map(wd), (e) => e.address),
                };
            }
            setNested(output, [hwType, fwType, fwApiVer], { name: m.name ?? null, file: fileName, objects });
        }
        catch (e) {
            errors.push(`${fileName}: ${e.message}`);
        }
    }
    return { output: output, errors };
}
