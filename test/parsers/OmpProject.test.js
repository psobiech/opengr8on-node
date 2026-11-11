import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { readOmpProject, readOmpDiagnostics } from '../../dist/parsers/omp/OmpProject.js';

// Synthetic XStream system.xml: the CLU is first defined inside an IO's <clu> (as OM writes it),
// the tree only references it; IOs reference a shared module definition.
const SYSTEM_XML = `<object-stream>
  <TreeObject id="1">
    <name>root</name>
    <children id="2">
      <TreeObject id="3">
        <name>LAMP</name>
        <specificObject class="com.grenton.om.Output" id="4">
          <name>LAMP</name>
          <nameOnCLU>DIM0001</nameOnCLU>
          <number>0</number>
          <classTypeId>5</classTypeId>
          <active>true</active>
          <isRemoved>false</isRemoved>
          <module id="5">
            <moduleID>330000009</moduleID><moduleClass>1a</moduleClass><moduleTypeFirmware>02</moduleTypeFirmware><moduleVersion>02</moduleVersion><innerName>13ab6689</innerName><active>true</active>
          </module>
          <features id="6">
            <EmbeddedFeature id="7"><name>MinValue</name><type id="8"><paramType>NUMBER</paramType></type><accessType>ALL</accessType><initValue>0.32</initValue><index>3</index></EmbeddedFeature>
            <EmbeddedFeature id="9"><name>Value</name><type id="10"><paramType>NUMBER</paramType></type><accessType>READ</accessType><index>0</index></EmbeddedFeature>
          </features>
          <events id="11">
            <Event id="12"><name>OnSwitchOn</name><index>0</index><commands class="linked-list" id="13"><string>CLU_1-&gt;LAMP2-&gt;Switch(0)</string><string>CLU_1-&gt;ELO()</string></commands></Event>
          </events>
          <clu id="14">
            <name>CLU_1</name>
            <nameOnCLU>CLU100000011</nameOnCLU>
            <serialNumber>5f5e10b</serialNumber>
            <ipAddress>10.0.0.11</ipAddress>
            <hardwareType>00000013</hardwareType><hardwareVersion>00000001</hardwareVersion>
            <firmwareType>00000003</firmwareType><firmwareVersion>00000203</firmwareVersion>
            <cipherKeyType>PROJECT_KEY</cipherKeyType>
            <embeddedFeaturesList id="15"><EmbeddedFeature id="16"><name>UseCloud</name><type id="17"><paramType>BOOLEAN</paramType></type><accessType>ALL</accessType><initValue>0</initValue><defaultInitValue>1</defaultInitValue><index>18</index></EmbeddedFeature></embeddedFeaturesList>
            <eventsList id="18"><Event id="19"><name>OnInit</name><index>0</index><commands class="linked-list" id="20"/></Event></eventsList>
            <modulesList class="linked-list" id="21"><InputOutputDefinition reference="5"/></modulesList>
            <iosList id="22">
              <Output reference="4"/>
              <Input id="23"><name>BTN</name><nameOnCLU>BUT0001</nameOnCLU><number>0</number><classTypeId>7</classTypeId><module reference="5"/><features id="24"/><events id="25"/></Input>
              <Output id="26"><name>LAMP2</name><nameOnCLU>DIM0002</nameOnCLU><number>1</number><classTypeId>5</classTypeId><isRemoved>true</isRemoved><module reference="5"/><features id="27"/><events id="28"/></Output>
            </iosList>
            <scripts id="29"><Script id="30"><name>ELO</name><parameters id="31"/><isManualEdit>true</isManualEdit></Script></scripts>
          </clu>
        </specificObject>
      </TreeObject>
      <TreeObject id="32"><name>CLU_1</name><specificObject class="com.grenton.om.CLU" reference="14"/></TreeObject>
    </children>
  </TreeObject>
</object-stream>`;

function omp() {
  const zip = new AdmZip();
  zip.addFile('system.xml', Buffer.from(SYSTEM_XML));
  zip.addFile('.project', Buffer.from('<projectDescription><name>Test</name></projectDescription>'));
  zip.addFile('scripts/CLU_1/ELO.lua', Buffer.from('print(1)\r\n'));
  zip.addFile('diagnostics/100000011/om.lua/1', Buffer.from('old'));
  zip.addFile('diagnostics/100000011/om.lua/2', Buffer.from('new'));
  zip.addFile('diagnostics/100000011/user.lua/1', Buffer.from(''));
  return zip.toBuffer();
}

describe('readOmpProject', () => {
  it('finds a CLU first defined inside an IO and resolves references', () => {
    const p = readOmpProject(omp());
    assert.equal(p.name, 'Test');
    assert.equal(p.clus.length, 1);
    const c = p.clus[0];
    assert.deepEqual(
      [c.name, c.nameOnCLU, c.serialNumber, c.ipAddress, c.hardwareType, c.firmwareVersion, c.cipherKeyType],
      ['CLU_1', 'CLU100000011', '5f5e10b', '10.0.0.11', '00000013', '00000203', 'PROJECT_KEY'],
    );
    assert.deepEqual(c.features, [{ name: 'UseCloud', index: 18, initValue: '0', defaultInitValue: '1', paramType: 'BOOLEAN', accessType: 'ALL' }]);
    assert.deepEqual(c.events, [{ name: 'OnInit', index: 0, commands: [] }]);
    assert.deepEqual(c.modules.map(m => [m.moduleID, m.moduleClass, m.moduleTypeFirmware, m.moduleVersion]), [['330000009', '1a', '02', '02']]);
  });

  it('lists IOs in document order with module, features and event commands', () => {
    const c = readOmpProject(omp()).clus[0];
    assert.deepEqual(c.ios.map(io => [io.kind, io.nameOnCLU, io.number, io.classTypeId, io.isRemoved]), [
      ['Output', 'DIM0001', '0', '5', 'false'],
      ['Input', 'BUT0001', '0', '7', undefined],
      ['Output', 'DIM0002', '1', '5', 'true'],
    ]);
    const lamp = c.ios[0];
    assert.equal(lamp.module?.moduleID, '330000009');
    assert.equal(c.ios[1].module?.moduleClass, '1a'); // via reference
    assert.deepEqual(lamp.features.map(f => [f.name, f.index, f.initValue, f.accessType]), [['MinValue', 3, '0.32', 'ALL'], ['Value', 0, undefined, 'READ']]);
    assert.deepEqual(lamp.events, [{ name: 'OnSwitchOn', index: 0, commands: ['CLU_1->LAMP2->Switch(0)', 'CLU_1->ELO()'] }]);
  });

  it('reads script sources from the archive', () => {
    assert.deepEqual(readOmpProject(omp()).clus[0].scripts, [{ name: 'ELO', parameters: [], isManualEdit: 'true', source: 'print(1)\r\n' }]);
  });
});

describe('readOmpDiagnostics', () => {
  it('returns the latest cached file per CLU serial', () => {
    const d = readOmpDiagnostics(omp());
    assert.equal(d.get('100000011')?.get('om.lua')?.toString(), 'new');
    assert.equal(d.get('100000011')?.get('user.lua')?.length, 0);
  });
});
