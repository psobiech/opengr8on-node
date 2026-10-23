import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VirtualCLU,
  CLU_STATE,
  CLU_FEATURES,
  CLU_METHODS,
  CLU_EVENTS,
} from '../../dist/vclu/VirtualCLU.js';

function makeClu() {
  return new VirtualCLU(null, '/tmp', 'TestCLU');
}

describe('VirtualCLU constants', () => {
  it('INDEX is 0', () => assert.equal(VirtualCLU.INDEX, 0));

  it('CLU_STATE values', () => {
    assert.equal(CLU_STATE.STARTING, 0);
    assert.equal(CLU_STATE.OK, 1);
    assert.equal(CLU_STATE.ERROR, 2);
    assert.equal(CLU_STATE.EMERGENCY, 4);
    assert.equal(CLU_STATE.MONITOR, 5);
  });

  it('CLU_EVENTS values', () => {
    assert.equal(CLU_EVENTS.INIT, 0);
    assert.equal(CLU_EVENTS.TIME_CHANGE, 13);
    assert.equal(CLU_EVENTS.MQTT_RECEIVE_VALUE, 20);
  });
});

describe('VirtualCLU features', () => {
  let clu;
  afterEach(() => clu?.close());

  it('UPTIME returns non-negative number', () => {
    clu = makeClu();
    const v = clu.get(CLU_FEATURES.UPTIME);
    assert.ok(typeof v === 'number' && v >= 0, `uptime=${v}`);
  });

  it('STATE starts at STARTING (0)', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.STATE), CLU_STATE.STARTING);
  });

  it('setState updates STATE feature', () => {
    clu = makeClu();
    clu.setState(CLU_STATE.OK);
    assert.equal(clu.get(CLU_FEATURES.STATE), CLU_STATE.OK);
    assert.equal(clu.state, CLU_STATE.OK);
  });

  it('setState EMERGENCY', () => {
    clu = makeClu();
    clu.setState(CLU_STATE.EMERGENCY);
    assert.equal(clu.get(CLU_FEATURES.STATE), CLU_STATE.EMERGENCY);
  });

  it('DATE returns YYYY-MM-DD', () => {
    clu = makeClu();
    const date = clu.get(CLU_FEATURES.DATE);
    assert.ok(typeof date === 'string', `date type: ${typeof date}`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date), `date format: ${date}`);
  });

  it('TIME returns HH:MM:SS', () => {
    clu = makeClu();
    const time = clu.get(CLU_FEATURES.TIME);
    assert.ok(typeof time === 'string', `time type: ${typeof time}`);
    assert.ok(/^\d{2}:\d{2}:\d{2}$/.test(time), `time format: ${time}`);
  });

  it('DAY_OF_MONTH is 1-31', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.DAY_OF_MONTH));
    assert.ok(v >= 1 && v <= 31, `day=${v}`);
  });

  it('MONTH is 1-12', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.MONTH));
    assert.ok(v >= 1 && v <= 12, `month=${v}`);
  });

  it('YEAR is current year or later', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.YEAR));
    assert.ok(v >= 2024, `year=${v}`);
  });

  it('DAY_OF_WEEK is 1-7 (ISO: Mon=1, Sun=7)', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.DAY_OF_WEEK));
    assert.ok(v >= 1 && v <= 7, `dow=${v}`);
  });

  it('HOUR is 0-23', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.HOUR));
    assert.ok(v >= 0 && v <= 23, `hour=${v}`);
  });

  it('MINUTE is 0-59', () => {
    clu = makeClu();
    const v = Number(clu.get(CLU_FEATURES.MINUTE));
    assert.ok(v >= 0 && v <= 59, `minute=${v}`);
  });

  it('TIMESTAMP is close to current unix time', () => {
    clu = makeClu();
    const ts = Number(clu.get(CLU_FEATURES.TIMESTAMP));
    const now = Date.now() / 1000;
    assert.ok(Math.abs(ts - now) < 5, `ts=${ts}, now=${now}`);
  });

  it('TIME_ZONE defaults to 0', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.TIME_ZONE), 0);
  });

  it('set TIME_ZONE affects date computation (UTC=22)', () => {
    clu = makeClu();
    clu.setValue(CLU_FEATURES.TIME_ZONE, 22); // UTC
    const hour = Number(clu.get(CLU_FEATURES.HOUR));
    const utcHour = new Date().getUTCHours();
    // Allow ±1 for midnight edge cases
    assert.ok(Math.abs(hour - utcHour) <= 1, `hour=${hour}, utcHour=${utcHour}`);
  });

  it('MQTT_URL defaults to ssl://localhost:8883', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.MQTT_URL), 'ssl://localhost:8883');
  });

  it('USE_MQTT defaults to false', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.USE_MQTT), false);
  });

  it('MQTT_CONNECTION defaults to false', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.MQTT_CONNECTION), false);
  });

  it('MQTT_DISCOVERY defaults to false', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.MQTT_DISCOVERY), false);
  });

  it('MQTT_DISCOVERY_PREFIX defaults to homeassistant', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.MQTT_DISCOVERY_PREFIX), 'homeassistant');
  });

  it('MQTT_MESSAGE defaults to null', () => {
    clu = makeClu();
    assert.equal(clu.get(CLU_FEATURES.MQTT_MESSAGE), null);
  });
});

describe('VirtualCLU setMqttConnected / isMqttEnabled / getMqttUrl', () => {
  let clu;
  afterEach(() => clu?.close());

  it('setMqttConnected updates MQTT_CONNECTION', () => {
    clu = makeClu();
    clu.setMqttConnected(true);
    assert.equal(clu.get(CLU_FEATURES.MQTT_CONNECTION), true);
    clu.setMqttConnected(false);
    assert.equal(clu.get(CLU_FEATURES.MQTT_CONNECTION), false);
  });

  it('isMqttEnabled reflects USE_MQTT', () => {
    clu = makeClu();
    assert.equal(clu.isMqttEnabled(), false);
    clu.setValue(CLU_FEATURES.USE_MQTT, true);
    assert.equal(clu.isMqttEnabled(), true);
  });

  it('getMqttUrl returns MQTT_URL string', () => {
    clu = makeClu();
    const url = clu.getMqttUrl();
    assert.equal(typeof url, 'string');
    assert.ok(url.length > 0);
  });
});

describe('VirtualCLU methods', () => {
  let clu;
  afterEach(() => clu?.close());

  it('ADD_TO_LOG returns null', () => {
    clu = makeClu();
    assert.equal(clu.execute(CLU_METHODS.ADD_TO_LOG, 'test message'), null);
  });

  it('CLEAR_LOG returns null', () => {
    clu = makeClu();
    assert.equal(clu.execute(CLU_METHODS.CLEAR_LOG), null);
  });
});

describe('VirtualCLU LOG feature', () => {
  let clu;
  afterEach(() => clu?.close());

  it('LOG feature (index 1) returns string or null after ADD_TO_LOG', () => {
    clu = makeClu();
    clu.execute(CLU_METHODS.ADD_TO_LOG, 'hello log');
    const log = clu.get(CLU_FEATURES.LOG);
    assert.ok(log === null || typeof log === 'string');
  });
});

describe('VirtualCLU close', () => {
  it('close does not throw', () => {
    const clu = makeClu();
    assert.doesNotThrow(() => clu.close());
  });
});
