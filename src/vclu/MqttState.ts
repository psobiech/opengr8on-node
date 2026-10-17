export type MqttStateValue = 'ON' | 'OFF';

export function mqttStateFrom(value: number | boolean): MqttStateValue {
  return (typeof value === 'boolean' ? value : value !== 0) ? 'ON' : 'OFF';
}

export interface MqttState {
  state: MqttStateValue;
}

export interface MqttBrightnessState extends MqttState {
  color_mode: 'brightness';
  brightness: number;
}

export function mqttBrightnessState(brightness: number): MqttBrightnessState {
  return { state: brightness > 0 ? 'ON' : 'OFF', color_mode: 'brightness', brightness };
}

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

export function mqttRgbwState(r: number, g: number, b: number, w: number): MqttRgbwState {
  const on = r + g + b + w > 0;
  return {
    state: on ? 'ON' : 'OFF',
    color_mode: 'rgbw',
    brightness: Math.max(r, g, b, w),
    color: { r, g, b, w },
  };
}

export type ShutterState = 'OPEN' | 'OPENING' | 'CLOSE' | 'CLOSING' | 'STOP';

export function parseShutterState(s: string): ShutterState | null {
  const u = s.toUpperCase() as ShutterState;
  return (['OPEN', 'OPENING', 'CLOSE', 'CLOSING', 'STOP'] as ShutterState[]).includes(u) ? u : null;
}

export interface MqttPosition {
  position: number;
}

export interface MqttEvent {
  event_type: string;
}

export const MQTT_PRESS_EVENT: MqttEvent = { event_type: 'press' };
