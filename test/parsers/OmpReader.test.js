import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readProjectCipherKey, readAllObjects } from '../../dist/parsers/omp/OmpReader.js';
import { CipherKey } from '../../dist/CipherKey.js';

const TEST_OMP = new URL('../../../opengr8on/modules/parsers/src/test/resources/test.omp', import.meta.url).pathname;

describe('OmpReader', () => {
  describe('readProjectCipherKey', () => {
    it('returns CipherKey with correct key bytes', () => {
      const ck = readProjectCipherKey(TEST_OMP);
      assert.ok(ck instanceof CipherKey);
      assert.ok(ck.getSecretKey().equals(Buffer.from('vd/TDJU8awHhOBn6h3YsxQ==', 'base64')));
      assert.ok(ck.getIV().equals(Buffer.from('oykoaQgbuuhYOnE9CUdrnQ==', 'base64')));
    });

    it('throws for nonexistent file', () => {
      assert.throws(() => readProjectCipherKey('/nonexistent/path.omp'));
    });
  });

  describe('readAllObjects', () => {
    it('returns a Map', () => {
      const result = readAllObjects(TEST_OMP);
      assert.ok(result instanceof Map);
    });

    it('map has entries', () => {
      const result = readAllObjects(TEST_OMP);
      assert.ok(result.size > 0, `expected entries, got size ${result.size}`);
    });
  });
});
