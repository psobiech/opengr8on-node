import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as module from 'node:module';
import * as client from '../dist/client-entry.js';

const HEAVY = /^(serialport|@serialport\/|wasmoon|mqtt|@modelcontextprotocol\/)/;

describe('client entry (opengr8on-node/client)', () => {
  it('exports the client API', () => {
    for (const name of ['CLUClient', 'CipherKey', 'CLUDevice', 'CLUFiles', 'TFTPClient', 'DiscoverCLUsCommand',
      'InterfaceRegistry', 'readAllObjects', 'readProjectCipherKey', 'readProjectClus', 'getLocalIPv4Interfaces']) {
      assert.ok(client[name], `missing export ${name}`);
    }
  });

  it('does not load tfbus/vclu/mcp dependencies', { skip: typeof module.registerHooks !== 'function' && 'needs module.registerHooks (Node >= 22.15)' }, () => {
    const load = (file) => {
      const url = new URL(file, import.meta.url).href;
      const code = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(spec, ctx, next) {
        if (${HEAVY}.test(spec)) throw new Error('heavy dependency loaded: ' + spec);
        return next(spec, ctx);
      } });
      await import(${JSON.stringify(url)});
    `;
      execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
    };
    load('../dist/client-entry.js');
    // control: the root index does pull them in, so the hook really fires
    assert.throws(() => load('../dist/index.js'), /heavy dependency loaded/);
  });
});
