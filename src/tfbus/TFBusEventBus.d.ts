import { EventEmitter } from 'node:events';
import type { TFBusTransport } from './transport/SerialTransport.js';
import type { TLVRecord } from './StatusPollResponse.js';

export interface FrameEvent { buf: Buffer; dir: 'tx' | 'rx'; }
export interface StatusEvent { addr: number; records: TLVRecord[] | null; raw: Buffer; }
export interface VersionEvent { addr: number; version: object | null; raw: Buffer; }
export interface ButtonEvent { addr: number; buttonIndex: number; eventId: number; data: Buffer; }
export interface AckEvent { addr: number; }
export interface ResponseEvent { addr: number; txType: number; records: TLVRecord[] | null; raw: Buffer; }

export interface TFBusEventBusEvents {
  frame:    (e: FrameEvent) => void;
  status:   (e: StatusEvent) => void;
  version:  (e: VersionEvent) => void;
  button:   (e: ButtonEvent) => void;
  ack:      (e: AckEvent) => void;
  response: (e: ResponseEvent) => void;
  error:    (err: Error) => void;
}

export declare class TFBusEventBus extends EventEmitter {
  constructor(transport: TFBusTransport);
  get transport(): TFBusTransport;
  /** Start the dequeue loop. Idempotent. */
  start(): this;
  /** Stop the dequeue loop. */
  stop(): this;
  /** Enqueue a frame for transmission. */
  send(buf: Buffer): this;
  /**
   * Send buf to dest and wait for the module's response.
   * Syncs on the TX echo then returns the first RX frame.
   * Returns null on timeout.
   */
  request(dest: number, buf: Buffer, timeoutMs?: number): Promise<Buffer | null>;
}
