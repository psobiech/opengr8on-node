import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mqttStateFrom,
  mqttBrightnessState,
  mqttRgbwState,
  parseShutterState,
  MQTT_PRESS_EVENT,
} from '../../src/vclu/MqttState.js';

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
    const s = mqttBrightnessState(50);
    assert.equal(s.state, 'ON');
    assert.equal(s.brightness, 50);
    assert.equal(s.color_mode, 'brightness');
  });

  it('brightness = 0 → OFF', () => {
    const s = mqttBrightnessState(0);
    assert.equal(s.state, 'OFF');
    assert.equal(s.brightness, 0);
  });

  it('brightness = 255', () => {
    const s = mqttBrightnessState(255);
    assert.equal(s.state, 'ON');
    assert.equal(s.brightness, 255);
  });
});

describe('mqttRgbwState', () => {
  it('all zeros → OFF', () => {
    const s = mqttRgbwState(0, 0, 0, 0);
    assert.equal(s.state, 'OFF');
    assert.equal(s.brightness, 0);
  });

  it('any non-zero → ON', () => {
    const s = mqttRgbwState(255, 0, 0, 0);
    assert.equal(s.state, 'ON');
  });

  it('color fields set correctly', () => {
    const s = mqttRgbwState(10, 20, 30, 40);
    assert.equal(s.color.r, 10);
    assert.equal(s.color.g, 20);
    assert.equal(s.color.b, 30);
    assert.equal(s.color.w, 40);
  });

  it('brightness is max channel', () => {
    const s = mqttRgbwState(10, 200, 50, 100);
    assert.equal(s.brightness, 200);
  });

  it('color_mode is rgbw', () => {
    assert.equal(mqttRgbwState(0, 0, 0, 0).color_mode, 'rgbw');
  });
});

describe('parseShutterState', () => {
  const valid = ['OPEN', 'OPENING', 'CLOSE', 'CLOSING', 'STOP'];
  for (const s of valid) {
    it(`${s} → ${s}`, () => assert.equal(parseShutterState(s), s));
    it(`lowercase ${s.toLowerCase()} → ${s}`, () => assert.equal(parseShutterState(s.toLowerCase()), s));
  }

  it('unknown string → null', () => assert.equal(parseShutterState('UNKNOWN'), null));
  it('empty string → null', () => assert.equal(parseShutterState(''), null));
});

describe('MQTT_PRESS_EVENT', () => {
  it('event_type is "press"', () => {
    assert.equal(MQTT_PRESS_EVENT.event_type, 'press');
  });
});
