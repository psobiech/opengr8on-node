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
  const lowerContentType = contentType.toLowerCase();
  if (lowerContentType.startsWith('application/json') || lowerContentType.startsWith('text/json')) return HTTP_TYPE.JSON;
  if (lowerContentType.startsWith('application/xml') || lowerContentType.startsWith('text/xml')) return HTTP_TYPE.XML;
  if (lowerContentType.startsWith('text/plain')) return HTTP_TYPE.TEXT;
  if (lowerContentType.startsWith('application/x-www-form-urlencoded')) return HTTP_TYPE.FORM_DATA;
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
  const queryString = query.startsWith('?') ? query.slice(1) : query;
  const result: Record<string, string> = {};
  for (const part of queryString.split('&')) {
    if (!part) continue;
    const separatorIdx = part.indexOf('=');
    if (separatorIdx === -1) {
      result[decodeURIComponent(part)] = '';
    } else {
      result[decodeURIComponent(part.slice(0, separatorIdx))] = decodeURIComponent(part.slice(separatorIdx + 1));
    }
  }
  return result;
}

export function urlEncodeObject(obj: Record<string, string> | LuaLike): string {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return '';
  return Object.entries(obj as Record<string, unknown>)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
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

function xmlToLuaLike(node: unknown): LuaLike {
  if (node === null || node === undefined) return null;
  if (typeof node === 'boolean') return node;
  if (typeof node === 'number') return node;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return (node as unknown[]).map(xmlToLuaLike) as LuaLike[];
  if (typeof node === 'object') {
    const result: Record<string, LuaLike> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      result[key.replace(/^[^:]+:/, '')] = xmlToLuaLike(child);
    }
    return result;
  }
  return String(node);
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
