import { CipherKey } from '../CipherKey.js';
import { CLUDevice } from '../device/CLUDevice.js';
import { CipherType, type CipherTypeValue } from '../device/CipherType.js';
import { toHexString, hexToNumber } from '../util/hex.js';
import { serializeCommand, asString, splitExact } from './serialize.js';
import {
  RANDOM_ENCRYPTED_BYTES,
  IV_BYTES,
  MIN_IP_CHARACTERS,
  MIN_SERIAL_NUMBER_CHARACTERS,
  MAX_SERIAL_NUMBER_CHARACTERS,
  MAC_CHARACTERS,
} from '../constants.js';

const HASH_MOD_A = 0x0D;
const HASH_MOD_B = 0x13;
const REQUEST_CMD = 'req_discovery_clu';
const RESPONSE_CMD = 'resp_discovery_clu';

export function hash(buf: Buffer): Buffer {
  const result = Buffer.alloc(buf.length);
  let prev = (result[0] = (buf[0] ^ buf[buf.length - 1]) & 0xFF);
  for (let i = 1; i < buf.length; i++) {
    const a = prev % HASH_MOD_A;
    const b = buf[i] % HASH_MOD_B;
    prev = (result[i] = ((a + 1) * (b + 1)) & 0xFF);
  }
  return result;
}

export function getCipherType(randomBuf: Buffer, encrypted: Buffer, iv: Buffer, privateKey: Buffer | null): CipherTypeValue {
  if (!privateKey) return CipherType.UNKNOWN;
  const randomBytesHash = hash(randomBuf);
  const randomEncrypted = CipherKey.getInitialCipherKey(iv, privateKey).encrypt(randomBytesHash);
  return randomEncrypted.equals(encrypted) ? CipherType.PROJECT : CipherType.NONE;
}

export const DiscoverCLUsCommand = {
  request(encrypted: Buffer, iv: Buffer, localAddress: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(encrypted, ':', iv, ':', REQUEST_CMD, ':', localAddress);
      },
    };
  },

  requestMatches(buf: Buffer): boolean {
    const minLen = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1 + MIN_IP_CHARACTERS;
    if (buf.length < minLen) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf: Buffer): { encrypted: Buffer; iv: Buffer; ipAddress: string } | null {
    if (!DiscoverCLUsCommand.requestMatches(buf)) return null;
    const encrypted = buf.subarray(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const rest = asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1);
    const parts = splitExact(rest, ':', 2);
    if (!parts) return null;
    return { encrypted, iv, ipAddress: parts[1] };
  },

  responseMatches(buf: Buffer): boolean {
    const minLen = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + RESPONSE_CMD.length + 1 + MIN_SERIAL_NUMBER_CHARACTERS + 1 + MAC_CHARACTERS;
    if (buf.length < minLen) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf: Buffer): { encrypted: Buffer; iv: Buffer; serialNumber: number; macAddress: string } | null {
    if (!DiscoverCLUsCommand.responseMatches(buf)) return null;
    const encrypted = buf.subarray(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const rest = asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1);
    const parts = splitExact(rest, ':', 3);
    if (!parts) return null;
    return {
      encrypted,
      iv,
      serialNumber: hexToNumber(parts[1]),
      macAddress: parts[2],
    };
  },

  parse(randomBuf: Buffer, fromAddress: string, decryptedBuf: Buffer, privateKeys: Record<number, Buffer> = {}): CLUDevice | null {
    const resp = DiscoverCLUsCommand.responseFromBuffer(decryptedBuf);
    if (!resp) return null;
    const privateKey = privateKeys[resp.serialNumber] ?? null;
    const cipherType = getCipherType(randomBuf, resp.encrypted, resp.iv, privateKey);
    return new CLUDevice({
      serialNumber: resp.serialNumber,
      macAddress: resp.macAddress,
      address: fromAddress,
      cipherType,
      iv: resp.iv,
      privateKey,
    });
  },

  response(encrypted: Buffer, iv: Buffer, serialNumber: number, macAddress: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(
          encrypted, ':',
          iv, ':',
          RESPONSE_CMD, ':',
          toHexString(serialNumber, MAX_SERIAL_NUMBER_CHARACTERS), ':',
          macAddress,
        );
      },
    };
  },
};
