import { XMLParser } from 'fast-xml-parser';
import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';

const XML_PARSER = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
  isArray: () => false,
});

export const HTTP_TYPE = {
  NONE: 0,
  TEXT: 1,
  JSON: 2,
  XML: 3,
  FORM_DATA: 4,
  OTHER: 5,
} as const;
export type HttpType = (typeof HTTP_TYPE)[keyof typeof HTTP_TYPE];

const CONTENT_TYPES: Partial<Record<HttpType, string>> = {
  [HTTP_TYPE.TEXT]: 'text/plain',
  [HTTP_TYPE.JSON]: 'application/json',
  [HTTP_TYPE.XML]: 'application/xml',
  [HTTP_TYPE.FORM_DATA]: 'application/x-www-form-urlencoded',
};

export function httpTypeFromContentType(contentType: string | null | undefined): HttpType {
  if (!contentType) return HTTP_TYPE.NONE;
  const lc = contentType.toLowerCase();
  if (lc.startsWith('application/json') || lc.startsWith('text/json')) return HTTP_TYPE.JSON;
  if (lc.startsWith('application/xml') || lc.startsWith('text/xml')) return HTTP_TYPE.XML;
  if (lc.startsWith('text/plain')) return HTTP_TYPE.TEXT;
  if (lc.startsWith('application/x-www-form-urlencoded')) return HTTP_TYPE.FORM_DATA;
  return HTTP_TYPE.OTHER;
}

export function contentTypeForHttpType(type: HttpType): string | null {
  return CONTENT_TYPES[type] ?? null;
}

export function stringifyBody(type: HttpType, value: LuaLike): string {
  switch (type) {
    case HTTP_TYPE.NONE:
      return '';
    case HTTP_TYPE.JSON:
      return JSON.stringify(value);
    case HTTP_TYPE.FORM_DATA:
      return urlEncodeObject(value as Record<string, string>);
    default:
      return value == null ? '' : String(value);
  }
}

export function parseBody(type: HttpType, raw: string | Buffer): LuaLike {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  switch (type) {
    case HTTP_TYPE.NONE:
      return null;
    case HTTP_TYPE.JSON:
      try {
        return JSON.parse(text) as LuaLike;
      } catch {
        return text;
      }
    case HTTP_TYPE.XML:
      return parseXml(text);
    case HTTP_TYPE.FORM_DATA:
      return urlDecodeQuery(text) as LuaLike;
    default:
      return text;
  }
}

export function urlDecodeQuery(query: string | null | undefined): Record<string, string> {
  if (!query) return {};
  const q = query.startsWith('?') ? query.slice(1) : query;
  const result: Record<string, string> = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      result[decodeURIComponent(part)] = '';
    } else {
      result[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
    }
  }
  return result;
}

export function urlEncodeObject(obj: Record<string, string> | LuaLike): string {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return '';
  return Object.entries(obj as Record<string, unknown>)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
    .join('&');
}

function parseXml(xml: string): LuaLike {
  try {
    const parsed = XML_PARSER.parse(xml) as Record<string, unknown>;
    if (Object.keys(parsed).length === 0) return xml;
    return xmlToLuaLike(parsed);
  } catch {
    return xml;
  }
}

function xmlToLuaLike(v: unknown): LuaLike {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return (v as unknown[]).map(xmlToLuaLike) as LuaLike[];
  if (typeof v === 'object') {
    const result: Record<string, LuaLike> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      result[k.replace(/^[^:]+:/, '')] = xmlToLuaLike(child);
    }
    return result;
  }
  return String(v);
}

export abstract class HttpObject extends VirtualObject {
  protected static readonly CONNECT_TIMEOUT_MS = 4000;

  constructor(
    virtualSystem: IVirtualSystem | null,
    name: string,
    featureCount: number,
  ) {
    super(virtualSystem, name);
    void featureCount;
  }
}
