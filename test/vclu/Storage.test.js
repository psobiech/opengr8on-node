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
      const storage = new Storage(null, 'S', join(tmpRoot, 'a'));
      assert.equal(storage.getVar('unknown'), null);
      storage.close();
    });

    it('setVar then getVar round-trips', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'b'));
      storage.setVar('x', 42);
      assert.equal(storage.getVar('x'), 42);
      storage.close();
    });

    it('setVar with string', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'c'));
      storage.setVar('name', 'hello');
      assert.equal(storage.getVar('name'), 'hello');
      storage.close();
    });

    it('setVar with boolean', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'd'));
      storage.setVar('flag', true);
      assert.equal(storage.getVar('flag'), true);
      storage.close();
    });

    it('setVar overwrites existing', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'e'));
      storage.setVar('x', 1);
      storage.setVar('x', 2);
      assert.equal(storage.getVar('x'), 2);
      storage.close();
    });

    it('getVarNames returns all keys', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'f'));
      storage.setVar('a', 1);
      storage.setVar('b', 2);
      storage.setVar('c', 3);
      const names = storage.getVarNames();
      assert.ok(names.includes('a'));
      assert.ok(names.includes('b'));
      assert.ok(names.includes('c'));
      assert.equal(names.length, 3);
      storage.close();
    });
  });

  describe('persist (STORE method)', () => {
    it('writes JSON file on STORE', () => {
      const dir = join(tmpRoot, 'g');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('key', 'value');
      storage.setVar('num', 123);
      storage.execute(STORAGE_METHODS.STORE);
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.equal(content.key, 'value');
      assert.equal(content.num, 123);
      storage.close();
    });

    it('STORE returns null', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'h'));
      assert.equal(storage.execute(STORAGE_METHODS.STORE), null);
      storage.close();
    });
  });

  describe('restore (setup)', () => {
    it('reads back values from previously written file', () => {
      const dir = join(tmpRoot, 'i');
      const firstStorage = new Storage(null, 'S1', dir);
      firstStorage.setVar('count', 99);
      firstStorage.setVar('name', 'test');
      firstStorage.execute(STORAGE_METHODS.STORE);
      firstStorage.close();

      const secondStorage = new Storage(null, 'S2', dir);
      secondStorage.setup(); // triggers restore
      assert.equal(secondStorage.getVar('count'), 99);
      assert.equal(secondStorage.getVar('name'), 'test');
      secondStorage.close();
    });

    it('no file → no error on setup', () => {
      const dir = join(tmpRoot, 'j');
      const storage = new Storage(null, 'S', dir);
      assert.doesNotThrow(() => storage.setup());
      storage.close();
    });
  });

  describe('ERASE_ALL', () => {
    it('clears in-memory variables', () => {
      const dir = join(tmpRoot, 'k');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('x', 1);
      storage.execute(STORAGE_METHODS.ERASE_ALL);
      assert.equal(storage.getVar('x'), null);
      storage.close();
    });

    it('writes empty {} to file', () => {
      const dir = join(tmpRoot, 'l');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('x', 1);
      storage.execute(STORAGE_METHODS.STORE);
      storage.execute(STORAGE_METHODS.ERASE_ALL);
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.deepEqual(content, {});
      storage.close();
    });

    it('ERASE_ALL returns null', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'm'));
      assert.equal(storage.execute(STORAGE_METHODS.ERASE_ALL), null);
      storage.close();
    });
  });

  describe('STORAGE_UTILIZATION', () => {
    it('starts at 0', () => {
      const storage = new Storage(null, 'S', join(tmpRoot, 'n'));
      assert.equal(storage.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 0);
      storage.close();
    });

    it('updates after STORE', () => {
      const dir = join(tmpRoot, 'o');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('a', 1);
      storage.setVar('b', 2);
      storage.execute(STORAGE_METHODS.STORE);
      assert.equal(storage.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 2);
      storage.close();
    });

    it('resets to 0 after ERASE_ALL', () => {
      const dir = join(tmpRoot, 'p');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('a', 1);
      storage.execute(STORAGE_METHODS.STORE);
      storage.execute(STORAGE_METHODS.ERASE_ALL);
      assert.equal(storage.get(STORAGE_FEATURES.STORAGE_UTILIZATION), 0);
      storage.close();
    });
  });

  describe('close', () => {
    it('persists on close', () => {
      const dir = join(tmpRoot, 'q');
      const storage = new Storage(null, 'S', dir);
      storage.setVar('final', 'saved');
      storage.close();
      assert.ok(existsSync(join(dir, 'storage.json')));
      const content = JSON.parse(readFileSync(join(dir, 'storage.json'), 'utf8'));
      assert.equal(content.final, 'saved');
    });
  });
});
