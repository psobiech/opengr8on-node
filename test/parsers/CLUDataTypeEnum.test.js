import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLUDataTypeEnum, cluDataTypeOf } from '../../src/parsers/interfaces/CLUDataTypeEnum.js';

describe('CLUDataTypeEnum', () => {
  it('has expected values', () => {
    assert.equal(CLUDataTypeEnum.VOID, 'void');
    assert.equal(CLUDataTypeEnum.NUMBER, 'num');
    assert.equal(CLUDataTypeEnum.STRING, 'str');
    assert.equal(CLUDataTypeEnum.BOOLEAN, 'confirmation');
    assert.equal(CLUDataTypeEnum.TIMESTAMP, 'timestamp');
  });

  it('is frozen', () => {
    assert.throws(() => { CLUDataTypeEnum.NEW = 'x'; });
  });

  it('cluDataTypeOf returns key for known type', () => {
    assert.equal(cluDataTypeOf('num'), 'NUMBER');
    assert.equal(cluDataTypeOf('str'), 'STRING');
    assert.equal(cluDataTypeOf('void'), 'VOID');
    assert.equal(cluDataTypeOf('confirmation'), 'BOOLEAN');
    assert.equal(cluDataTypeOf('timestamp'), 'TIMESTAMP');
  });

  it('cluDataTypeOf throws for unknown type', () => {
    assert.throws(() => cluDataTypeOf('unknown'), /Unsupported data type/);
  });
});
