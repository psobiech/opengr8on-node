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

export function mqttRgbwState(red: number, green: number, blue: number, white: number): MqttRgbwState {
  const isOn = red + green + blue + white > 0;
  return {
    state: isOn ? 'ON' : 'OFF',
    color_mode: 'rgbw',
    brightness: Math.max(red, green, blue, white),
    color: { r: red, g: green, b: blue, w: white },
  };
}

export type ShutterState = 'OPEN' | 'OPENING' | 'CLOSE' | 'CLOSING' | 'STOP';

export function parseShutterState(rawState: string): ShutterState | null {
  const upperState = rawState.toUpperCase() as ShutterState;
  return (['OPEN', 'OPENING', 'CLOSE', 'CLOSING', 'STOP'] as ShutterState[]).includes(upperState) ? upperState : null;
}

export interface MqttPosition {
  position: number;
}

export interface MqttEvent {
  event_type: string;
}

export const MQTT_PRESS_EVENT: MqttEvent = { event_type: 'press' };
