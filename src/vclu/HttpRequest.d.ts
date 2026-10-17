import { HttpObject } from './HttpObject.js';
import type { IVirtualSystem } from './types.js';
export declare const HTTP_REQUEST_FEATURES: {
    readonly HOST: 0;
    readonly PATH: 1;
    readonly QUERY: 2;
    readonly METHOD: 3;
    readonly TIMEOUT: 4;
    readonly REQUEST_TYPE: 5;
    readonly RESPONSE_TYPE: 6;
    readonly REQUEST_HEADERS: 7;
    readonly REQUEST_BODY: 8;
    readonly RESPONSE_HEADERS: 9;
    readonly RESPONSE_BODY: 10;
    readonly RESPONSE_STATUS: 11;
    readonly ACTIVE: 12;
};
export declare const HTTP_REQUEST_METHODS: {
    readonly SEND_REQUEST: 0;
    readonly ABORT_REQUEST: 1;
    readonly CLEAR: 2;
};
export declare const HTTP_REQUEST_EVENTS: {
    readonly REQUEST_SENT: 0;
    readonly RESPONSE: 1;
};
export declare class HttpRequest extends HttpObject {
    static readonly INDEX = 121;
    static readonly FEATURES: {
        readonly HOST: 0;
        readonly PATH: 1;
        readonly QUERY: 2;
        readonly METHOD: 3;
        readonly TIMEOUT: 4;
        readonly REQUEST_TYPE: 5;
        readonly RESPONSE_TYPE: 6;
        readonly REQUEST_HEADERS: 7;
        readonly REQUEST_BODY: 8;
        readonly RESPONSE_HEADERS: 9;
        readonly RESPONSE_BODY: 10;
        readonly RESPONSE_STATUS: 11;
        readonly ACTIVE: 12;
    };
    static readonly METHODS: {
        readonly SEND_REQUEST: 0;
        readonly ABORT_REQUEST: 1;
        readonly CLEAR: 2;
    };
    static readonly EVENTS: {
        readonly REQUEST_SENT: 0;
        readonly RESPONSE: 1;
    };
    private _abortController;
    private _activePromise;
    constructor(virtualSystem: IVirtualSystem | null, name: string);
    private _onSendRequest;
    private _doRequest;
    private _abort;
    private _clear;
    close(): void;
}
//# sourceMappingURL=HttpRequest.d.ts.map