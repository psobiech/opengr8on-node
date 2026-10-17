import { VirtualObject } from './VirtualObject.js';
export const HTTP_TYPE = {
    NONE: 0,
    TEXT: 1,
    JSON: 2,
    XML: 3,
    FORM_DATA: 4,
    OTHER: 5,
};
const CONTENT_TYPES = {
    [HTTP_TYPE.TEXT]: 'text/plain',
    [HTTP_TYPE.JSON]: 'application/json',
    [HTTP_TYPE.XML]: 'application/xml',
    [HTTP_TYPE.FORM_DATA]: 'application/x-www-form-urlencoded',
};
export function httpTypeFromContentType(contentType) {
    if (!contentType)
        return HTTP_TYPE.NONE;
    const lc = contentType.toLowerCase();
    if (lc.startsWith('application/json') || lc.startsWith('text/json'))
        return HTTP_TYPE.JSON;
    if (lc.startsWith('application/xml') || lc.startsWith('text/xml'))
        return HTTP_TYPE.XML;
    if (lc.startsWith('text/plain'))
        return HTTP_TYPE.TEXT;
    if (lc.startsWith('application/x-www-form-urlencoded'))
        return HTTP_TYPE.FORM_DATA;
    return HTTP_TYPE.OTHER;
}
export function contentTypeForHttpType(type) {
    return CONTENT_TYPES[type] ?? null;
}
export function stringifyBody(type, value) {
    switch (type) {
        case HTTP_TYPE.NONE:
            return '';
        case HTTP_TYPE.JSON:
            return JSON.stringify(value);
        case HTTP_TYPE.FORM_DATA:
            return urlEncodeObject(value);
        default:
            return value == null ? '' : String(value);
    }
}
export function parseBody(type, raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    switch (type) {
        case HTTP_TYPE.NONE:
            return null;
        case HTTP_TYPE.JSON:
            try {
                return JSON.parse(text);
            }
            catch {
                return text;
            }
        case HTTP_TYPE.XML:
            return parseXml(text);
        case HTTP_TYPE.FORM_DATA:
            return urlDecodeQuery(text);
        default:
            return text;
    }
}
export function urlDecodeQuery(query) {
    if (!query)
        return {};
    const q = query.startsWith('?') ? query.slice(1) : query;
    const result = {};
    for (const part of q.split('&')) {
        if (!part)
            continue;
        const eq = part.indexOf('=');
        if (eq === -1) {
            result[decodeURIComponent(part)] = '';
        }
        else {
            result[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
        }
    }
    return result;
}
export function urlEncodeObject(obj) {
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj))
        return '';
    return Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
        .join('&');
}
function parseXml(xml) {
    const result = {};
    // matches <tag>content</tag> including nested; non-greedy via inner capture
    const re = /<([\w:.-]+)(?:\s[^>]*)?>(\s*(?:<[\s\S]*?>[\s\S]*?<\/[\w:.-]+>|[^<]*)*?)\s*<\/\1>/g;
    let match;
    let found = false;
    while ((match = re.exec(xml)) !== null) {
        found = true;
        const key = match[1].replace(/.*:/, ''); // strip namespace prefix
        const inner = match[2].trim();
        result[key] = /<[\w:.-]+/.test(inner) ? parseXml(inner) : castXmlValue(inner);
    }
    return found ? result : xml;
}
function castXmlValue(s) {
    if (s === 'true')
        return true;
    if (s === 'false')
        return false;
    if (s !== '' && !isNaN(Number(s)))
        return Number(s);
    return s;
}
export class HttpObject extends VirtualObject {
    static CONNECT_TIMEOUT_MS = 4000;
    constructor(virtualSystem, name, featureCount) {
        super(virtualSystem, name);
        void featureCount;
    }
}
