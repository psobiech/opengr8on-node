import type { CipherKey } from '../../CipherKey.js';

export interface TFBusIOInfo {
  /** User-defined friendly name (from NAME_IO comment in om.lua). */
  name: string;
  /** CLU object class ID (e.g. 4=DOUT, 5=DIMM, 24=ROLLER_SHUTTER). */
  ioClass: number;
  /** 0-based channel index within the module. */
  chanIdx: number;
}

export interface TFBusModuleInfo {
  /** CLU serial number (decimal string) that owns this module. */
  cluSerial: string;
  /** RS485 address (1-based, derived from config.txt line order). */
  addr: number;
  /** Module serial number as lowercase hex string (8 chars). */
  serialHex: string;
  /** Module serial number as decimal integer. */
  serial: number;
  /** Hardware type byte. */
  hwType: number;
  /** Firmware type byte. */
  fwType: number;
  /** Firmware version byte. */
  fwVer: number;
  /** IO objects with class and channel info. */
  ios: TFBusIOInfo[];
  /** Convenience shorthand: ios.map(io => io.name). */
  ioNames: string[];
}

export declare function readProjectCipherKey(projectFilePath: string): CipherKey;

export declare function readAllObjects(projectFilePath: string): Map<number, object>;

/**
 * Extract TFBus module list from an OMP project file.
 * RS485 address is inferred from the 1-based line order in each CLU's config.txt
 * (lines after the 7-line CLU header).
 */
export declare function readTFBusModules(projectFilePath: string): TFBusModuleInfo[];
