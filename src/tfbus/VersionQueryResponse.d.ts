export interface VersionQueryResponse {
    /** First byte — corresponds to hwType in the module registry (1–55 range for known modules). */
    hwType: number;
    hwVer: number;
    fwApiVer: number;
    /** Present in 4-byte variant responses. */
    extra: number | null;
    raw: Buffer;
}
export declare function parseVersionResponse(payload: Buffer): VersionQueryResponse | null;
//# sourceMappingURL=VersionQueryResponse.d.ts.map