export const MQTT_AVAILABILITY_TOPIC = 'opengr8on/available';
export function mqttRootTopic(cluName, objectName) {
    return `opengr8on/clu/${cluName}/object/${objectName}`;
}
export function mqttCluRootTopic(cluName) {
    return `opengr8on/clu/${cluName}`;
}
export function mqttDiscoveryTopic(prefix, integration, uniqueId) {
    return `${prefix}/${integration}/${uniqueId}/config`;
}
export const MQTT_ORIGIN = {
    name: 'opengr8on',
    url: 'https://github.com/psobiech/opengr8on',
};
function base(name, uniqueId, rootTopic, opts = {}) {
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
export function mqttDiscoverySensor(name, uniqueId, rootTopic, opts = {}) {
    return {
        ...base(name, uniqueId, rootTopic),
        device_class: opts.deviceClass,
        unit_of_measurement: opts.unit,
        value_template: opts.valueTemplate,
        device: opts.device,
    };
}
export function mqttDiscoveryLight(name, uniqueId, rootTopic, colorModes, opts = {}) {
    return {
        ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, schema: 'json' }),
        supported_color_modes: colorModes,
        device: opts.device,
    };
}
export function mqttDiscoveryButton(name, uniqueId, rootTopic, opts = {}) {
    return {
        ...base(name, uniqueId, rootTopic),
        event_types: ['press'],
        device: opts.device,
    };
}
export function mqttDiscoveryShutter(name, uniqueId, rootTopic, opts = {}) {
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
export function mqttDiscoveryNumberInteger(name, uniqueId, rootTopic, min, max, opts = {}) {
    return {
        ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, value_template: '{{ value | int }}' }),
        'data-type': 'int64',
        min,
        max,
        device: opts.device,
    };
}
export function mqttDiscoveryNumberFloat(name, uniqueId, rootTopic, min, max, opts = {}) {
    return {
        ...base(name, uniqueId, rootTopic, { command_topic: `${rootTopic}/set`, value_template: '{{ value | float }}' }),
        'data-type': 'float32',
        min,
        max,
        device: opts.device,
    };
}
