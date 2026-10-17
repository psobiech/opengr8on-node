export const MQTT_AVAILABILITY_TOPIC = 'opengr8on/available';

export function mqttRootTopic(cluName: string, objectName: string): string {
  return `opengr8on/clu/${cluName}/object/${objectName}`;
}

export function mqttCluRootTopic(cluName: string): string {
  return `opengr8on/clu/${cluName}`;
}

export function mqttDiscoveryTopic(prefix: string, integration: string, uniqueId: string): string {
  return `${prefix}/${integration}/${uniqueId}/config`;
}

export interface MqttDiscoveryOrigin {
  name: string;
  sw_version?: string;
  url: string;
}

export const MQTT_ORIGIN: MqttDiscoveryOrigin = {
  name: 'opengr8on',
  url: 'https://github.com/psobiech/opengr8on',
};

export interface MqttDiscoveryDevice {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model?: string;
  serial_number?: string;
  sw_version?: string;
  hw_version?: string;
  connections?: [string, string][];
  via_device?: string;
}

export interface MqttDiscoveryBase {
  name: string;
  unique_id: string;
  '~': string;
  availability_topic: string;
  availability_mode: string;
  state_topic: string;
  command_topic?: string;
  device_class?: string;
  unit_of_measurement?: string;
  schema?: string;
  value_template?: string;
  device?: MqttDiscoveryDevice;
  origin: MqttDiscoveryOrigin;
}

function base(
  name: string,
  uniqueId: string,
  rootTopic: string,
  opts: Partial<MqttDiscoveryBase> = {},
): MqttDiscoveryBase {
  return {
    name,
    unique_id: uniqueId,
    '~': rootTopic,
    availability_topic: MQTT_AVAILABILITY_TOPIC,
    availability_mode: 'latest',
    state_topic: `${rootTopic}/state`,
    origin: MQTT_ORIGIN,
    ...opts,
  };
}

export interface MqttDiscoverySensor extends MqttDiscoveryBase {
  device_class?: string;
  unit_of_measurement?: string;
  value_template?: string;
}

export function mqttDiscoverySensor(
  name: string,
  uniqueId: string,
  rootTopic: string,
  opts: { deviceClass?: string; unit?: string; valueTemplate?: string; device?: MqttDiscoveryDevice } = {},
): MqttDiscoverySensor {
  return {
    ...base(name, uniqueId, rootTopic),
    device_class: opts.deviceClass,
    unit_of_measurement: opts.unit,
    value_template: opts.valueTemplate,
    device: opts.device,
  };
}

export interface MqttDiscoveryLight extends MqttDiscoveryBase {
  supported_color_modes: string[];
}

export function mqttDiscoveryLight(
  name: string,
  uniqueId: string,
  rootTopic: string,
  colorModes: string[],
  opts: { device?: MqttDiscoveryDevice } = {},
): MqttDiscoveryLight {
  return {
    ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, schema: 'json' }),
    supported_color_modes: colorModes,
    device: opts.device,
  };
}

export interface MqttDiscoveryButton extends MqttDiscoveryBase {
  event_types: string[];
}

export function mqttDiscoveryButton(
  name: string,
  uniqueId: string,
  rootTopic: string,
  opts: { device?: MqttDiscoveryDevice } = {},
): MqttDiscoveryButton {
  return {
    ...base(name, uniqueId, rootTopic),
    event_types: ['press'],
    device: opts.device,
  };
}

export interface MqttDiscoveryShutter extends MqttDiscoveryBase {
  position_topic: string;
  set_position_topic: string;
  set_position_template: string;
  state_open: string;
  state_opening: string;
  state_closing: string;
  state_closed: string;
  state_stopped: string;
}

export function mqttDiscoveryShutter(
  name: string,
  uniqueId: string,
  rootTopic: string,
  opts: { device?: MqttDiscoveryDevice } = {},
): MqttDiscoveryShutter {
  return {
    ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set` }),
    position_topic: `${rootTopic}/position`,
    set_position_topic: `${rootTopic}/set_position`,
    set_position_template: '{{ position }}',
    state_open: 'OPEN',
    state_opening: 'OPENING',
    state_closing: 'CLOSING',
    state_closed: 'CLOSE',
    state_stopped: 'STOP',
    device: opts.device,
  };
}

export interface MqttDiscoveryNumber extends MqttDiscoveryBase {
  'data-type': string;
  min: number;
  max: number;
}

export function mqttDiscoveryNumberInteger(
  name: string,
  uniqueId: string,
  rootTopic: string,
  min: number,
  max: number,
  opts: { device?: MqttDiscoveryDevice } = {},
): MqttDiscoveryNumber {
  return {
    ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, value_template: '{{ value | int }}' }),
    'data-type': 'int64',
    min,
    max,
    device: opts.device,
  };
}

export function mqttDiscoveryNumberFloat(
  name: string,
  uniqueId: string,
  rootTopic: string,
  min: number,
  max: number,
  opts: { device?: MqttDiscoveryDevice } = {},
): MqttDiscoveryNumber {
  return {
    ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, value_template: '{{ value | float }}' }),
    'data-type': 'float32',
    min,
    max,
    device: opts.device,
  };
}
