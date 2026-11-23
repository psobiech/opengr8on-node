import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VirtualSystem } from '../../dist/vclu/VirtualSystem.js';
import { VirtualCLU, CLU_FEATURES, CLU_STATE } from '../../dist/vclu/VirtualCLU.js';
import { Timer } from '../../dist/vclu/Timer.js';
import { Storage } from '../../dist/vclu/Storage.js';
import { HttpRequest } from '../../dist/vclu/HttpRequest.js';
import { HttpListener } from '../../dist/vclu/HttpListener.js';
import { MqttTopic } from '../../dist/vclu/MqttTopic.js';

let httpListenerPort = 18800; // unique port per test to avoid bind conflicts

describe('VirtualSystem', () => {
  describe('getVirtualClu', () => {
    it('returns VirtualCLU instance', () => {
      const virtualSystem = makeVS();
      assert.ok(virtualSystem.getVirtualClu() instanceof VirtualCLU);
      virtualSystem.close();
    });
  });

  describe('localAddress', () => {
    it('returns provided localAddress', () => {
      const virtualSystem = new VirtualSystem({ rootDirectory: '/tmp', localAddress: '10.0.0.1' });
      assert.equal(virtualSystem.localAddress, '10.0.0.1');
      virtualSystem.close();
    });

    it('returns undefined if not set', () => {
      const virtualSystem = new VirtualSystem({ rootDirectory: '/tmp' });
      assert.equal(virtualSystem.localAddress, undefined);
      virtualSystem.close();
    });
  });

  describe('getCipherKeyFor', () => {
    it('returns null when no cipherKeyProvider', () => {
      const virtualSystem = makeVS();
      assert.equal(virtualSystem.getCipherKeyFor('10.0.0.1'), null);
      virtualSystem.close();
    });

    it('calls provided cipherKeyProvider', () => {
      const key = { tag: 'cipher-key' };
      const virtualSystem = makeVS({ cipherKeyProvider: () => key });
      assert.equal(virtualSystem.getCipherKeyFor('10.0.0.1'), key);
      virtualSystem.close();
    });

    it('passes address to provider', () => {
      let capturedAddr;
      const virtualSystem = makeVS({ cipherKeyProvider: (addr) => { capturedAddr = addr; return null; } });
      virtualSystem.getCipherKeyFor('192.168.1.1');
      assert.equal(capturedAddr, '192.168.1.1');
      virtualSystem.close();
    });
  });

  describe('getObject', () => {
    it('returns null for unknown name', () => {
      const virtualSystem = makeVS();
      assert.equal(virtualSystem.getObject('UNKNOWN'), null);
      virtualSystem.close();
    });

    it('CLU is accessible by name', () => {
      const virtualSystem = new VirtualSystem({ rootDirectory: '/tmp', cluName: 'MY_CLU' });
      assert.ok(virtualSystem.getObject('MY_CLU') !== null);
      virtualSystem.close();
    });
  });

  describe('newObject', () => {
    it('VirtualCLU.INDEX=0 renames the CLU object', () => {
      const virtualSystem = new VirtualSystem({ rootDirectory: '/tmp', cluName: 'OLD' });
      virtualSystem.newObject(VirtualCLU.INDEX, 'NEW_CLU', null);
      assert.ok(virtualSystem.getObject('NEW_CLU') !== null);
      virtualSystem.close();
    });

    it('Timer.INDEX=6 creates a Timer', () => {
      const virtualSystem = makeVS();
      virtualSystem.newObject(Timer.INDEX, 'MyTimer', null);
      assert.ok(virtualSystem.getObject('MyTimer') instanceof Timer);
      virtualSystem.close();
    });

    it('Storage.INDEX=44 creates a Storage', () => {
      const virtualSystem = makeVS();
      virtualSystem.newObject(Storage.INDEX, 'MyStorage', null);
      assert.ok(virtualSystem.getObject('MyStorage') instanceof Storage);
      virtualSystem.close();
    });

    it('MqttTopic.INDEX creates an MqttTopic', () => {
      const virtualSystem = makeVS();
      virtualSystem.newObject(MqttTopic.INDEX, 'MyMqtt', null);
      assert.ok(virtualSystem.getObject('MyMqtt') instanceof MqttTopic);
      virtualSystem.close();
    });

    it('unknown index creates a plain VirtualObject', () => {
      const virtualSystem = makeVS();
      virtualSystem.newObject(9999, 'Generic', null);
      const obj = virtualSystem.getObject('Generic');
      assert.ok(obj !== null);
      virtualSystem.close();
    });

    it('same name overwrites previous object', () => {
      const virtualSystem = makeVS();
      virtualSystem.newObject(Timer.INDEX, 'Obj', null);
      virtualSystem.newObject(Storage.INDEX, 'Obj', null);
      assert.ok(virtualSystem.getObject('Obj') instanceof Storage);
      virtualSystem.close();
    });
  });

  describe('newGate', () => {
    it('HttpRequest.INDEX creates an HttpRequest', () => {
      const virtualSystem = makeVS();
      virtualSystem.newGate(HttpRequest.INDEX, 'Req');
      assert.ok(virtualSystem.getObject('Req') instanceof HttpRequest);
      virtualSystem.close();
    });

    it('HttpListener.INDEX creates an HttpListener', () => {
      const virtualSystem = makeVS({ httpListenerPort: nextPort() });
      virtualSystem.newGate(HttpListener.INDEX, 'Listener');
      assert.ok(virtualSystem.getObject('Listener') instanceof HttpListener);
      virtualSystem.close();
    });

    it('MqttTopic.INDEX creates MqttTopic via newGate', () => {
      const virtualSystem = makeVS();
      virtualSystem.newGate(MqttTopic.INDEX, 'MqttGate');
      assert.ok(virtualSystem.getObject('MqttGate') instanceof MqttTopic);
      virtualSystem.close();
    });

    it('unknown gate index creates plain VirtualObject', () => {
      const virtualSystem = makeVS();
      virtualSystem.newGate(8888, 'Gate');
      assert.ok(virtualSystem.getObject('Gate') !== null);
      virtualSystem.close();
    });
  });

  describe('luaCall', () => {
    it('returns null when no luaCallFn registered', () => {
      const virtualSystem = makeVS();
      assert.equal(virtualSystem.luaCall('anything()'), null);
      virtualSystem.close();
    });

    it('calls registered luaCallFn with script', () => {
      const virtualSystem = makeVS();
      virtualSystem.setLuaCallFn((script) => script.length);
      assert.equal(virtualSystem.luaCall('hello'), 5);
      virtualSystem.close();
    });

    it('returns null if luaCallFn throws', () => {
      const virtualSystem = makeVS();
      virtualSystem.setLuaCallFn(() => { throw new Error('lua error'); });
      assert.equal(virtualSystem.luaCall('bad()'), null);
      virtualSystem.close();
    });
  });

  describe('fetchValues', () => {
    it('returns Lua table string for single subscription', () => {
      const virtualSystem = makeVS();
      const clu = virtualSystem.getVirtualClu();
      clu.setState(CLU_STATE.OK);
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const result = virtualSystem.fetchValues(subs);
      assert.ok(result.startsWith('{'), `result: ${result}`);
      assert.ok(result.endsWith('}'), `result: ${result}`);
      assert.ok(result.includes('1'), `expected OK(1) in: ${result}`);
      virtualSystem.close();
    });

    it('returns {nil} for null feature value', () => {
      const virtualSystem = makeVS();
      const clu = virtualSystem.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.MQTT_MESSAGE }]; // null
      const result = virtualSystem.fetchValues(subs);
      assert.equal(result, '{nil}');
      virtualSystem.close();
    });

    it('multiple subscriptions joined with comma', () => {
      const virtualSystem = makeVS();
      const clu = virtualSystem.getVirtualClu();
      clu.setState(CLU_STATE.OK);
      const subs = [
        { object: clu, index: CLU_FEATURES.STATE },
        { object: clu, index: CLU_FEATURES.TIME_ZONE },
      ];
      const result = virtualSystem.fetchValues(subs);
      assert.ok(result.includes(','), `expected comma in: ${result}`);
      virtualSystem.close();
    });
  });

  describe('clientRegister / clientDestroy', () => {
    it('clientRegister returns clientReport string', () => {
      const virtualSystem = makeVS();
      const clu = virtualSystem.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const result = virtualSystem.clientRegister('10.0.0.1', '10.0.0.1', 5000, 1, subs);
      assert.ok(result.startsWith('clientReport:1:{'), `result: ${result}`);
      virtualSystem.close();
    });

    it('clientRegister with different session IDs', () => {
      const virtualSystem = makeVS();
      const clu = virtualSystem.getVirtualClu();
      const subs = [{ object: clu, index: CLU_FEATURES.STATE }];
      const report = virtualSystem.clientRegister('10.0.0.1', '10.0.0.1', 5000, 42, subs);
      assert.ok(report.startsWith('clientReport:42:'));
      virtualSystem.close();
    });

    it('clientDestroy returns sessionId', () => {
      const virtualSystem = makeVS();
      const result = virtualSystem.clientDestroy('10.0.0.1', 5000, 42);
      assert.equal(result, 42);
      virtualSystem.close();
    });

    it('clientDestroy on non-existent session does not throw', () => {
      const virtualSystem = makeVS();
      assert.doesNotThrow(() => virtualSystem.clientDestroy('99.0.0.1', 9999, 9999));
      virtualSystem.close();
    });
  });

  describe('setup / loop', () => {
    it('setup does not throw', () => {
      const virtualSystem = makeVS();
      assert.doesNotThrow(() => virtualSystem.setup());
      virtualSystem.close();
    });

    it('loop does not throw', () => {
      const virtualSystem = makeVS();
      assert.doesNotThrow(() => virtualSystem.loop());
      virtualSystem.close();
    });
  });

  describe('startLoop / stopLoop', () => {
    it('startLoop then stopLoop does not throw', () => {
      const virtualSystem = makeVS();
      virtualSystem.startLoop();
      assert.doesNotThrow(() => virtualSystem.stopLoop());
      virtualSystem.close();
    });

    it('startLoop twice is idempotent', () => {
      const virtualSystem = makeVS();
      virtualSystem.startLoop();
      assert.doesNotThrow(() => virtualSystem.startLoop());
      virtualSystem.close();
    });
  });

  describe('close', () => {
    it('close does not throw', () => {
      const virtualSystem = makeVS();
      assert.doesNotThrow(() => virtualSystem.close());
    });

    it('close twice does not throw', () => {
      const virtualSystem = makeVS();
      virtualSystem.close();
      assert.doesNotThrow(() => virtualSystem.close());
    });
  });
});

function makeVS(extra = {}) {
  return new VirtualSystem({
    rootDirectory: join(tmpdir(), `vs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    localAddress: '127.0.0.1',
    ...extra,
  });
}

function nextPort() {
  return ++httpListenerPort;
}
