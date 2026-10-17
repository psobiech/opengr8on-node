import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MQTT_AVAILABILITY_TOPIC,
  mqttRootTopic,
  mqttCluRootTopic,
  mqttDiscoveryTopic,
  MQTT_ORIGIN,
  mqttDiscoverySensor,
  mqttDiscoveryLight,
  mqttDiscoveryButton,
  mqttDiscoveryShutter,
  mqttDiscoveryNumberInteger,
  mqttDiscoveryNumberFloat,
} from '../../src/vclu/MqttDiscovery.js';

describe('MQTT_AVAILABILITY_TOPIC', () => {
  it('is opengr8on/available', () => {
    assert.equal(MQTT_AVAILABILITY_TOPIC, 'opengr8on/available');
  });
});

describe('mqttRootTopic', () => {
  it('format: opengr8on/clu/{clu}/object/{obj}', () => {
    assert.equal(mqttRootTopic('CLU1', 'DIM1'), 'opengr8on/clu/CLU1/object/DIM1');
  });
});

describe('mqttCluRootTopic', () => {
  it('format: opengr8on/clu/{clu}', () => {
    assert.equal(mqttCluRootTopic('MY_CLU'), 'opengr8on/clu/MY_CLU');
  });
});

describe('mqttDiscoveryTopic', () => {
  it('format: {prefix}/{integration}/{uniqueId}/config', () => {
    assert.equal(
      mqttDiscoveryTopic('homeassistant', 'sensor', 'my_sensor'),
      'homeassistant/sensor/my_sensor/config',
    );
  });
});

describe('MQTT_ORIGIN', () => {
  it('has name opengr8on', () => assert.equal(MQTT_ORIGIN.name, 'opengr8on'));
  it('has url field', () => assert.ok(typeof MQTT_ORIGIN.url === 'string' && MQTT_ORIGIN.url.length > 0));
});

describe('common base fields', () => {
  const root = mqttRootTopic('CLU1', 'OBJ1');
  const s = mqttDiscoverySensor('My Sensor', 'uid1', root);

  it('availability_topic is MQTT_AVAILABILITY_TOPIC', () => {
    assert.equal(s.availability_topic, MQTT_AVAILABILITY_TOPIC);
  });

  it('state_topic is {root}/state', () => {
    assert.equal(s.state_topic, `${root}/state`);
  });

  it('~ is root topic', () => {
    assert.equal(s['~'], root);
  });

  it('unique_id set', () => {
    assert.equal(s.unique_id, 'uid1');
  });

  it('origin is MQTT_ORIGIN', () => {
    assert.deepEqual(s.origin, MQTT_ORIGIN);
  });
});

describe('mqttDiscoverySensor', () => {
  const root = mqttRootTopic('CLU1', 'Sensor1');

  it('no opts → device_class and unit undefined', () => {
    const d = mqttDiscoverySensor('Sensor', 'uid', root);
    assert.equal(d.device_class, undefined);
    assert.equal(d.unit_of_measurement, undefined);
  });

  it('deviceClass option', () => {
    const d = mqttDiscoverySensor('Sensor', 'uid', root, { deviceClass: 'temperature' });
    assert.equal(d.device_class, 'temperature');
  });

  it('unit option', () => {
    const d = mqttDiscoverySensor('Sensor', 'uid', root, { unit: '°C' });
    assert.equal(d.unit_of_measurement, '°C');
  });

  it('valueTemplate option', () => {
    const d = mqttDiscoverySensor('Sensor', 'uid', root, { valueTemplate: '{{ value | int }}' });
    assert.equal(d.value_template, '{{ value | int }}');
  });
});

describe('mqttDiscoveryLight', () => {
  const root = mqttRootTopic('CLU1', 'Light1');
  const d = mqttDiscoveryLight('Light', 'uid', root, ['brightness']);

  it('has command_topic', () => {
    assert.equal(d.command_topic, `${root}/set`);
  });

  it('schema is json', () => {
    assert.equal(d.schema, 'json');
  });

  it('supported_color_modes matches arg', () => {
    assert.deepEqual(d.supported_color_modes, ['brightness']);
  });
});

describe('mqttDiscoveryButton', () => {
  const root = mqttRootTopic('CLU1', 'Btn1');
  const d = mqttDiscoveryButton('Button', 'uid', root);

  it('event_types includes press', () => {
    assert.ok(d.event_types.includes('press'));
  });
});

describe('mqttDiscoveryShutter', () => {
  const root = mqttRootTopic('CLU1', 'Shutter1');
  const d = mqttDiscoveryShutter('Shutter', 'uid', root);

  it('position_topic is {root}/position', () => {
    assert.equal(d.position_topic, `${root}/position`);
  });

  it('set_position_topic is {root}/set_position', () => {
    assert.equal(d.set_position_topic, `${root}/set_position`);
  });

  it('state_open is OPEN', () => assert.equal(d.state_open, 'OPEN'));
  it('state_closed is CLOSE', () => assert.equal(d.state_closed, 'CLOSE'));
  it('state_stopped is STOP', () => assert.equal(d.state_stopped, 'STOP'));

  it('command_topic set', () => {
    assert.equal(d.command_topic, `${root}/set`);
  });
});

describe('mqttDiscoveryNumberInteger', () => {
  const root = mqttRootTopic('CLU1', 'Num1');
  const d = mqttDiscoveryNumberInteger('Number', 'uid', root, 0, 100);

  it('min and max', () => {
    assert.equal(d.min, 0);
    assert.equal(d.max, 100);
  });

  it('data-type is int64', () => {
    assert.equal(d['data-type'], 'int64');
  });

  it('value_template uses int', () => {
    assert.ok(d.value_template?.includes('int'));
  });
});

describe('mqttDiscoveryNumberFloat', () => {
  const root = mqttRootTopic('CLU1', 'Float1');
  const d = mqttDiscoveryNumberFloat('Float', 'uid', root, 0.0, 1.0);

  it('data-type is float32', () => {
    assert.equal(d['data-type'], 'float32');
  });

  it('value_template uses float', () => {
    assert.ok(d.value_template?.includes('float'));
  });
});
