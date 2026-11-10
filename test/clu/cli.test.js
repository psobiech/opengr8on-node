import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseCluCliArgs, localNameFor } from '../../dist/clu/cli.js';

const base = ['--omp-file', 'p.omp', '--local-address', '192.168.0.110'];

describe('parseCluCliArgs', () => {
  it('parses refresh; --wait defaults to 30 s like OM', () => {
    const a = parseCluCliArgs([...base, 'refresh', 'CLU_2', '--delay', '3000']);
    assert.equal(a.command, 'refresh');
    assert.equal(a.delayMs, 3000);
    assert.equal(a.waitMs, 30000);
    assert.equal(parseCluCliArgs([...base, 'refresh', 'CLU_2', '--wait', '5000']).waitMs, 5000);
  });

  it('parses reset with delay and wait', () => {
    const a = parseCluCliArgs([...base, 'reset', 'CLU_2', '--delay', '5000', '--wait', '30000']);
    assert.equal(a.command, 'reset');
    assert.equal(a.clu, 'CLU_2');
    assert.equal(a.delayMs, 5000);
    assert.equal(a.waitMs, 30000);
    assert.equal(a.cluPort, 1234);
    assert.equal(a.ompFile, resolve('p.omp'));
  });

  it('parses fetch with several remote files and an output dir', () => {
    const a = parseCluCliArgs([...base, 'fetch', '0d2c5916', 'a:\\OM.LUA', 'a:\\USER.LUA', '--out', 'dl']);
    assert.deepEqual(a.files, ['a:\\OM.LUA', 'a:\\USER.LUA']);
    assert.equal(a.outDir, resolve('dl'));
  });

  it('list needs no local address or CLU', () => {
    assert.equal(parseCluCliArgs(['--omp-file', 'p.omp', 'list']).command, 'list');
  });

  it('rejects bad input', () => {
    assert.throws(() => parseCluCliArgs(base), /missing command/);
    assert.throws(() => parseCluCliArgs([...base, 'reboot', 'CLU_2']), /unknown command/);
    assert.throws(() => parseCluCliArgs(['--local-address', '1.2.3.4', 'alive', 'X']), /--omp-file/);
    assert.throws(() => parseCluCliArgs(['--omp-file', 'p.omp', 'reset', 'X']), /--local-address/);
    assert.throws(() => parseCluCliArgs([...base, 'reset']), /<clu> required/);
    assert.throws(() => parseCluCliArgs([...base, 'fetch', 'CLU_2']), /remote file/);
    assert.throws(() => parseCluCliArgs([...base, 'reset', 'CLU_2', '--delay', 'soon']), /--delay/);
  });
});

describe('localNameFor', () => {
  it('strips the drive and directories of a CLU path', () => {
    assert.equal(localNameFor('a:\\OM.LUA'), 'OM.LUA');
    assert.equal(localNameFor('a:/sub/USER.LUA'), 'USER.LUA');
    assert.equal(localNameFor('CONFIG.JSON'), 'CONFIG.JSON');
  });
});
