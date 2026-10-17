export declare const MQTT_AVAILABILITY_TOPIC = "opengr8on/available";
export declare function mqttRootTopic(cluName: string, objectName: string): string;
export declare function mqttCluRootTopic(cluName: string): string;
export declare function mqttDiscoveryTopic(prefix: string, integration: string, uniqueId: string): string;
export interface MqttDiscoveryOrigin {
    name: string;
    sw_version?: string;
    url: string;
}
export declare const MQTT_ORIGIN: MqttDiscoveryOrigin;
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
export interface MqttDiscoverySensor extends MqttDiscoveryBase {
    device_class?: string;
    unit_of_measurement?: string;
    value_template?: string;
}
export declare function mqttDiscoverySensor(name: string, uniqueId: string, rootTopic: string, opts?: {
    deviceClass?: string;
    unit?: string;
    valueTemplate?: string;
    device?: MqttDiscoveryDevice;
}): MqttDiscoverySensor;
export interface MqttDiscoveryLight extends MqttDiscoveryBase {
    supported_color_modes: string[];
}
export declare function mqttDiscoveryLight(name: string, uniqueId: string, rootTopic: string, colorModes: string[], opts?: {
    device?: MqttDiscoveryDevice;
}): MqttDiscoveryLight;
export interface MqttDiscoveryButton extends MqttDiscoveryBase {
    event_types: string[];
}
export declare function mqttDiscoveryButton(name: string, uniqueId: string, rootTopic: string, opts?: {
    device?: MqttDiscoveryDevice;
}): MqttDiscoveryButton;
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
export declare function mqttDiscoveryShutter(name: string, uniqueId: string, rootTopic: string, opts?: {
    device?: MqttDiscoveryDevice;
}): MqttDiscoveryShutter;
export interface MqttDiscoveryNumber extends MqttDiscoveryBase {
    'data-type': string;
    min: number;
    max: number;
}
export declare function mqttDiscoveryNumberInteger(name: string, uniqueId: string, rootTopic: string, min: number, max: number, opts?: {
    device?: MqttDiscoveryDevice;
}): MqttDiscoveryNumber;
export declare function mqttDiscoveryNumberFloat(name: string, uniqueId: string, rootTopic: string, min: number, max: number, opts?: {
    device?: MqttDiscoveryDevice;
}): MqttDiscoveryNumber;
//# sourceMappingURL=MqttDiscovery.d.ts.map