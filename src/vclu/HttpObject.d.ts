import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';
export declare const HTTP_TYPE: {
    readonly NONE: 0;
    readonly TEXT: 1;
    readonly JSON: 2;
    readonly XML: 3;
    readonly FORM_DATA: 4;
    readonly OTHER: 5;
};
export type HttpType = (typeof HTTP_TYPE)[keyof typeof HTTP_TYPE];
export declare function httpTypeFromContentType(contentType: string | null | undefined): HttpType;
export declare function contentTypeForHttpType(type: HttpType): string | null;
export declare function stringifyBody(type: HttpType, value: LuaLike): string;
export declare function parseBody(type: HttpType, raw: string | Buffer): LuaLike;
export declare function urlDecodeQuery(query: string | null | undefined): Record<string, string>;
export declare function urlEncodeObject(obj: Record<string, string> | LuaLike): string;
export declare abstract class HttpObject extends VirtualObject {
    protected static readonly CONNECT_TIMEOUT_MS = 4000;
    constructor(virtualSystem: IVirtualSystem | null, name: string, featureCount: number);
}
//# sourceMappingURL=HttpObject.d.ts.map