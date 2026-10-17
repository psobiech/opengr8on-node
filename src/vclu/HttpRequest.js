import { HttpObject, HTTP_TYPE, httpTypeFromContentType, contentTypeForHttpType, stringifyBody, parseBody, urlEncodeObject } from './HttpObject.js';
export const HTTP_REQUEST_FEATURES = {
    HOST: 0,
    PATH: 1,
    QUERY: 2,
    METHOD: 3,
    TIMEOUT: 4,
    REQUEST_TYPE: 5,
    RESPONSE_TYPE: 6,
    REQUEST_HEADERS: 7,
    REQUEST_BODY: 8,
    RESPONSE_HEADERS: 9,
    RESPONSE_BODY: 10,
    RESPONSE_STATUS: 11,
    ACTIVE: 12,
};
export const HTTP_REQUEST_METHODS = {
    SEND_REQUEST: 0,
    ABORT_REQUEST: 1,
    CLEAR: 2,
};
export const HTTP_REQUEST_EVENTS = {
    REQUEST_SENT: 0,
    RESPONSE: 1,
};
export class HttpRequest extends HttpObject {
    static INDEX = 121;
    static FEATURES = HTTP_REQUEST_FEATURES;
    static METHODS = HTTP_REQUEST_METHODS;
    static EVENTS = HTTP_REQUEST_EVENTS;
    _abortController = null;
    _activePromise = null;
    constructor(virtualSystem, name) {
        super(virtualSystem, name, 13);
        this.setValue(HTTP_REQUEST_FEATURES.HOST, '');
        this.setValue(HTTP_REQUEST_FEATURES.PATH, '/');
        this.setValue(HTTP_REQUEST_FEATURES.QUERY, null);
        this.setValue(HTTP_REQUEST_FEATURES.METHOD, 'GET');
        this.setValue(HTTP_REQUEST_FEATURES.TIMEOUT, 30);
        this.setValue(HTTP_REQUEST_FEATURES.REQUEST_TYPE, HTTP_TYPE.NONE);
        this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_TYPE, HTTP_TYPE.JSON);
        this.setValue(HTTP_REQUEST_FEATURES.REQUEST_HEADERS, null);
        this.setValue(HTTP_REQUEST_FEATURES.REQUEST_BODY, null);
        this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_HEADERS, null);
        this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_BODY, null);
        this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_STATUS, null);
        this.registerFeature(HTTP_REQUEST_FEATURES.ACTIVE, () => this._activePromise != null);
        this.registerMethod(HTTP_REQUEST_METHODS.SEND_REQUEST, (bodyArg) => this._onSendRequest(bodyArg));
        this.registerMethod(HTTP_REQUEST_METHODS.ABORT_REQUEST, () => {
            this._abort();
            return null;
        });
        this.registerMethod(HTTP_REQUEST_METHODS.CLEAR, () => {
            this._clear();
            return null;
        });
    }
    _onSendRequest(bodyArg) {
        this._abort();
        const reqType = Number(this.get(HTTP_REQUEST_FEATURES.REQUEST_TYPE));
        const body = bodyArg !== null && bodyArg !== undefined
            ? bodyArg
            : this.get(HTTP_REQUEST_FEATURES.REQUEST_BODY);
        const bodyStr = stringifyBody(reqType, body);
        this._abortController = new AbortController();
        this._activePromise = this._doRequest(bodyStr, this._abortController.signal).finally(() => {
            this._activePromise = null;
        });
        return null;
    }
    async _doRequest(bodyStr, signal) {
        const host = String(this.get(HTTP_REQUEST_FEATURES.HOST) ?? '');
        const path = String(this.get(HTTP_REQUEST_FEATURES.PATH) ?? '/');
        const query = this.get(HTTP_REQUEST_FEATURES.QUERY);
        const method = String(this.get(HTTP_REQUEST_FEATURES.METHOD) ?? 'GET').toUpperCase();
        const timeoutSec = Number(this.get(HTTP_REQUEST_FEATURES.TIMEOUT) ?? 30);
        const reqType = Number(this.get(HTTP_REQUEST_FEATURES.REQUEST_TYPE));
        const respType = Number(this.get(HTTP_REQUEST_FEATURES.RESPONSE_TYPE));
        const queryStr = buildQueryString(query);
        const url = `${host}${path}${queryStr}`;
        const headers = {
            'User-Agent': 'openGr8on/vclu',
        };
        const reqContentType = contentTypeForHttpType(reqType);
        if (reqContentType)
            headers['Content-Type'] = reqContentType;
        const respContentType = contentTypeForHttpType(respType);
        if (respContentType)
            headers['Accept'] = respContentType;
        const customHeaders = this.get(HTTP_REQUEST_FEATURES.REQUEST_HEADERS);
        if (customHeaders != null && typeof customHeaders === 'object' && !Array.isArray(customHeaders)) {
            for (const [k, v] of Object.entries(customHeaders)) {
                headers[k] = String(v ?? '');
            }
        }
        this.setValue(HTTP_REQUEST_FEATURES.REQUEST_HEADERS, headers);
        const timeoutMs = Math.min(timeoutSec * 1000, 60_000);
        const timer = setTimeout(() => this._abortController?.abort(), timeoutMs);
        try {
            this.triggerEvent(HTTP_REQUEST_EVENTS.REQUEST_SENT);
            const fetchOptions = {
                method,
                headers,
                signal,
            };
            if (method !== 'GET' && method !== 'HEAD' && bodyStr) {
                fetchOptions.body = bodyStr;
            }
            const resp = await fetch(url, fetchOptions);
            const statusCode = resp.status;
            const respContentTypeHeader = resp.headers.get('content-type') ?? '';
            const detectedType = httpTypeFromContentType(respContentTypeHeader);
            const rawBody = await resp.text();
            const parsedBody = parseBody(detectedType, rawBody);
            const respHeaders = {};
            resp.headers.forEach((v, k) => { respHeaders[k] = v; });
            this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_STATUS, statusCode);
            this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_TYPE, detectedType);
            this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_HEADERS, respHeaders);
            this.setValue(HTTP_REQUEST_FEATURES.RESPONSE_BODY, parsedBody);
            this.triggerEvent(HTTP_REQUEST_EVENTS.RESPONSE);
        }
        catch (e) {
            if (e.name !== 'AbortError') {
                console.error(`[${this.name}] HTTP ${method} ${url} error:`, e);
            }
            this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_STATUS);
            this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_HEADERS);
            this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_BODY);
        }
        finally {
            clearTimeout(timer);
        }
    }
    _abort() {
        this._abortController?.abort();
        this._abortController = null;
    }
    _clear() {
        this.clearValue(HTTP_REQUEST_FEATURES.REQUEST_BODY);
        this.clearValue(HTTP_REQUEST_FEATURES.REQUEST_HEADERS);
        this.setValue(HTTP_REQUEST_FEATURES.REQUEST_TYPE, HTTP_TYPE.NONE);
        this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_STATUS);
        this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_HEADERS);
        this.clearValue(HTTP_REQUEST_FEATURES.RESPONSE_BODY);
    }
    close() {
        this._abort();
    }
}
function buildQueryString(query) {
    if (query == null)
        return '';
    if (typeof query === 'string')
        return query.startsWith('?') ? query : `?${query}`;
    if (typeof query === 'object' && !Array.isArray(query)) {
        const str = urlEncodeObject(query);
        return str ? `?${str}` : '';
    }
    return '';
}
