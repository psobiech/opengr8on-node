export interface CluKeys {
    key: Buffer;
    iv: Buffer;
    defaultIV: Buffer;
    pin: Buffer;
}
export interface CLUDeviceConfig {
    sn: number;
    mac: string;
    hwType: number;
    hwVer: number;
    fwType: number;
    fwApiVer: number;
    fwVer: string;
    status: string;
    tfbusDevices: unknown[];
}
export declare function readOrGenerateKeys(runtimeDirectory: string): CluKeys;
export declare function writeKeys(runtimeDirectory: string, keys: CluKeys): void;
export declare function readOrGenerateDeviceConfig(aDriveDirectory: string, macAddress: string): CLUDeviceConfig;
export declare function writeDeviceConfig(aDriveDirectory: string, config: CLUDeviceConfig): void;
//# sourceMappingURL=Config.d.ts.map