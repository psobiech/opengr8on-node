import { CipherType, type CipherTypeValue } from './CipherType.js';
import { CipherKey } from '../CipherKey.js';

export interface CLUDeviceOptions {
  serialNumber?: number | null;
  macAddress?: string | null;
  address?: string | null;
  port?: number;
  cipherType?: CipherTypeValue;
  iv?: Buffer | string | null;
  privateKey?: Buffer | string | null;
}

export class CLUDevice {
  serialNumber: number | null;
  macAddress: string | null;
  address: string | null;
  port: number;
  cipherType: CipherTypeValue;
  iv: Buffer | null;
  privateKey: Buffer | null;
  private _cipherKey: CipherKey | null;

  constructor({
    serialNumber,
    macAddress,
    address,
    port = 1234,
    cipherType = CipherType.UNKNOWN,
    iv,
    privateKey,
  }: CLUDeviceOptions = {}) {
    this.serialNumber = serialNumber ?? null;
    this.macAddress = macAddress ? macAddress.replace(/:/g, '') : null;
    this.address = address ?? null;
    this.port = port;
    this.cipherType = cipherType;
    this.iv = iv ? (Buffer.isBuffer(iv) ? iv : Buffer.from(iv)) : null;
    this.privateKey = privateKey ? (Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey)) : null;
    this._cipherKey = null;
  }

  getCipherKey(): CipherKey | null {
    if (this._cipherKey) return this._cipherKey;
    if (this.iv && this.privateKey) {
      this._cipherKey = CipherKey.getInitialCipherKey(this.iv, this.privateKey);
    }
    return this._cipherKey;
  }

  setCipherKey(cipherKey: CipherKey): void {
    this._cipherKey = cipherKey;
  }

  setAddress(address: string): void {
    this.address = address;
  }

  toString(): string {
    return `CLUDevice{sn=${this.serialNumber?.toString(16)}, mac=${this.macAddress}, addr=${this.address}, cipher=${this.cipherType}}`;
  }
}
