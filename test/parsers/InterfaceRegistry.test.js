import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InterfaceRegistry } from '../../dist/parsers/interfaces/InterfaceRegistry.js';

const DEVICE_INTERFACES_DIR = new URL('../../../opengr8on/runtime/device-interfaces', import.meta.url).pathname;

describe('InterfaceRegistry', () => {
  describe('EMPTY', () => {
    it('returns null for unknown CLU', () => {
      assert.equal(InterfaceRegistry.EMPTY.getCLU(0, 0, 0, 0), null);
    });

    it('returns null for unknown object', () => {
      assert.equal(InterfaceRegistry.EMPTY.getObject('Unknown', 1), null);
    });

    it('counts are zero', () => {
      assert.equal(InterfaceRegistry.EMPTY.cluCount, 0);
      assert.equal(InterfaceRegistry.EMPTY.objectCount, 0);
    });
  });

  describe('fromDirectory', () => {
    let registry;
    try {
      registry = InterfaceRegistry.fromDirectory(DEVICE_INTERFACES_DIR);
    } catch {
      registry = null;
    }

    it('loads CLU from directory', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const vclu = registry.getCLU(0x13, 0x1, 0x3, 0xAA55AA);
      assert.ok(vclu !== null, 'VCLU not found');
      assert.equal(vclu.typeName, 'CLU_VIRTUAL_OPENGR8ON');
      assert.equal(vclu.className, 'CLU');
    });

    it('VCLU has expected interface counts', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const vclu = registry.getCLU(0x13, 0x1, 0x3, 0xAA55AA);
      assert.equal(vclu.interface.features.length, 19);
      assert.equal(vclu.interface.methods.length, 5);
      assert.equal(vclu.interface.events.length, 3);
    });

    it('VCLU has objects restrictions', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const vclu = registry.getCLU(0x13, 0x1, 0x3, 0xAA55AA);
      assert.equal(vclu.objects.length, 4);
    });

    it('loads MqttTopic object', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const obj = registry.getObject('MqttTopic', 1);
      assert.ok(obj !== null, 'MqttTopic not found');
      assert.equal(obj.name, 'MqttTopic');
      assert.equal(obj.class, '999');
      assert.equal(obj.className, 'OBJECT');
    });

    it('MqttTopic has expected interface counts', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const obj = registry.getObject('MqttTopic', 1);
      assert.equal(obj.features.length, 2);
      assert.equal(obj.methods.length, 5);
      assert.equal(obj.events.length, 2);
    });

    it('feature has correct fields', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const vclu = registry.getCLU(0x13, 0x1, 0x3, 0xAA55AA);
      const uptime = vclu.interface.features.find(f => f.name === 'Uptime');
      assert.ok(uptime, 'Uptime feature not found');
      assert.equal(uptime.type, 'num');
      assert.equal(uptime.get, true);
      assert.equal(uptime.set, false);
      assert.equal(uptime.index, 0);
    });

    it('feature with enum has enumValues', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      const vclu = registry.getCLU(0x13, 0x1, 0x3, 0xAA55AA);
      const state = vclu.interface.features.find(f => f.name === 'State');
      assert.ok(state, 'State feature not found');
      assert.ok(state.enumValues !== null, 'enumValues should be set');
      assert.equal(state.enums.length, 7);
    });

    it('unknown CLU returns null', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      assert.equal(registry.getCLU(0, 0, 0, 0), null);
    });

    it('unknown object returns null', { skip: registry === null ? 'device-interfaces dir not found' : false }, () => {
      assert.equal(registry.getObject('NonExistent', 1), null);
    });
  });
});
