export { BROADCAST } from './TFBusFrame.js';

export interface TLVRecord {
  type: number;
  meta: number;
  data: Buffer;
}

export declare function resetFrame(dest?: number): Buffer;
export declare function seekFrame(): Buffer;
export declare function addrAssignFrame(serialNumber: number, channel: number): Buffer;
export declare function statusPollFrame(dest: number): Buffer;
export declare function versionQueryFrame(dest: number): Buffer;
export declare function forceGetStatusFrame(): Buffer;
export declare function provisionFrame(dest: number, keyType: number, serialNumber: number, key?: Buffer): Buffer;
export declare function addrConfirmFrame(dest: number): Buffer;

export declare const LedCmd: {
  readonly SHOW_OK: 0x00;
  readonly SHOW_ERROR: 0x01;
  readonly LED_SWITCH_ON: 0x02;
  readonly LED_SWITCH_OFF: 0x04;
  readonly RED_LED_SWITCH_ON: 0x10;
};

export declare function ledCmdFrame(dest: number, buttonMask: number, cmd: number): Buffer;
export declare function activateRecord(level: number): TLVRecord;
export declare function deactivateRecord(val: number): TLVRecord;
export declare function setOutputRecord(chanMask: number, valLo?: number, valHi?: number): TLVRecord;
export declare function setRampTimeRecord(timeMs: number): TLVRecord;
export declare function dimmerSetValueRecord(value: number): TLVRecord;
export declare function setPositionRecord(flags: number, channel: number, targetPct: number): TLVRecord;
export declare function featureParamRecord(idx: number, channel: number, val: number): TLVRecord;
export declare function channelMapRecord(chanId: number, objType: number): TLVRecord;
export declare function moduleParamRecord(chanIdx: number, ioDir: number): TLVRecord;
export declare function channelInitRecord(chanType: number, chanIdx: number): TLVRecord;
export declare function setChannelValueRecord(chanIdx: number, value: number): TLVRecord;
export declare function sensorSensitivityRecord(sensorId: number, threshold10: number, sensitivity100ms: number): TLVRecord;
export declare function buttonHoldDelayRecord(delayMs: number): TLVRecord;
export declare function setModeRecord(mode: number): TLVRecord;
export declare function rollerChanRegRecord(channel1Based: number): TLVRecord;
export declare function moduleCmdFrame(dest: number, records: TLVRecord[]): Buffer;
export declare function tfbusCmdPayload(cmd: number, data?: Buffer | number[]): Buffer;
export declare function checkAliveFrame(dest: number): Buffer;
export declare function resetTFBusCmdFrame(dest: number, code?: number): Buffer;
export declare function printTextFrame(dest: number, x: number, y: number, font: number, text: string): Buffer;
export declare function buzzerBeepFrame(dest: number, freq: number, duration: number, volume: number): Buffer;
export declare function drawFrame(dest: number): Buffer;
export declare function rgbwSetFrame(dest: number, w: number, r: number, g: number, b: number, channelIdx: number): Buffer;
export declare function respCheckAliveFrame(dest: number, arg?: number): Buffer;
export declare function forceGetStatusTFBusCmdFrame(dest: number): Buffer;
export declare function seekBcastFrame(dest: number, hwType: number, fwType: number, name?: string): Buffer;
export declare function seekResponseFrame(dest: number, hwType: number, fwType: number, name?: string): Buffer;
export declare function setFeatureFrame(dest: number, featureId: number): Buffer;
export declare function execMethodFrame(dest: number, methodId: number): Buffer;
export declare function itemSensitivityFrame(dest: number, sensitivityClass: number, data?: Buffer): Buffer;
export declare function rgbwSetAltFrame(dest: number, a: number, b: number, c: number, d: number, e: number): Buffer;
