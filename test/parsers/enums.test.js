import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLUClassNameEnum, cluClassNameOf } from '../../src/parsers/interfaces/CLUClassNameEnum.js';
import { TreeObjectType, treeObjectTypeFrom } from '../../src/parsers/omp/system/TreeObjectType.js';
import { SpecificObjectClass, specificObjectClassFrom } from '../../src/parsers/omp/system/specificObjects/SpecificObjectClass.js';
import { SpecificObjectType, specificObjectTypeFrom } from '../../src/parsers/omp/system/specificObjects/SpecificObjectType.js';

describe('CLUClassNameEnum', () => {
  it('has expected values', () => {
    assert.equal(CLUClassNameEnum.CLU, 'CLU');
    assert.equal(CLUClassNameEnum.GATE, 'GATE');
  });

  it('cluClassNameOf returns CLU for null', () => {
    assert.equal(cluClassNameOf(null), CLUClassNameEnum.CLU);
  });

  it('cluClassNameOf is case-insensitive', () => {
    assert.equal(cluClassNameOf('clu'), CLUClassNameEnum.CLU);
    assert.equal(cluClassNameOf('GATE'), CLUClassNameEnum.GATE);
  });
});

describe('TreeObjectType', () => {
  it('has expected values', () => {
    assert.equal(TreeObjectType.UNSUPPORTED, 'UNSUPPORTED');
    assert.equal(TreeObjectType.CLU, 'CLU');
    assert.equal(TreeObjectType.SCRIPT, 'SCRIPT');
  });

  it('treeObjectTypeFrom returns UNSUPPORTED for null', () => {
    assert.equal(treeObjectTypeFrom(null), TreeObjectType.UNSUPPORTED);
  });

  it('treeObjectTypeFrom is case-insensitive', () => {
    assert.equal(treeObjectTypeFrom('clu'), TreeObjectType.CLU);
    assert.equal(treeObjectTypeFrom('SCRIPT_CONTAINER'), TreeObjectType.SCRIPT_CONTAINER);
  });

  it('treeObjectTypeFrom returns UNSUPPORTED for unknown', () => {
    assert.equal(treeObjectTypeFrom('UNKNOWN_TYPE_XYZ'), TreeObjectType.UNSUPPORTED);
  });
});

describe('SpecificObjectClass', () => {
  it('has expected values', () => {
    assert.equal(SpecificObjectClass.CLU, 'CLU');
    assert.equal(SpecificObjectClass.SCRIPT, 'SCRIPT');
    assert.equal(SpecificObjectClass.UNSUPPORTED, 'UNSUPPORTED');
  });

  it('specificObjectClassFrom maps known values', () => {
    assert.equal(specificObjectClassFrom('CLU'), SpecificObjectClass.CLU);
    assert.equal(specificObjectClassFrom('Script'), SpecificObjectClass.SCRIPT);
    assert.equal(specificObjectClassFrom('Input'), SpecificObjectClass.INPUT);
    assert.equal(specificObjectClassFrom('com.grenton.om.mobile.gui.MobileInterfaceTreeObject'), SpecificObjectClass.MOBILE_INTERFACE);
  });

  it('specificObjectClassFrom returns UNSUPPORTED for unknown', () => {
    assert.equal(specificObjectClassFrom(null), SpecificObjectClass.UNSUPPORTED);
    assert.equal(specificObjectClassFrom('SOMETHING_ELSE'), SpecificObjectClass.UNSUPPORTED);
  });
});

describe('SpecificObjectType', () => {
  it('has expected values', () => {
    assert.equal(SpecificObjectType.CLU, 'CLU');
    assert.equal(SpecificObjectType.DIMM, 'DIMM');
    assert.equal(SpecificObjectType.PANEL_TEMPERATURE, 'PANEL_TEMPERATURE');
  });

  it('specificObjectTypeFrom maps known raw values', () => {
    assert.equal(specificObjectTypeFrom('CLU'), SpecificObjectType.CLU);
    assert.equal(specificObjectTypeFrom('DIMM'), SpecificObjectType.DIMM);
    assert.equal(specificObjectTypeFrom('PANELSENSTEMP'), SpecificObjectType.PANEL_TEMPERATURE);
    assert.equal(specificObjectTypeFrom('PANELSENSLIGHT'), SpecificObjectType.PANEL_LUMINOSITY);
    assert.equal(specificObjectTypeFrom('AnalogOUT'), SpecificObjectType.ANALOG_OUT);
  });

  it('specificObjectTypeFrom returns UNSUPPORTED for unknown', () => {
    assert.equal(specificObjectTypeFrom(null), SpecificObjectType.UNSUPPORTED);
    assert.equal(specificObjectTypeFrom('UNKNOWN'), SpecificObjectType.UNSUPPORTED);
  });
});
