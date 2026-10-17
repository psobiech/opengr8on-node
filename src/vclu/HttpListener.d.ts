import { HttpObject } from './HttpObject.js';
import type { IVirtualSystem } from './types.js';
export declare const HTTP_LISTENER_FEATURES: {
    readonly PATH: 0;
    readonly METHOD: 1;
    readonly QUERY: 2;
    readonly REQUEST_TYPE: 3;
    readonly REQUEST_HEADERS: 4;
    readonly REQUEST_BODY: 5;
    readonly RESPONSE_TYPE: 6;
    readonly RESPONSE_HEADERS: 7;
    readonly RESPONSE_BODY: 8;
    readonly RESPONSE_STATUS: 9;
};
export declare const HTTP_LISTENER_METHODS: {
    readonly SEND_RESPONSE: 0;
    readonly CLEAR: 1;
};
export declare const HTTP_LISTENER_EVENTS: {
    readonly REQUEST: 0;
};
export declare class HttpListener extends HttpObject {
    static readonly INDEX = 120;
    static readonly FEATURES: {
        readonly PATH: 0;
        readonly METHOD: 1;
        readonly QUERY: 2;
        readonly REQUEST_TYPE: 3;
        readonly REQUEST_HEADERS: 4;
        readonly REQUEST_BODY: 5;
        readonly RESPONSE_TYPE: 6;
        readonly RESPONSE_HEADERS: 7;
        readonly RESPONSE_BODY: 8;
        readonly RESPONSE_STATUS: 9;
    };
    static readonly METHODS: {
        readonly SEND_RESPONSE: 0;
        readonly CLEAR: 1;
    };
    static readonly EVENTS: {
        readonly REQUEST: 0;
    };
    static readonly DEFAULT_PORT = 80;
    private _server;
    private _currentRes;
    constructor(virtualSystem: IVirtualSystem | null, name: string, port?: number, hostname?: string);
    private _handleRequest;
    private _onSendResponse;
    private _clearHttp;
    close(): void;
}
//# sourceMappingURL=HttpListener.d.ts.map