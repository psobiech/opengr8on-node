import type { TLVRecord } from './StatusPollResponse.js';

export declare function decodeValue(type: number, data: Buffer): string;
export declare function decodeTlvRecord(record: TLVRecord): string;
