import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLUDevice } from '../../dist/device/CLUDevice.js';
import { CipherKey } from '../../dist/CipherKey.js';
import { CipherType } from '../../dist/device/CipherType.js';
import { randomBytes } from '../../dist/util/random.js';

describe('CipherType', () => {
  it('has expected values', () => {
    assert.equal(CipherType.NONE, 'NONE');
    assert.equal(CipherType.PROJECT, 'PROJECT');
    assert.equal(CipherType.UNKNOWN, 'UNKNOWN');
  });

  it('is frozen', () => {
    assert.throws(() => { CipherType.NEW = 'NEW'; });
  });
});

describe('CLUDevice', () => {
  const SERIAL = 0xABCD1234;
  const MAC = 'AABBCCDDEEFF';
  const ADDRESS = '192.168.1.50';
  const iv = randomBytes(16);
  const privateKey = randomBytes(8);

  describe('constructor', () => {
    it('stores fields', () => {
      const device = new CLUDevice({ serialNumber: SERIAL, macAddress: MAC, address: ADDRESS });
      assert.equal(device.serialNumber, SERIAL);
      assert.equal(device.macAddress, MAC);
      assert.equal(device.address, ADDRESS);
      assert.equal(device.cipherType, CipherType.UNKNOWN);
    });

    it('strips colons from macAddress', () => {
      const device = new CLUDevice({ macAddress: 'AA:BB:CC:DD:EE:FF' });
      assert.equal(device.macAddress, 'AABBCCDDEEFF');
    });

    it('default cipherType is UNKNOWN', () => {
      const device = new CLUDevice({});
      assert.equal(device.cipherType, CipherType.UNKNOWN);
    });

    it('default port is 1234', () => {
      const device = new CLUDevice({});
      assert.equal(device.port, 1234);
    });

    it('accepts Buffer iv and privateKey', () => {
      const device = new CLUDevice({ iv, privateKey });
      assert.ok(device.iv.equals(iv));
      assert.ok(device.privateKey.equals(privateKey));
    });
  });

  describe('getCipherKey', () => {
    it('returns null when iv or privateKey missing', () => {
      const device = new CLUDevice({ address: ADDRESS });
      assert.equal(device.getCipherKey(), null);
    });

    it('returns CipherKey derived from iv + privateKey', () => {
      const device = new CLUDevice({ iv, privateKey });
      const cipherKey = device.getCipherKey();
      assert.ok(cipherKey instanceof CipherKey);
      const expected = CipherKey.getInitialCipherKey(iv, privateKey);
      assert.ok(cipherKey.getSecretKey().equals(expected.getSecretKey()));
      assert.ok(cipherKey.getIV().equals(expected.getIV()));
    });

    it('caches the result', () => {
      const device = new CLUDevice({ iv, privateKey });
      const ck1 = device.getCipherKey();
      const ck2 = device.getCipherKey();
      assert.equal(ck1, ck2);
    });
  });

  describe('setCipherKey', () => {
    it('overrides derived key', () => {
      const device = new CLUDevice({ iv, privateKey });
      const override = CipherKey.random();
      device.setCipherKey(override);
      assert.equal(device.getCipherKey(), override);
    });
  });

  describe('setAddress', () => {
    it('updates address', () => {
      const device = new CLUDevice({ address: ADDRESS });
      device.setAddress('10.0.0.99');
      assert.equal(device.address, '10.0.0.99');
    });
  });
});
