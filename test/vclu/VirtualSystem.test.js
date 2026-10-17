import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VirtualSystem } from '../../src/vclu/VirtualSystem.js';
import { VirtualCLU, CLU_FEATURES, CLU_STATE } from '../../src/vclu/VirtualCLU.js';
import { Timer } from '../../src/vclu/Timer.js';
import { Storage } from '../../src/vclu/Storage.js';
import { HttpRequest } from '../../src/vclu/HttpRequest.js';
import { HttpListener } from '../../src/vclu/HttpListener.js';
import { MqttTopic } from '../../src/vclu/MqttTopic.js';

let httpListenerPort = 18800; // unique port per test to avoid bind conflicts

function nextPort() {
  return ++httpListenerPort;
}

function makeVS(extra = {}) {
  return new VirtualSystem({
    rootDirectory: join(tmpdir(), `vs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    localAddress: '127.0.0.1',
    ...extra,
  });
}

describe('VirtualSystem', () => {
  describe('getVirtualClu', () => {
    it('returns VirtualCLU instance', () => {
      const vs = makeVS();
      assert.ok(vs.getVirtualClu() instanceof VirtualCLU);
      vs.close();
    });
  });

  describe('localAddress', () => {
    it('returns provided localAddress', () => {
      const vs = new VirtualSystem({ rootDirectory: '/tmp', localAddress: '10.0.0.1' });
      assert.equal(vs.localAddress, '10.0.0.1');
      vs.close();
    });

    it('returns undefined if not set', () => {
      const vs = new VirtualSystem({ rootDirectory: '/tmp' });
      assert.equal(vs.localAddress, undefined);
      vs.close();
    });
  });

  describe('getCipherKeyFor', () => {
    it('returns null when no cipherKeyProvider', () => {
      const vs = makeVS();
      assert.equal(vs.getCipherKeyFor('10.0.0.1'), null);
      vs.close();
    });

    it('calls provided cipherKeyProvider', () => {
      const key = { tag: 'cipher-key' };
      const vs = makeVS({ cipherKeyProvider: () => key });
      assert.equal(vs.getCipherKeyFor('10.0.0.1'), key);
      vs.close();
    });

    it('passes address to provider', () => {
      let capturedAddr;
      const vs = makeVS({ cipherKeyProvider: (addr) => { capturedAddr = addr; return null; } });
      vs.getCipherKeyFor('192.168.1.1');
      assert.equal(capturedAddr, '192.168.1.1');
      vs.close();
    });
  });

  describe('getObject', () => {
    it('returns null for unknown name', () => {
      const vs = makeVS();
      assert.equal(vs.getObject('UNKNOWN'), null);
      vs.close();
    });

    it('CLU is accessible by name', () => {
      const vs = new VirtualSystem({ rootDirectory: '/tmp', cluName: 'MY_CLU' });
      assert.ok(vs.getObject('MY_CLU') !== null);
      vs.close();
    });
  });

  describe('newObject', () => {
    it('VirtualCLU.INDEX=0 renames the CLU object', () => {
      const vs = new VirtualSystem({ rootDirectory: '/tmp', cluName: 'OLD' });
      vs.newObject(VirtualCLU.INDEX, 'NEW_CLU', null);
      assert.ok(vs.getObject('NEW_CLU') !== null);
      vs.close();
    });

    it('Timer.INDEX=6 creates a Timer', () => {
      const vs = makeVS();
      vs.newObject(Timer.INDEX, 'MyTimer', null);
      assert.ok(vs.getObject('MyTimer') instanceof Timer);
      vs.close();
    });

    it('Storage.INDEX=44 creates a Storage', () => {
      const vs = makeVS();
      vs.newObject(Storage.INDEX, 'MyStorage', null);
      assert.ok(vs.getObject('MyStorage') instanceof Storage);
      vs.close();
    });

    it('MqttTopic.INDEX creates an MqttTopic', () => {
      const vs = makeVS();
      vs.newObject(MqttTopic.INDEX, 'MyMqtt', null);
      assert.ok(vs.getObject('MyMqtt') instanceof MqttTopic);
      vs.close();
    });

    it('unknown index creates a plain VirtualObject', () => {
      const vs = makeVS();
      vs.newObject(9999, 'Generic', null);
      const obj = vs.getObject('Generic');
      assert.ok(obj !== null);
      vs.close();
    });

    it('same name overwrites previous object', () => {
      const vs = makeVS();
      vs.newObject(Timer.INDEX, 'Obj', null);
      vs.newObject(Storage.INDEX, 'Obj', null);
      assert.ok(vs.getObject('Obj') instanceof Storage);
      vs.close();
    });
  });

  describe('newGate', () => {
    it('HttpRequest.INDEX creates an HttpRequest', () => {
      const vs = makeVS();
      vs.newGate(HttpRequest.INDEX, 'Req');
      assert.ok(vs.getObject('Req') instanceof HttpRequest);
      vs.close();
    });

    it('HttpListener.INDEX creates an HttpListener', () => {
      const vs = makeVS({ httpListenerPort: nextPort() });
      vs.newGate(HttpListener.INDEX, 'Listener');
      assert.ok(vs.getObject('Listener') instanceof HttpListener);
      vs.close();
    });

    it('MqttTopic.INDEX creates MqttTopic via newGate', () => {
      const vs = makeVS();
      vs.newGate(MqttTopic.INDEX, 'MqttGate');
      assert.ok(vs.getObject('MqttGate') instanceof MqttTopic);
      vs.close();
    });

    it('unknown gate index creates plain VirtualObject', () => {
      const vs = makeVS();
      vs.newGate(8888, 'Gate');
      assert.ok(vs.getObject('Gate') !== null);
      vs.close();
    });
  });

  describe('luaCall', () => {
    it('returns null when no luaCallFn registered', () => {
      const vs = makeVS();
      assert.equal(vs.luaCall('anything()'), null);
      vs.close();
    });

    it('calls registered luaCallFn with script', () => {
      const vs = makeVS();
      vs.setLuaCallFn((script) => script.length);
      assert.equal(vs.luaCall('hello'), 5);
      vs.close();
    });

    it('returns null if luaCallFn throws', () => {
      const vs = makeVS();
      vs.setLuaCallFn(() => { throw new Error('lua error'); });
      assert.equal(vs.luaCall('bad()'), null);
      vs.close();
    });
  });

  describe('fetchValues', () => {
    it('returns Lua table string for single subscription', () => {
      const vs = makeVS();
      const clu = vs.getVirtualClu();
      clu.setState(CLU_STATE.OK);
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const result = vs.fetchValues(subs);
      assert.ok(result.startsWith('{'), `result: ${result}`);
      assert.ok(result.endsWith('}'), `result: ${result}`);
      assert.ok(result.includes('1'), `expected OK(1) in: ${result}`);
      vs.close();
    });

    it('returns {nil} for null feature value', () => {
      const vs = makeVS();
      const clu = vs.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.MQTT_MESSAGE }]; // null
      const result = vs.fetchValues(subs);
      assert.equal(result, '{nil}');
      vs.close();
    });

    it('multiple subscriptions joined with comma', () => {
      const vs = makeVS();
      const clu = vs.getVirtualClu();
      clu.setState(CLU_STATE.OK);
      const subs = [
        { object: clu, index: CLU_FEATURES.STATE },
        { object: clu, index: CLU_FEATURES.TIME_ZONE },
      ];
      const result = vs.fetchValues(subs);
      assert.ok(result.includes(','), `expected comma in: ${result}`);
      vs.close();
    });
  });

  describe('clientRegister / clientDestroy', () => {
    it('clientRegister returns clientReport string', () => {
      const vs = makeVS();
      const clu = vs.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const result = vs.clientRegister('10.0.0.1', '10.0.0.1', 5000, 1, subs);
      assert.ok(result.startsWith('clientReport:1:{'), `result: ${result}`);
      vs.close();
    });

    it('clientRegister with different session IDs', () => {
      const vs = makeVS();
      const clu = vs.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const r1 = vs.clientRegister('10.0.0.1', '10.0.0.1', 5000, 42, subs);
      assert.ok(r1.startsWith('clientReport:42:'));
      vs.close();
    });

    it('clientDestroy returns sessionId', () => {
      const vs = makeVS();
      const result = vs.clientDestroy('10.0.0.1', 5000, 42);
      assert.equal(result, 42);
      vs.close();
    });

    it('clientDestroy on non-existent session does not throw', () => {
      const vs = makeVS();
      assert.doesNotThrow(() => vs.clientDestroy('99.0.0.1', 9999, 9999));
      vs.close();
    });
  });

  describe('setup / loop', () => {
    it('setup does not throw', () => {
      const vs = makeVS();
      assert.doesNotThrow(() => vs.setup());
      vs.close();
    });

    it('loop does not throw', () => {
      const vs = makeVS();
      assert.doesNotThrow(() => vs.loop());
      vs.close();
    });
  });

  describe('startLoop / stopLoop', () => {
    it('startLoop then stopLoop does not throw', () => {
      const vs = makeVS();
      vs.startLoop();
      assert.doesNotThrow(() => vs.stopLoop());
      vs.close();
    });

    it('startLoop twice is idempotent', () => {
      const vs = makeVS();
      vs.startLoop();
      assert.doesNotThrow(() => vs.startLoop());
      vs.close();
    });
  });

  describe('close', () => {
    it('close does not throw', () => {
      const vs = makeVS();
      assert.doesNotThrow(() => vs.close());
    });

    it('close twice does not throw', () => {
      const vs = makeVS();
      vs.close();
      assert.doesNotThrow(() => vs.close());
    });
  });
});
