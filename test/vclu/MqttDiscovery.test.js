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
} from '../../dist/vclu/MqttDiscovery.js';

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
  const sensor = mqttDiscoverySensor('My Sensor', 'uid1', root);

  it('availability_topic is MQTT_AVAILABILITY_TOPIC', () => {
    assert.equal(sensor.availability_topic, MQTT_AVAILABILITY_TOPIC);
  });

  it('state_topic is {root}/state', () => {
    assert.equal(sensor.state_topic, `${root}/state`);
  });

  it('~ is root topic', () => {
    assert.equal(sensor['~'], root);
  });

  it('unique_id set', () => {
    assert.equal(sensor.unique_id, 'uid1');
  });

  it('origin is MQTT_ORIGIN', () => {
    assert.deepEqual(sensor.origin, MQTT_ORIGIN);
  });
});

describe('mqttDiscoverySensor', () => {
  const root = mqttRootTopic('CLU1', 'Sensor1');

  it('no opts → device_class and unit undefined', () => {
    const discovery = mqttDiscoverySensor('Sensor', 'uid', root);
    assert.equal(discovery.device_class, undefined);
    assert.equal(discovery.unit_of_measurement, undefined);
  });

  it('deviceClass option', () => {
    const discovery = mqttDiscoverySensor('Sensor', 'uid', root, { deviceClass: 'temperature' });
    assert.equal(discovery.device_class, 'temperature');
  });

  it('unit option', () => {
    const discovery = mqttDiscoverySensor('Sensor', 'uid', root, { unit: '°C' });
    assert.equal(discovery.unit_of_measurement, '°C');
  });

  it('valueTemplate option', () => {
    const discovery = mqttDiscoverySensor('Sensor', 'uid', root, { valueTemplate: '{{ value | int }}' });
    assert.equal(discovery.value_template, '{{ value | int }}');
  });
});

describe('mqttDiscoveryLight', () => {
  const root = mqttRootTopic('CLU1', 'Light1');
  const discovery = mqttDiscoveryLight('Light', 'uid', root, ['brightness']);

  it('has command_topic', () => {
    assert.equal(discovery.command_topic, `${root}/set`);
  });

  it('schema is json', () => {
    assert.equal(discovery.schema, 'json');
  });

  it('supported_color_modes matches arg', () => {
    assert.deepEqual(discovery.supported_color_modes, ['brightness']);
  });
});

describe('mqttDiscoveryButton', () => {
  const root = mqttRootTopic('CLU1', 'Btn1');
  const discovery = mqttDiscoveryButton('Button', 'uid', root);

  it('event_types includes press', () => {
    assert.ok(discovery.event_types.includes('press'));
  });
});

describe('mqttDiscoveryShutter', () => {
  const root = mqttRootTopic('CLU1', 'Shutter1');
  const discovery = mqttDiscoveryShutter('Shutter', 'uid', root);

  it('position_topic is {root}/position', () => {
    assert.equal(discovery.position_topic, `${root}/position`);
  });

  it('set_position_topic is {root}/set_position', () => {
    assert.equal(discovery.set_position_topic, `${root}/set_position`);
  });

  it('state_open is OPEN', () => assert.equal(discovery.state_open, 'OPEN'));
  it('state_closed is CLOSE', () => assert.equal(discovery.state_closed, 'CLOSE'));
  it('state_stopped is STOP', () => assert.equal(discovery.state_stopped, 'STOP'));

  it('command_topic set', () => {
    assert.equal(discovery.command_topic, `${root}/set`);
  });
});

describe('mqttDiscoveryNumberInteger', () => {
  const root = mqttRootTopic('CLU1', 'Num1');
  const discovery = mqttDiscoveryNumberInteger('Number', 'uid', root, 0, 100);

  it('min and max', () => {
    assert.equal(discovery.min, 0);
    assert.equal(discovery.max, 100);
  });

  it('data-type is int64', () => {
    assert.equal(discovery['data-type'], 'int64');
  });

  it('value_template uses int', () => {
    assert.ok(discovery.value_template?.includes('int'));
  });
});

describe('mqttDiscoveryNumberFloat', () => {
  const root = mqttRootTopic('CLU1', 'Float1');
  const discovery = mqttDiscoveryNumberFloat('Float', 'uid', root, 0.0, 1.0);

  it('data-type is float32', () => {
    assert.equal(discovery['data-type'], 'float32');
  });

  it('value_template uses float', () => {
    assert.ok(discovery.value_template?.includes('float'));
  });
});
