export type MqttStateValue = 'ON' | 'OFF';
export declare function mqttStateFrom(value: number | boolean): MqttStateValue;
export interface MqttState {
    state: MqttStateValue;
}
export interface MqttBrightnessState extends MqttState {
    color_mode: 'brightness';
    brightness: number;
}
export declare function mqttBrightnessState(brightness: number): MqttBrightnessState;
export interface RgbwColor {
    r: number;
    g: number;
    b: number;
    w: number;
}
export interface MqttRgbwState extends MqttState {
    color_mode: 'rgbw';
    brightness: number;
    color: RgbwColor;
}
export declare function mqttRgbwState(r: number, g: number, b: number, w: number): MqttRgbwState;
export type ShutterState = 'OPEN' | 'OPENING' | 'CLOSE' | 'CLOSING' | 'STOP';
export declare function parseShutterState(s: string): ShutterState | null;
export interface MqttPosition {
    position: number;
}
export interface MqttEvent {
    event_type: string;
}
export declare const MQTT_PRESS_EVENT: MqttEvent;
//# sourceMappingURL=MqttState.d.ts.map