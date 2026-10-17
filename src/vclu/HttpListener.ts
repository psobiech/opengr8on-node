import { createServer, IncomingMessage, ServerResponse, Server as NodeHttpServer } from 'node:http';
import { HttpObject, HTTP_TYPE, HttpType, httpTypeFromContentType, contentTypeForHttpType, stringifyBody, parseBody, urlDecodeQuery } from './HttpObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';

export const HTTP_LISTENER_FEATURES = {
  PATH: 0,
  METHOD: 1,
  QUERY: 2,
  REQUEST_TYPE: 3,
  REQUEST_HEADERS: 4,
  REQUEST_BODY: 5,
  RESPONSE_TYPE: 6,
  RESPONSE_HEADERS: 7,
  RESPONSE_BODY: 8,
  RESPONSE_STATUS: 9,
} as const;

export const HTTP_LISTENER_METHODS = {
  SEND_RESPONSE: 0,
  CLEAR: 1,
} as const;

export const HTTP_LISTENER_EVENTS = {
  REQUEST: 0,
} as const;

export class HttpListener extends HttpObject {
  static readonly INDEX = 120;
  static readonly FEATURES = HTTP_LISTENER_FEATURES;
  static readonly METHODS = HTTP_LISTENER_METHODS;
  static readonly EVENTS = HTTP_LISTENER_EVENTS;

  static readonly DEFAULT_PORT = 80;

  private _server: NodeHttpServer;
  private _currentRes: ServerResponse | null = null;

  constructor(
    virtualSystem: IVirtualSystem | null,
    name: string,
    port: number = HttpListener.DEFAULT_PORT,
    hostname?: string,
  ) {
    super(virtualSystem, name, 10);

    this.setValue(HTTP_LISTENER_FEATURES.PATH, null);
    this.setValue(HTTP_LISTENER_FEATURES.METHOD, null);
    this.setValue(HTTP_LISTENER_FEATURES.QUERY, null);
    this.setValue(HTTP_LISTENER_FEATURES.REQUEST_TYPE, HTTP_TYPE.NONE);
    this.setValue(HTTP_LISTENER_FEATURES.REQUEST_HEADERS, null);
    this.setValue(HTTP_LISTENER_FEATURES.REQUEST_BODY, null);
    this.setValue(HTTP_LISTENER_FEATURES.RESPONSE_TYPE, HTTP_TYPE.JSON);
    this.setValue(HTTP_LISTENER_FEATURES.RESPONSE_HEADERS, null);
    this.setValue(HTTP_LISTENER_FEATURES.RESPONSE_BODY, null);
    this.setValue(HTTP_LISTENER_FEATURES.RESPONSE_STATUS, 200);

    this.registerMethod(HTTP_LISTENER_METHODS.SEND_RESPONSE, (bodyArg) =>
      this._onSendResponse(bodyArg),
    );
    this.registerMethod(HTTP_LISTENER_METHODS.CLEAR, () => {
      this._clearHttp();
      return null;
    });

    this._server = createServer((req, res) => this._handleRequest(req, res));
    this._server.listen(port, hostname);
  }

  private _handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!this.isEventRegistered(HTTP_LISTENER_EVENTS.REQUEST)) {
      res.writeHead(404);
      res.end();
      return;
    }

    // Wait for previous request to finish, then handle new one
    void this.awaitEventTrigger(HTTP_LISTENER_EVENTS.REQUEST).then(async () => {
      if (this._currentRes != null) {
        try { this._currentRes.writeHead(404); this._currentRes.end(); } catch { /* closed */ }
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const query = urlDecodeQuery(url.search) as LuaLike;

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v[0] ?? '';
      }

      const contentType = req.headers['content-type'] ?? null;
      const reqType = httpTypeFromContentType(contentType);

      const bodyChunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
        req.on('end', resolve);
        req.on('error', resolve);
      });
      const rawBody = Buffer.concat(bodyChunks);
      const parsedBody = parseBody(reqType, rawBody);

      this.setValue(HTTP_LISTENER_FEATURES.METHOD, req.method ?? 'GET');
      this.setValue(HTTP_LISTENER_FEATURES.PATH, url.pathname);
      this.setValue(HTTP_LISTENER_FEATURES.QUERY, query);
      this.setValue(HTTP_LISTENER_FEATURES.REQUEST_HEADERS, headers as unknown as LuaLike);
      this.setValue(HTTP_LISTENER_FEATURES.REQUEST_TYPE, reqType);
      this.setValue(HTTP_LISTENER_FEATURES.REQUEST_BODY, parsedBody);

      this._currentRes = res;

      this.triggerEvent(HTTP_LISTENER_EVENTS.REQUEST, () => {
        if (res.writableEnded) return;
        try { res.writeHead(404); res.end(); } catch { /* closed */ }
      });
    }).catch((e) => console.error(`[${this.name}] request handler error:`, e));
  }

  private _onSendResponse(bodyArg: LuaLike): null {
    const res = this._currentRes;
    if (res == null || res.writableEnded) return null;

    try {
      const respType = Number(this.get(HTTP_LISTENER_FEATURES.RESPONSE_TYPE)) as HttpType;
      const status = Number(this.get(HTTP_LISTENER_FEATURES.RESPONSE_STATUS) ?? 200);

      const headers: Record<string, string> = {
        'Content-Type': contentTypeForHttpType(respType) ?? 'text/plain',
        'Server': 'openGr8on/vclu',
      };

      const customHeaders = this.get(HTTP_LISTENER_FEATURES.RESPONSE_HEADERS);
      if (customHeaders != null && typeof customHeaders === 'object' && !Array.isArray(customHeaders)) {
        for (const [k, v] of Object.entries(customHeaders as Record<string, unknown>)) {
          headers[k] = String(v ?? '');
        }
      }

      const body = bodyArg !== null && bodyArg !== undefined
        ? bodyArg
        : this.get(HTTP_LISTENER_FEATURES.RESPONSE_BODY);
      const bodyStr = stringifyBody(respType, body);
      const bodyBuf = Buffer.from(bodyStr, 'utf8');

      headers['Content-Length'] = String(bodyBuf.length);
      res.writeHead(status, headers);
      res.end(bodyBuf);
    } catch (e) {
      console.error(`[${this.name}] sendResponse error:`, e);
      try { res.writeHead(500); res.end(); } catch { /* closed */ }
    } finally {
      this._currentRes = null;
    }

    return null;
  }

  private _clearHttp(): void {
    this.clearValue(HTTP_LISTENER_FEATURES.REQUEST_BODY);
    this.clearValue(HTTP_LISTENER_FEATURES.REQUEST_HEADERS);
    this.setValue(HTTP_LISTENER_FEATURES.REQUEST_TYPE, HTTP_TYPE.NONE);
    this.setValue(HTTP_LISTENER_FEATURES.RESPONSE_STATUS, 200);
    this.clearValue(HTTP_LISTENER_FEATURES.RESPONSE_HEADERS);
    this.clearValue(HTTP_LISTENER_FEATURES.RESPONSE_BODY);
  }

  override close(): void {
    if (this._currentRes != null && !this._currentRes.writableEnded) {
      try { this._currentRes.writeHead(500); this._currentRes.end(); } catch { /* closed */ }
    }
    this._server.close();
  }
}
