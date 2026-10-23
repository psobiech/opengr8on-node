import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Storage, STORAGE_FEATURES, STORAGE_METHODS } from '../../dist/vclu/Storage.js';

describe('Storage', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = join(tmpdir(), `vclu-storage-test-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('INDEX is 44', () => assert.equal(Storage.INDEX, 44));

  describe('getVar / setVar / getVarNames', () => {
    it('getVar returns null for unknown key', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'a'));
      assert.equal(s.getVar('unknown'), null);
      s.close();
    });

    it('setVar then getVar round-trips', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'b'));
      s.setVar('x', 42);
      assert.equal(s.getVar('x'), 42);
      s.close();
    });

    it('setVar with string', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'c'));
      s.setVar('name', 'hello');
      assert.equal(s.getVar('name'), 'hello');
      s.close();
    });

    it('setVar with boolean', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'd'));
      s.setVar('flag', true);
      assert.equal(s.getVar('flag'), true);
      s.close();
    });

    it('setVar overwrites existing', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'e'));
      s.setVar('x', 1);
      s.setVar('x', 2);
      assert.equal(s.getVar('x'), 2);
      s.close();
    });

    it('getVarNames returns all keys', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'f'));
      s.setVar('a', 1);
      s.setVar('b', 2);
      s.setVar('c', 3);
      const names = s.getVarNames();
      assert.ok(names.includes('a'));
      assert.ok(names.includes('b'));
      assert.ok(names.includes('c'));
      assert.equal(names.length, 3);
      s.close();
    });
  });

  describe('persist (STORE method)', () => {
    it('writes JSON file on STORE', () => {
      const dir = join(tmpRoot, 'g');
      const s = new Storage(null, 'S', dir);
      s.setVar('key', 'value');
      s.setVar('num', 123);
      s.execute(STORAGE_METHODS.STORE);
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.equal(content.key, 'value');
      assert.equal(content.num, 123);
      s.close();
    });

    it('STORE returns null', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'h'));
      assert.equal(s.execute(STORAGE_METHODS.STORE), null);
      s.close();
    });
  });

  describe('restore (setup)', () => {
    it('reads back values from previously written file', () => {
      const dir = join(tmpRoot, 'i');
      const s1 = new Storage(null, 'S1', dir);
      s1.setVar('count', 99);
      s1.setVar('name', 'test');
      s1.execute(STORAGE_METHODS.STORE);
      s1.close();

      const s2 = new Storage(null, 'S2', dir);
      s2.setup(); // triggers restore
      assert.equal(s2.getVar('count'), 99);
      assert.equal(s2.getVar('name'), 'test');
      s2.close();
    });

    it('no file → no error on setup', () => {
      const dir = join(tmpRoot, 'j');
      const s = new Storage(null, 'S', dir);
      assert.doesNotThrow(() => s.setup());
      s.close();
    });
  });

  describe('ERASE_ALL', () => {
    it('clears in-memory variables', () => {
      const dir = join(tmpRoot, 'k');
      const s = new Storage(null, 'S', dir);
      s.setVar('x', 1);
      s.execute(STORAGE_METHODS.ERASE_ALL);
      assert.equal(s.getVar('x'), null);
      s.close();
    });

    it('writes empty {} to file', () => {
      const dir = join(tmpRoot, 'l');
      const s = new Storage(null, 'S', dir);
      s.setVar('x', 1);
      s.execute(STORAGE_METHODS.STORE);
      s.execute(STORAGE_METHODS.ERASE_ALL);
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.deepEqual(content, {});
      s.close();
    });

    it('ERASE_ALL returns null', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'm'));
      assert.equal(s.execute(STORAGE_METHODS.ERASE_ALL), null);
      s.close();
    });
  });

  describe('STORAGE_UTILIZATION', () => {
    it('starts at 0', () => {
      const s = new Storage(null, 'S', join(tmpRoot, 'n'));
      assert.equal(s.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 0);
      s.close();
    });

    it('updates after STORE', () => {
      const dir = join(tmpRoot, 'o');
      const s = new Storage(null, 'S', dir);
      s.setVar('a', 1);
      s.setVar('b', 2);
      s.execute(STORAGE_METHODS.STORE);
      assert.equal(s.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 2);
      s.close();
    });

    it('resets to 0 after ERASE_ALL', () => {
      const dir = join(tmpRoot, 'p');
      const s = new Storage(null, 'S', dir);
      s.setVar('a', 1);
      s.execute(STORAGE_METHODS.STORE);
      s.execute(STORAGE_METHODS.ERASE_ALL);
      assert.equal(s.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 0);
      s.close();
    });
  });

  describe('close', () => {
    it('persists on close', () => {
      const dir = join(tmpRoot, 'q');
      const s = new Storage(null, 'S', dir);
      s.setVar('final', 'saved');
      s.close();
      assert.ok(existsSync(join(dir, 'storage.json')));
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.equal(content.final, 'saved');
    });
  });
});
