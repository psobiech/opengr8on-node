import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLUClient } from '../../dist/CLUClient.js';
import { CLUDevice } from '../../dist/device/CLUDevice.js';
import { CipherKey } from '../../dist/CipherKey.js';

/** CLUClient whose request returns a fixed (already decrypted) answer. */
function clientAnswering(answer) {
  const c = new CLUClient('127.0.0.1', new CLUDevice({ serialNumber: 1, address: '127.0.0.2' }), new CipherKey(Buffer.alloc(16, 1), Buffer.alloc(16, 2)));
  c._request = async () => (answer === null ? null : Buffer.from(answer));
  return c;
}

describe('CLUClient.startTFTPdServer', () => {
  it('true on resp:OK, false when refused (resp:ERROR, CLU in lockdown), null without an answer', async () => {
    assert.equal(await clientAnswering('resp:OK').startTFTPdServer(), true);
    assert.equal(await clientAnswering('resp:ERROR').startTFTPdServer(), false);
    assert.equal(await clientAnswering(null).startTFTPdServer(), null);
  });
});
