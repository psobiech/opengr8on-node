import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLUDevice } from '../../src/device/CLUDevice.js';
import { CipherKey } from '../../src/CipherKey.js';
import { CipherType } from '../../src/device/CipherType.js';
import { randomBytes } from '../../src/util/random.js';

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
      const d = new CLUDevice({ serialNumber: SERIAL, macAddress: MAC, address: ADDRESS });
      assert.equal(d.serialNumber, SERIAL);
      assert.equal(d.macAddress, MAC);
      assert.equal(d.address, ADDRESS);
      assert.equal(d.cipherType, CipherType.UNKNOWN);
    });

    it('strips colons from macAddress', () => {
      const d = new CLUDevice({ macAddress: 'AA:BB:CC:DD:EE:FF' });
      assert.equal(d.macAddress, 'AABBCCDDEEFF');
    });

    it('default cipherType is UNKNOWN', () => {
      const d = new CLUDevice({});
      assert.equal(d.cipherType, CipherType.UNKNOWN);
    });

    it('default port is 1234', () => {
      const d = new CLUDevice({});
      assert.equal(d.port, 1234);
    });

    it('accepts Buffer iv and privateKey', () => {
      const d = new CLUDevice({ iv, privateKey });
      assert.ok(d.iv.equals(iv));
      assert.ok(d.privateKey.equals(privateKey));
    });
  });

  describe('getCipherKey', () => {
    it('returns null when iv or privateKey missing', () => {
      const d = new CLUDevice({ address: ADDRESS });
      assert.equal(d.getCipherKey(), null);
    });

    it('returns CipherKey derived from iv + privateKey', () => {
      const d = new CLUDevice({ iv, privateKey });
      const ck = d.getCipherKey();
      assert.ok(ck instanceof CipherKey);
      const expected = CipherKey.getInitialCipherKey(iv, privateKey);
      assert.ok(ck.getSecretKey().equals(expected.getSecretKey()));
      assert.ok(ck.getIV().equals(expected.getIV()));
    });

    it('caches the result', () => {
      const d = new CLUDevice({ iv, privateKey });
      const ck1 = d.getCipherKey();
      const ck2 = d.getCipherKey();
      assert.equal(ck1, ck2);
    });
  });

  describe('setCipherKey', () => {
    it('overrides derived key', () => {
      const d = new CLUDevice({ iv, privateKey });
      const override = CipherKey.random();
      d.setCipherKey(override);
      assert.equal(d.getCipherKey(), override);
    });
  });

  describe('setAddress', () => {
    it('updates address', () => {
      const d = new CLUDevice({ address: ADDRESS });
      d.setAddress('10.0.0.99');
      assert.equal(d.address, '10.0.0.99');
    });
  });
});
