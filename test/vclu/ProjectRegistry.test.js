import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectRegistry } from '../../dist/vclu/ProjectRegistry.js';

// Minimal system.xml with two CLU devices
const SYSTEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GObject id="1">
  <objectList class="linked-list">
    <specificObject class="ProgrammablePeripheryCLU" id="100">
      <clu id="200">
        <name>MyCLU</name>
        <ipAddress>192.168.1.10</ipAddress>
        <nameOnCLU>CLU_MAIN</nameOnCLU>
        <serialNumber>12345678</serialNumber>
        <macAddress>AA:BB:CC:DD:EE:FF</macAddress>
      </clu>
      <peripheryList class="linked-list">
        <ProgrammablePeripheryCLU id="300">
          <clu reference="200"/>
          <name>Dimmer1</name>
          <nameOnCLU>DIM_1</nameOnCLU>
          <typeName>DimmerModule</typeName>
          <typeId>42</typeId>
          <features class="linked-list">
            <EmbeddedFeature>
              <name>BRIGHTNESS</name>
              <index>0</index>
              <accessType>ALL</accessType>
              <paramType>NUMBER</paramType>
            </EmbeddedFeature>
            <EmbeddedFeature>
              <name>STATE</name>
              <index>1</index>
              <accessType>READ</accessType>
              <paramType>NUMBER</paramType>
            </EmbeddedFeature>
          </features>
          <events class="linked-list">
            <EmbeddedEvent>
              <name>CHANGED</name>
              <index>0</index>
            </EmbeddedEvent>
          </events>
        </ProgrammablePeripheryCLU>
        <ProgrammablePeripheryCLU id="301">
          <clu reference="200"/>
          <name>Switch1</name>
          <nameOnCLU>SW_1</nameOnCLU>
          <typeName>SwitchModule</typeName>
          <typeId>10</typeId>
          <features class="linked-list">
            <EmbeddedFeature>
              <name>VALUE</name>
              <index>0</index>
              <accessType>WRITE</accessType>
              <paramType>STRING</paramType>
            </EmbeddedFeature>
          </features>
          <events class="linked-list"/>
        </ProgrammablePeripheryCLU>
      </peripheryList>
    </specificObject>
    <specificObject class="ProgrammablePeripheryCLU" id="101">
      <clu id="201">
        <name>SecondCLU</name>
        <ipAddress>192.168.1.20</ipAddress>
        <nameOnCLU>CLU_SEC</nameOnCLU>
      </clu>
      <peripheryList class="linked-list"/>
    </specificObject>
  </objectList>
</GObject>`;

const PROPERTIES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<properties>
  <keyBytes>AAECBAUGB+Dp</keyBytes>
  <ivBytes>ERITFBUWFxgZ</ivBytes>
  <encryptedCLU class="tree-map">
    <entry>
      <string>192.168.1.10</string>
      <boolean>true</boolean>
    </entry>
    <entry>
      <string>192.168.1.20</string>
      <boolean>false</boolean>
    </entry>
  </encryptedCLU>
</properties>`;

// system.xml using XStream references (id= defined in one place, reference= elsewhere)
const SYSTEM_XML_WITH_REF = `<?xml version="1.0" encoding="UTF-8"?>
<GObject id="1">
  <objectList class="linked-list">
    <specificObject class="ProgrammablePeripheryCLU" id="100">
      <clu id="200">
        <name>RefCLU</name>
        <ipAddress>10.0.0.1</ipAddress>
        <nameOnCLU>REF_CLU</nameOnCLU>
      </clu>
      <peripheryList class="linked-list">
        <ProgrammablePeripheryCLU id="300">
          <clu reference="200"/>
          <name>Device1</name>
          <nameOnCLU>DEV1</nameOnCLU>
          <typeName>TypeA</typeName>
          <typeId>99</typeId>
          <features reference="999"/>
          <events class="linked-list"/>
        </ProgrammablePeripheryCLU>
        <list id="999">
          <EmbeddedFeature>
            <name>FOO</name>
            <index>5</index>
            <accessType>ALL</accessType>
            <paramType>STRING</paramType>
          </EmbeddedFeature>
        </list>
      </peripheryList>
    </specificObject>
  </objectList>
</GObject>`;

describe('ProjectRegistry', () => {
  describe('empty()', () => {
    it('isEmpty() is true', () => {
      assert.ok(ProjectRegistry.empty().isEmpty());
    });

    it('getClus() returns []', () => {
      assert.deepEqual(ProjectRegistry.empty().getClus(), []);
    });

    it('getClu("any") returns null', () => {
      assert.equal(ProjectRegistry.empty().getClu('any'), null);
    });

    it('getCluByIp("1.2.3.4") returns null', () => {
      assert.equal(ProjectRegistry.empty().getCluByIp('1.2.3.4'), null);
    });
  });

  describe('parseXml - CLU extraction', () => {
    let registry;
    before(() => { registry = ProjectRegistry.parseXml(SYSTEM_XML, ''); });

    it('not empty', () => assert.ok(!registry.isEmpty()));

    it('two CLUs', () => assert.equal(registry.getClus().length, 2));

    it('getClu by name', () => {
      assert.ok(registry.getClu('MyCLU') !== null);
      assert.ok(registry.getClu('SecondCLU') !== null);
    });

    it('getClu unknown returns null', () => {
      assert.equal(registry.getClu('UNKNOWN'), null);
    });

    it('MyCLU ipAddress', () => {
      assert.equal(registry.getClu('MyCLU')?.ipAddress, '192.168.1.10');
    });

    it('MyCLU nameOnClu', () => {
      assert.equal(registry.getClu('MyCLU')?.nameOnClu, 'CLU_MAIN');
    });

    it('MyCLU serialNumber', () => {
      assert.equal(registry.getClu('MyCLU')?.serialNumber, '12345678');
    });

    it('MyCLU macAddress', () => {
      assert.equal(registry.getClu('MyCLU')?.macAddress, 'AA:BB:CC:DD:EE:FF');
    });

    it('SecondCLU has no serialNumber', () => {
      assert.equal(registry.getClu('SecondCLU')?.serialNumber, undefined);
    });

    it('getCluByIp finds by IP', () => {
      const clu = registry.getCluByIp('192.168.1.10');
      assert.ok(clu !== null);
      assert.equal(clu.name, 'MyCLU');
    });

    it('getCluByIp returns null for unknown IP', () => {
      assert.equal(registry.getCluByIp('10.0.0.99'), null);
    });
  });

  describe('parseXml - device objects', () => {
    let registry;
    before(() => { registry = ProjectRegistry.parseXml(SYSTEM_XML, ''); });

    it('MyCLU has two objects', () => {
      assert.equal(registry.getObjectsForClu('MyCLU').length, 2);
    });

    it('SecondCLU has zero objects', () => {
      assert.equal(registry.getObjectsForClu('SecondCLU').length, 0);
    });

    it('getObjectsForClu unknown CLU returns []', () => {
      assert.deepEqual(registry.getObjectsForClu('NONE'), []);
    });

    it('getObjectOnClu DIM_1', () => {
      const obj = registry.getObjectOnClu('MyCLU', 'DIM_1');
      assert.ok(obj !== null);
      assert.equal(obj.name, 'Dimmer1');
      assert.equal(obj.typeName, 'DimmerModule');
      assert.equal(obj.typeId, 42);
    });

    it('getObjectOnClu SW_1', () => {
      const obj = registry.getObjectOnClu('MyCLU', 'SW_1');
      assert.ok(obj !== null);
      assert.equal(obj.name, 'Switch1');
      assert.equal(obj.typeId, 10);
    });

    it('getObjectOnClu unknown nameOnClu returns null', () => {
      assert.equal(registry.getObjectOnClu('MyCLU', 'UNKNOWN'), null);
    });

    it('cluName set on device object', () => {
      assert.equal(registry.getObjectOnClu('MyCLU', 'DIM_1')?.cluName, 'MyCLU');
    });
  });

  describe('parseXml - features', () => {
    let registry;
    before(() => { registry = ProjectRegistry.parseXml(SYSTEM_XML, ''); });

    it('DIM_1 has 2 features', () => {
      assert.equal(registry.getObjectOnClu('MyCLU', 'DIM_1')?.features.length, 2);
    });

    it('BRIGHTNESS: accessGet=true, accessSet=true (ALL)', () => {
      const feature = registry.getObjectOnClu('MyCLU', 'DIM_1')?.features.find((candidate) => candidate.name === 'BRIGHTNESS');
      assert.ok(feature);
      assert.equal(feature.index, 0);
      assert.equal(feature.accessGet, true);
      assert.equal(feature.accessSet, true);
      assert.equal(feature.type, 'NUMBER');
    });

    it('STATE: accessGet=true, accessSet=false (READ)', () => {
      const feature = registry.getObjectOnClu('MyCLU', 'DIM_1')?.features.find((candidate) => candidate.name === 'STATE');
      assert.ok(feature);
      assert.equal(feature.index, 1);
      assert.equal(feature.accessGet, true);
      assert.equal(feature.accessSet, false);
    });

    it('VALUE: accessGet=false, accessSet=true (WRITE)', () => {
      const feature = registry.getObjectOnClu('MyCLU', 'SW_1')?.features.find((candidate) => candidate.name === 'VALUE');
      assert.ok(feature);
      assert.equal(feature.accessGet, false);
      assert.equal(feature.accessSet, true);
      assert.equal(feature.type, 'STRING');
    });
  });

  describe('parseXml - events', () => {
    let registry;
    before(() => { registry = ProjectRegistry.parseXml(SYSTEM_XML, ''); });

    it('DIM_1 has 1 event', () => {
      assert.equal(registry.getObjectOnClu('MyCLU', 'DIM_1')?.events.length, 1);
    });

    it('CHANGED event name and index', () => {
      const event = registry.getObjectOnClu('MyCLU', 'DIM_1')?.events[0];
      assert.ok(event);
      assert.equal(event.name, 'CHANGED');
      assert.equal(event.index, 0);
    });

    it('SW_1 has 0 events', () => {
      assert.equal(registry.getObjectOnClu('MyCLU', 'SW_1')?.events.length, 0);
    });
  });

  describe('parseXml - properties', () => {
    let registry;
    before(() => { registry = ProjectRegistry.parseXml(SYSTEM_XML, PROPERTIES_XML); });

    it('projectKey is Buffer', () => {
      assert.ok(registry.properties.projectKey instanceof Buffer);
      assert.ok(registry.properties.projectKey.length > 0);
    });

    it('projectIV is Buffer', () => {
      assert.ok(registry.properties.projectIV instanceof Buffer);
      assert.ok(registry.properties.projectIV.length > 0);
    });

    it('encryptedClus: 192.168.1.10 = true', () => {
      assert.equal(registry.properties.encryptedClus.get('192.168.1.10'), true);
    });

    it('encryptedClus: 192.168.1.20 = false', () => {
      assert.equal(registry.properties.encryptedClus.get('192.168.1.20'), false);
    });

    it('encryptedClus size is 2', () => {
      assert.equal(registry.properties.encryptedClus.size, 2);
    });
  });

  describe('parseXml - empty properties', () => {
    it('projectKey is undefined when no keyBytes', () => {
      const registry = ProjectRegistry.parseXml(SYSTEM_XML, '');
      assert.equal(registry.properties.projectKey, undefined);
    });

    it('projectIV is undefined when no ivBytes', () => {
      const registry = ProjectRegistry.parseXml(SYSTEM_XML, '');
      assert.equal(registry.properties.projectIV, undefined);
    });

    it('encryptedClus is empty Map', () => {
      const registry = ProjectRegistry.parseXml(SYSTEM_XML, '');
      assert.equal(registry.properties.encryptedClus.size, 0);
    });
  });

  describe('XStream reference resolution', () => {
    it('resolves features via reference= attribute', () => {
      const registry = ProjectRegistry.parseXml(SYSTEM_XML_WITH_REF, '');
      const obj = registry.getObjectOnClu('RefCLU', 'DEV1');
      assert.ok(obj !== null, 'DEV1 should be found');
      const feature = obj?.features.find((candidate) => candidate.name === 'FOO');
      assert.ok(feature !== undefined, 'FOO feature should be resolved via reference');
      assert.equal(feature.index, 5);
      assert.equal(feature.type, 'STRING');
      assert.equal(feature.accessGet, true);
      assert.equal(feature.accessSet, true);
    });
  });

  describe('loadFromFile', () => {
    let tmpDir;
    before(() => {
      tmpDir = join(tmpdir(), `vclu-reg-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, 'system.xml'), SYSTEM_XML);
      writeFileSync(join(tmpDir, 'properties.xml'), PROPERTIES_XML);
    });

    it('loads system.xml from disk', () => {
      const registry = ProjectRegistry.loadFromFile(join(tmpDir, 'system.xml'));
      assert.ok(!registry.isEmpty());
      assert.ok(registry.getClu('MyCLU') !== null);
    });

    it('loads properties.xml from disk when path given', () => {
      const registry = ProjectRegistry.loadFromFile(
        join(tmpDir, 'system.xml'),
        join(tmpDir, 'properties.xml'),
      );
      assert.ok(registry.properties.projectKey instanceof Buffer);
    });

    it('missing properties.xml path → no error, no key', () => {
      const registry = ProjectRegistry.loadFromFile(join(tmpDir, 'system.xml'));
      assert.equal(registry.properties.projectKey, undefined);
    });
  });
});
