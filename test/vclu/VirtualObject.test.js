import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualObject } from '../../dist/vclu/VirtualObject.js';

describe('VirtualObject', () => {
  describe('name', () => {
    it('returns name from constructor', () => {
      const obj = new VirtualObject(null, 'MyObj');
      assert.equal(obj.name, 'MyObj');
    });

    it('is settable', () => {
      const obj = new VirtualObject(null, 'Orig');
      obj.name = 'Changed';
      assert.equal(obj.name, 'Changed');
    });
  });

  describe('get / set without feature fn', () => {
    it('get returns null for unknown index', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.equal(obj.get(99), null);
    });

    it('set then get round-trips', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.set(5, 'hello');
      assert.equal(obj.get(5), 'hello');
    });

    it('set with number', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.set(0, 42);
      assert.equal(obj.get(0), 42);
    });

    it('set with boolean', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.set(0, true);
      assert.equal(obj.get(0), true);
    });

    it('set with null', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.set(0, null);
      assert.equal(obj.get(0), null);
    });
  });

  describe('getValue / setValue / clearValue', () => {
    it('setValue bypasses feature fn', () => {
      const obj = new VirtualObject(null, 'obj');
      let fnCalls = 0;
      obj.registerFeature(3, (v) => { fnCalls++; return v ?? 99; });
      fnCalls = 0; // registerFeature calls fn once for init; reset before the actual assertion
      obj.setValue(3, 77);
      assert.equal(fnCalls, 0);
      assert.equal(obj.getValue(3), 77);
    });

    it('getValue returns null for unknown index', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.equal(obj.getValue(0), null);
    });

    it('clearValue removes stored value', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.setValue(2, 'data');
      obj.clearValue(2);
      assert.equal(obj.getValue(2), null);
    });
  });

  describe('registerFeature', () => {
    it('getter called on get()', () => {
      const obj = new VirtualObject(null, 'obj');
      let counter = 0;
      obj.registerFeature(0, () => ++counter);
      counter = 0; // registerFeature calls fn once for init; reset before the actual assertion
      obj.get(0);
      obj.get(0);
      assert.equal(counter, 2);
    });

    it('getter returning value updates stored value', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.registerFeature(0, () => 42);
      const val = obj.get(0);
      assert.equal(val, 42);
    });

    it('setter called with value on set()', () => {
      const obj = new VirtualObject(null, 'obj');
      const received = [];
      obj.registerFeature(1, (v) => { if (v !== undefined) received.push(v); return v; });
      obj.set(1, 'hello');
      assert.ok(received.includes('hello'));
    });

    it('setter return value stored', () => {
      const obj = new VirtualObject(null, 'obj');
      // fn returns undefined for getter (no live recompute) so get() uses stored value
      obj.registerFeature(1, (v) => v === undefined ? undefined : Number(v) * 2);
      obj.set(1, 5);
      assert.equal(obj.get(1), 10);
    });

    it('initial value set from getter return', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.registerFeature(0, () => 'initial');
      assert.equal(obj.getValue(0), 'initial');
    });
  });

  describe('registerMethod / execute', () => {
    it('returns null for unregistered method', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.equal(obj.execute(99), null);
    });

    it('calls registered method with args', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.registerMethod(0, (a, b) => Number(a) + Number(b));
      assert.equal(obj.execute(0, 3, 4), 7);
    });

    it('no args', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.registerMethod(0, () => 'done');
      assert.equal(obj.execute(0), 'done');
    });

    it('returns null if method throws', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.registerMethod(0, () => { throw new Error('boom'); });
      assert.equal(obj.execute(0), null);
    });
  });

  describe('events', () => {
    it('isEventRegistered false before addEventHandler', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.equal(obj.isEventRegistered(0), false);
    });

    it('isEventRegistered true after addEventHandler', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.addEventHandler(0, () => {});
      assert.equal(obj.isEventRegistered(0), true);
    });

    it('triggerEvent returns false with no handlers', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.equal(obj.triggerEvent(5), false);
    });

    it('triggerEvent returns true with handler registered', () => {
      const obj = new VirtualObject(null, 'obj');
      obj.addEventHandler(0, () => {});
      assert.equal(obj.triggerEvent(0), true);
    });

    it('triggerEvent calls handler asynchronously', async () => {
      const obj = new VirtualObject(null, 'obj');
      let called = false;
      obj.addEventHandler(0, () => { called = true; });
      obj.triggerEvent(0);
      await obj.awaitEventTrigger(0);
      assert.equal(called, true);
    });

    it('multiple handlers all called', async () => {
      const obj = new VirtualObject(null, 'obj');
      const log = [];
      obj.addEventHandler(0, () => log.push(1));
      obj.addEventHandler(0, () => log.push(2));
      obj.triggerEvent(0);
      await obj.awaitEventTrigger(0);
      assert.deepEqual(log.sort(), [1, 2]);
    });

    it('onCompleted called after all handlers finish', async () => {
      const obj = new VirtualObject(null, 'obj');
      const log = [];
      obj.addEventHandler(0, async () => {
        await new Promise((r) => setTimeout(r, 10));
        log.push('handler');
      });
      await new Promise((resolve) => {
        obj.triggerEvent(0, () => { log.push('completed'); resolve(); });
      });
      assert.deepEqual(log, ['handler', 'completed']);
    });

    it('events for different addresses are independent', async () => {
      const obj = new VirtualObject(null, 'obj');
      let a = 0, b = 0;
      obj.addEventHandler(0, () => { a++; });
      obj.addEventHandler(1, () => { b++; });
      obj.triggerEvent(0);
      obj.triggerEvent(1);
      await obj.awaitEventTrigger(0);
      await obj.awaitEventTrigger(1);
      assert.equal(a, 1);
      assert.equal(b, 1);
    });

    it('awaitEventTrigger resolves immediately if no pending event', async () => {
      const obj = new VirtualObject(null, 'obj');
      await obj.awaitEventTrigger(0); // should not hang
    });

    it('second trigger on same address runs after first', async () => {
      const obj = new VirtualObject(null, 'obj');
      const log = [];
      obj.addEventHandler(0, async () => {
        await new Promise((r) => setTimeout(r, 20));
        log.push('first');
      });
      obj.triggerEvent(0);
      obj.addEventHandler(0, () => log.push('second'));
      obj.triggerEvent(0);
      await obj.awaitEventTrigger(0);
      // second trigger chains after first; both triggers run all registered handlers,
      // so log contains 'first' at least once before 'second'
      const firstIdx = log.indexOf('first');
      const secondIdx = log.indexOf('second');
      assert.ok(firstIdx !== -1 && secondIdx !== -1, `log=${JSON.stringify(log)}`);
      assert.ok(firstIdx < secondIdx, `'first' must appear before 'second', log=${JSON.stringify(log)}`);
    });
  });

  describe('setup / loop / close', () => {
    it('setup does not throw', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.doesNotThrow(() => obj.setup());
    });

    it('loop does not throw', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.doesNotThrow(() => obj.loop());
    });

    it('close does not throw', () => {
      const obj = new VirtualObject(null, 'obj');
      assert.doesNotThrow(() => obj.close());
    });
  });
});
