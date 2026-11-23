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

export const DiscoverCLUsCommand = {
  request(encrypted: Buffer, iv: Buffer, localAddress: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(encrypted, ':', iv, ':', REQUEST_CMD, ':', localAddress);
      },
    };
  },

  requestFromBuffer(buffer: Buffer): { encrypted: Buffer; iv: Buffer; ipAddress: string } | null {
    if (!DiscoverCLUsCommand.requestMatches(buffer)) return null;
    const encrypted = buffer.subarray(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buffer.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const rest = asString(buffer, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1);
    const parts = splitExact(rest, ':', 2);
    if (!parts) return null;
    return { encrypted, iv, ipAddress: parts[1] };
  },

  requestMatches(buffer: Buffer): boolean {
    const minLength = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1 + MIN_IP_CHARACTERS;
    if (buffer.length < minLength) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buffer, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, REQUEST_CMD.length) === REQUEST_CMD;
  },

  parse(randomBuf: Buffer, fromAddress: string, decryptedBuf: Buffer, privateKeys: Record<number, Buffer> = {}): CLUDevice | null {
    const response = DiscoverCLUsCommand.responseFromBuffer(decryptedBuf);
    if (!response) return null;
    const privateKey = privateKeys[response.serialNumber] ?? null;
    const cipherType = getCipherType(randomBuf, response.encrypted, response.iv, privateKey);
    return new CLUDevice({
      serialNumber: response.serialNumber,
      macAddress: response.macAddress,
      address: fromAddress,
      cipherType,
      iv: response.iv,
      privateKey,
    });
  },

  responseFromBuffer(buffer: Buffer): { encrypted: Buffer; iv: Buffer; serialNumber: number; macAddress: string } | null {
    if (!DiscoverCLUsCommand.responseMatches(buffer)) return null;
    const encrypted = buffer.subarray(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buffer.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const rest = asString(buffer, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1);
    const parts = splitExact(rest, ':', 3);
    if (!parts) return null;
    return {
      encrypted,
      iv,
      serialNumber: hexToNumber(parts[1]),
      macAddress: parts[2],
    };
  },

  responseMatches(buffer: Buffer): boolean {
    const minLength = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + RESPONSE_CMD.length + 1 + MIN_SERIAL_NUMBER_CHARACTERS + 1 + MAC_CHARACTERS;
    if (buffer.length < minLength) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buffer[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buffer, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, RESPONSE_CMD.length) === RESPONSE_CMD;
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

export function getCipherType(randomBuf: Buffer, encrypted: Buffer, iv: Buffer, privateKey: Buffer | null): CipherTypeValue {
  if (!privateKey) return CipherType.UNKNOWN;
  const randomBytesHash = hash(randomBuf);
  const randomEncrypted = CipherKey.getInitialCipherKey(iv, privateKey).encrypt(randomBytesHash);
  return randomEncrypted.equals(encrypted) ? CipherType.PROJECT : CipherType.NONE;
}

export function hash(input: Buffer): Buffer {
  const result = Buffer.alloc(input.length);
  // OM / the CLU compute this on Java signed bytes (-5 % 13 === -5), not unsigned ones.
  const toSignedByte = (value: number) => (value << 24) >> 24;
  let previous = toSignedByte((result[0] = (input[0] ^ input[input.length - 1]) & 0xFF));
  for (let i = 1; i < input.length; i++) {
    const previousRemainder = previous % HASH_MOD_A;
    const currentRemainder = toSignedByte(input[i]) % HASH_MOD_B;
    previous = toSignedByte((result[i] = ((previousRemainder + 1) * (currentRemainder + 1)) & 0xFF));
  }
  return result;
}
