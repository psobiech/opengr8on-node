import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mqttStateFrom,
  mqttBrightnessState,
  mqttRgbwState,
  parseShutterState,
  MQTT_PRESS_EVENT,
} from '../../dist/vclu/MqttState.js';

describe('mqttStateFrom', () => {
  it('true → ON', () => assert.equal(mqttStateFrom(true), 'ON'));
  it('false → OFF', () => assert.equal(mqttStateFrom(false), 'OFF'));
  it('non-zero number → ON', () => assert.equal(mqttStateFrom(1), 'ON'));
  it('zero → OFF', () => assert.equal(mqttStateFrom(0), 'OFF'));
  it('negative → ON', () => assert.equal(mqttStateFrom(-1), 'ON'));
  it('100 → ON', () => assert.equal(mqttStateFrom(100), 'ON'));
});

describe('mqttBrightnessState', () => {
  it('brightness > 0 → ON', () => {
    const state = mqttBrightnessState(50);
    assert.equal(state.state, 'ON');
    assert.equal(state.brightness, 50);
    assert.equal(state.color_mode, 'brightness');
  });

  it('brightness = 0 → OFF', () => {
    const state = mqttBrightnessState(0);
    assert.equal(state.state, 'OFF');
    assert.equal(state.brightness, 0);
  });

  it('brightness = 255', () => {
    const state = mqttBrightnessState(255);
    assert.equal(state.state, 'ON');
    assert.equal(state.brightness, 255);
  });
});

describe('mqttRgbwState', () => {
  it('all zeros → OFF', () => {
    const state = mqttRgbwState(0, 0, 0, 0);
    assert.equal(state.state, 'OFF');
    assert.equal(state.brightness, 0);
  });

  it('any non-zero → ON', () => {
    const state = mqttRgbwState(255, 0, 0, 0);
    assert.equal(state.state, 'ON');
  });

  it('color fields set correctly', () => {
    const state = mqttRgbwState(10, 20, 30, 40);
    assert.equal(state.color.r, 10);
    assert.equal(state.color.g, 20);
    assert.equal(state.color.b, 30);
    assert.equal(state.color.w, 40);
  });

  it('brightness is max channel', () => {
    const state = mqttRgbwState(10, 200, 50, 100);
    assert.equal(state.brightness, 200);
  });

  it('color_mode is rgbw', () => {
    assert.equal(mqttRgbwState(0, 0, 0, 0).color_mode, 'rgbw');
  });
});

describe('parseShutterState', () => {
  const valid = ['OPEN', 'OPENING', 'CLOSE', 'CLOSING', 'STOP'];
  for (const state of valid) {
    it(`${state} → ${state}`, () => assert.equal(parseShutterState(state), state));
    it(`lowercase ${state.toLowerCase()} → ${state}`, () => assert.equal(parseShutterState(state.toLowerCase()), state));
  }

  it('unknown string → null', () => assert.equal(parseShutterState('UNKNOWN'), null));
  it('empty string → null', () => assert.equal(parseShutterState(''), null));
});

describe('MQTT_PRESS_EVENT', () => {
  it('event_type is "press"', () => {
    assert.equal(MQTT_PRESS_EVENT.event_type, 'press');
  });
});
