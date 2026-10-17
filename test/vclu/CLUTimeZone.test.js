import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLU_TIMEZONE_IDS, cluTimeZoneId } from '../../src/vclu/CLUTimeZone.js';

describe('CLUTimeZone', () => {
  it('has 23 entries', () => {
    assert.equal(CLU_TIMEZONE_IDS.length, 23);
  });

  it('index 0 is Europe/Warsaw', () => {
    assert.equal(cluTimeZoneId(0), 'Europe/Warsaw');
  });

  it('index 22 is UTC', () => {
    assert.equal(cluTimeZoneId(22), 'UTC');
  });

  it('clips negative to index 0', () => {
    assert.equal(cluTimeZoneId(-5), CLU_TIMEZONE_IDS[0]);
  });

  it('clips overflow to last index', () => {
    assert.equal(cluTimeZoneId(100), CLU_TIMEZONE_IDS[22]);
  });

  it('all IDs are valid IANA timezone strings', () => {
    for (const tz of CLU_TIMEZONE_IDS) {
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat('en', { timeZone: tz }),
        `Invalid IANA timezone: ${tz}`,
      );
    }
  });

  it('all indices 0-22 return a string', () => {
    for (let i = 0; i <= 22; i++) {
      const tz = cluTimeZoneId(i);
      assert.equal(typeof tz, 'string');
      assert.ok(tz.length > 0);
    }
  });
});
