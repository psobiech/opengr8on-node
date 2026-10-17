import { CipherType } from './CipherType.js';
import { CipherKey } from '../CipherKey.js';

export class CLUDevice {
  constructor({ serialNumber, macAddress, address, port = 1234, cipherType = CipherType.UNKNOWN, iv, privateKey } = {}) {
    this.serialNumber = serialNumber ?? null;
    this.macAddress = macAddress ? macAddress.replace(/:/g, '') : null;
    this.address = address ?? null;
    this.port = port;
    this.cipherType = cipherType;
    this.iv = iv ? (Buffer.isBuffer(iv) ? iv : Buffer.from(iv)) : null;
    this.privateKey = privateKey ? (Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey)) : null;
    this._cipherKey = null;
  }

  getCipherKey() {
    if (this._cipherKey) return this._cipherKey;
    if (this.iv && this.privateKey) {
      this._cipherKey = CipherKey.getInitialCipherKey(this.iv, this.privateKey);
    }
    return this._cipherKey;
  }

  setCipherKey(cipherKey) {
    this._cipherKey = cipherKey;
  }

  setAddress(address) {
    this.address = address;
  }

  toString() {
    return `CLUDevice{sn=${this.serialNumber?.toString(16)}, mac=${this.macAddress}, addr=${this.address}, cipher=${this.cipherType}}`;
  }
}
