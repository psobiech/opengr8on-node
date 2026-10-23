import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CipherKey } from '../../dist/CipherKey.js';
import { DiscoverCLUsCommand, hash, getCipherType } from '../../dist/commands/DiscoverCLUsCommand.js';
import { CipherType } from '../../dist/device/CipherType.js';
import { CLUDevice } from '../../dist/device/CLUDevice.js';
import { randomBytes } from '../../dist/util/random.js';
import { RANDOM_ENCRYPTED_BYTES, IV_BYTES, RANDOM_BYTES } from '../../dist/constants.js';

const LOCAL_IP = '192.168.1.50';

function makeRequest() {
  const projectKey = CipherKey.random();
  const randBuf = randomBytes(RANDOM_BYTES);
  const encrypted = projectKey.encrypt(randBuf);
  const iv = projectKey.getIV();
  return { encrypted, iv, randBuf, projectKey };
}

describe('DiscoverCLUsCommand', () => {
  describe('hash', () => {
    it('returns buffer of same length as input', () => {
      const input = Buffer.from([1, 2, 3, 4, 5]);
      const result = hash(input);
      assert.equal(result.length, input.length);
    });

    it('first byte is XOR of first and last input bytes', () => {
      const input = Buffer.from([0x0F, 0x01, 0x02, 0x03, 0xF0]);
      const result = hash(input);
      assert.equal(result[0], (0x0F ^ 0xF0) & 0xFF);
    });

    it('is deterministic', () => {
      const input = Buffer.alloc(30, 0x42);
      assert.ok(hash(input).equals(hash(input)));
    });

    it('produces all byte values in 0-255 range', () => {
      const result = hash(randomBytes(30));
      for (const b of result) assert.ok(b >= 0 && b <= 255);
    });
  });

  describe('getCipherType', () => {
    it('returns PROJECT when encrypted matches derived key', () => {
      const priv = Buffer.alloc(8, 0x42);
      const iv = randomBytes(16);
      const randBuf = randomBytes(RANDOM_BYTES);
      const hashed = hash(randBuf);
      const cluKey = CipherKey.getInitialCipherKey(iv, priv);
      const encrypted = cluKey.encrypt(hashed);
      assert.equal(getCipherType(randBuf, encrypted, iv, priv), CipherType.PROJECT);
    });

    it('returns NONE when privateKey is wrong', () => {
      const priv = Buffer.alloc(8, 0x42);
      const wrongPriv = Buffer.alloc(8, 0xFF);
      const iv = randomBytes(16);
      const randBuf = randomBytes(RANDOM_BYTES);
      const hashed = hash(randBuf);
      const cluKey = CipherKey.getInitialCipherKey(iv, priv);
      const encrypted = cluKey.encrypt(hashed);
      assert.equal(getCipherType(randBuf, encrypted, iv, wrongPriv), CipherType.NONE);
    });

    it('returns UNKNOWN when privateKey is null', () => {
      const iv = randomBytes(16);
      const randBuf = randomBytes(RANDOM_BYTES);
      const hashed = hash(randBuf);
      const cluKey = CipherKey.getInitialCipherKey(iv, Buffer.alloc(8));
      const encrypted = cluKey.encrypt(hashed);
      assert.equal(getCipherType(randBuf, encrypted, iv, null), CipherType.UNKNOWN);
    });
  });

  describe('request', () => {
    it('toBuffer() has correct structure', () => {
      const { encrypted, iv } = makeRequest();
      const cmd = DiscoverCLUsCommand.request(encrypted, iv, LOCAL_IP);
      const buf = cmd.toBuffer();

      // encrypted (32) : iv (16) : req_discovery_clu : ip
      assert.equal(buf.subarray(0, RANDOM_ENCRYPTED_BYTES).length, RANDOM_ENCRYPTED_BYTES);
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES], 0x3A);
      assert.equal(buf.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES).length, IV_BYTES);
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES], 0x3A);
      const rest = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1).toString();
      assert.equal(rest, `req_discovery_clu:${LOCAL_IP}`);
    });

    it('requestMatches() returns true for valid buffer', () => {
      const { encrypted, iv } = makeRequest();
      const buf = DiscoverCLUsCommand.request(encrypted, iv, LOCAL_IP).toBuffer();
      assert.ok(DiscoverCLUsCommand.requestMatches(buf));
    });

    it('requestMatches() returns false for too-short buffer', () => {
      assert.ok(!DiscoverCLUsCommand.requestMatches(Buffer.alloc(10)));
    });

    it('requestMatches() returns false for wrong command', () => {
      const { encrypted, iv } = makeRequest();
      // Change command string after IV
      const buf = DiscoverCLUsCommand.request(encrypted, iv, LOCAL_IP).toBuffer();
      buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1] = 0x58; // 'X'
      assert.ok(!DiscoverCLUsCommand.requestMatches(buf));
    });

    it('requestFromBuffer() parses ipAddress', () => {
      const { encrypted, iv } = makeRequest();
      const buf = DiscoverCLUsCommand.request(encrypted, iv, LOCAL_IP).toBuffer();
      const parsed = DiscoverCLUsCommand.requestFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.ipAddress, LOCAL_IP);
    });

    it('requestFromBuffer() returns null for non-matching buffer', () => {
      assert.equal(DiscoverCLUsCommand.requestFromBuffer(Buffer.alloc(100)), null);
    });
  });

  describe('response', () => {
    const SERIAL = 0x12345678;
    const MAC = 'AABBCCDDEEFF';

    it('toBuffer() has correct structure', () => {
      const iv = randomBytes(16);
      const enc = randomBytes(RANDOM_ENCRYPTED_BYTES);
      const buf = DiscoverCLUsCommand.response(enc, iv, SERIAL, MAC).toBuffer();
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES], 0x3A);
      assert.equal(buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES], 0x3A);
      const rest = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1).toString();
      assert.ok(rest.startsWith('resp_discovery_clu:'), `got: ${rest}`);
      assert.ok(rest.includes(':' + MAC));
    });

    it('serial number is zero-padded 8-char lowercase hex', () => {
      const iv = randomBytes(16);
      const enc = randomBytes(RANDOM_ENCRYPTED_BYTES);
      const buf = DiscoverCLUsCommand.response(enc, iv, 0x1234, MAC).toBuffer();
      const rest = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1).toString();
      assert.ok(rest.includes(':00001234:'), `serial padding: ${rest}`);
    });

    it('responseMatches() returns true for valid buffer', () => {
      const iv = randomBytes(16);
      const enc = randomBytes(RANDOM_ENCRYPTED_BYTES);
      const buf = DiscoverCLUsCommand.response(enc, iv, SERIAL, MAC).toBuffer();
      assert.ok(DiscoverCLUsCommand.responseMatches(buf));
    });

    it('responseFromBuffer() parses all fields', () => {
      const iv = randomBytes(16);
      const enc = randomBytes(RANDOM_ENCRYPTED_BYTES);
      const buf = DiscoverCLUsCommand.response(enc, iv, SERIAL, MAC).toBuffer();
      const parsed = DiscoverCLUsCommand.responseFromBuffer(buf);
      assert.ok(parsed !== null);
      assert.equal(parsed.serialNumber, SERIAL);
      assert.equal(parsed.macAddress, MAC);
      assert.ok(parsed.iv.equals(iv));
      assert.ok(parsed.encrypted.equals(enc));
    });
  });

  describe('parse', () => {
    it('returns CLUDevice with correct fields', () => {
      const priv = randomBytes(8);
      const iv = randomBytes(16);
      const randBuf = randomBytes(RANDOM_BYTES);
      const hashed = hash(randBuf);
      const cluKey = CipherKey.getInitialCipherKey(iv, priv);
      const enc = cluKey.encrypt(hashed);
      const SERIAL = 0xABCD;
      const MAC = '001122334455';

      const responseBuf = DiscoverCLUsCommand.response(enc, iv, SERIAL, MAC).toBuffer();
      const device = DiscoverCLUsCommand.parse(randBuf, '10.0.0.5', responseBuf, { [SERIAL]: priv });

      assert.ok(device instanceof CLUDevice);
      assert.equal(device.serialNumber, SERIAL);
      assert.equal(device.macAddress, MAC);
      assert.equal(device.address, '10.0.0.5');
      assert.equal(device.cipherType, CipherType.PROJECT);
    });

    it('returns null for non-response buffer', () => {
      const result = DiscoverCLUsCommand.parse(randomBytes(RANDOM_BYTES), '10.0.0.1', Buffer.alloc(100), {});
      assert.equal(result, null);
    });

    it('sets cipherType UNKNOWN when no privateKey provided', () => {
      const iv = randomBytes(16);
      const enc = randomBytes(RANDOM_ENCRYPTED_BYTES);
      const SERIAL = 0x1111;
      const buf = DiscoverCLUsCommand.response(enc, iv, SERIAL, '001122334455').toBuffer();
      const device = DiscoverCLUsCommand.parse(randomBytes(RANDOM_BYTES), '10.0.0.1', buf, {});
      assert.equal(device.cipherType, CipherType.UNKNOWN);
    });
  });
});
