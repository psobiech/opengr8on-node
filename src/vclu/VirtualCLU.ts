import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { VirtualObject } from './VirtualObject.js';
import { cluTimeZoneId } from './CLUTimeZone.js';
import { MQTT_AVAILABILITY_TOPIC } from './MqttDiscovery.js';
import type { IVirtualSystem, LuaLike } from './types.js';

export const CLU_STATE = {
  STARTING: 0,
  OK: 1,
  ERROR: 2,
  EMERGENCY: 4,
  MONITOR: 5,
} as const;
export type CluState = (typeof CLU_STATE)[keyof typeof CLU_STATE];

export const CLU_FEATURES = {
  UPTIME: 0,
  LOG: 1,
  STATE: 2,
  DATE: 5,
  TIME: 6,
  DAY_OF_MONTH: 7,
  MONTH: 8,
  YEAR: 9,
  DAY_OF_WEEK: 10,
  HOUR: 11,
  MINUTE: 12,
  TIMESTAMP: 13,
  TIME_ZONE: 14,
  MQTT_URL: 20,
  USE_MQTT: 21,
  MQTT_CONNECTION: 22,
  MQTT_DISCOVERY: 23,
  MQTT_DISCOVERY_PREFIX: 24,
  MQTT_MESSAGE: 25,
} as const;

export const CLU_METHODS = {
  ADD_TO_LOG: 0,
  CLEAR_LOG: 1,
  MQTT_SEND_DISCOVERY: 20,
  MQTT_SEND_VALUE: 21,
  MQTT_ON_VALUE_CHANGE: 30,
} as const;

export const CLU_EVENTS = {
  INIT: 0,
  TIME_CHANGE: 13,
  MQTT_RECEIVE_VALUE: 20,
} as const;


interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // ISO: Mon=1..Sun=7
}

interface MqttCapable {
  mqttOnValueChange(objectId: LuaLike, fn: LuaLike): void;
}

function isMqttCapable(obj: unknown): obj is MqttCapable {
  return typeof (obj as MqttCapable).mqttOnValueChange === 'function';
}

export class VirtualCLU extends VirtualObject {
  static readonly INDEX = 0;
  static readonly FEATURES = CLU_FEATURES;
  static readonly METHODS = CLU_METHODS;
  static readonly EVENTS = CLU_EVENTS;

  readonly rootDirectory: string;

  private _state: CluState = CLU_STATE.STARTING;
  private _currentDate = new Date();
  private _lastMinute = -1;
  private _timeChangeTimer: NodeJS.Timeout | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _mqttClient: any = null;
  private _mqttStartPending = false;
  /** topic → callback; prevents duplicate on('message') bindings */
  private _mqttTopicHandlers = new Map<string, (payload: Buffer) => void>();

  constructor(virtualSystem: IVirtualSystem | null, rootDirectory: string, name: string) {
    super(virtualSystem, name);
    this.rootDirectory = rootDirectory;

    this.registerFeature(CLU_FEATURES.UPTIME, () => Math.floor(process.uptime()));
    this.setValue(CLU_FEATURES.STATE, CLU_STATE.STARTING);
    this.registerFeature(CLU_FEATURES.DATE, () => this._formatDate());
    this.registerFeature(CLU_FEATURES.TIME, () => this._formatTime());
    this.registerFeature(CLU_FEATURES.DAY_OF_MONTH, () => this._tzParts().day);
    this.registerFeature(CLU_FEATURES.MONTH, () => this._tzParts().month);
    this.registerFeature(CLU_FEATURES.YEAR, () => this._tzParts().year);
    this.registerFeature(CLU_FEATURES.DAY_OF_WEEK, () => this._tzParts().weekday);
    this.registerFeature(CLU_FEATURES.HOUR, () => this._tzParts().hour);
    this.registerFeature(CLU_FEATURES.MINUTE, () => this._tzParts().minute);
    this.registerFeature(CLU_FEATURES.TIMESTAMP, () =>
      Math.floor(this._currentDate.getTime() / 1000),
    );
    this.setValue(CLU_FEATURES.TIME_ZONE, 0);
    this.setValue(CLU_FEATURES.MQTT_URL, 'ssl://localhost:8883');
    this.setValue(CLU_FEATURES.USE_MQTT, false);
    this.setValue(CLU_FEATURES.MQTT_CONNECTION, false);
    this.setValue(CLU_FEATURES.MQTT_DISCOVERY, false);
    this.setValue(CLU_FEATURES.MQTT_DISCOVERY_PREFIX, 'homeassistant');
    this.setValue(CLU_FEATURES.MQTT_MESSAGE, null);

    this.registerMethod(CLU_METHODS.ADD_TO_LOG, (msg) => this._addToLog(msg as string));
    this.registerMethod(CLU_METHODS.CLEAR_LOG, () => this._clearLog());
    this.registerMethod(
      CLU_METHODS.MQTT_SEND_DISCOVERY,
      (name, uniqueId, deviceClass, unit, valueTemplate) =>
        this._mqttSendDiscovery(
          name as string,
          uniqueId as string,
          deviceClass as string | null,
          unit as string | null,
          valueTemplate as string | null,
        ),
    );
    this.registerMethod(CLU_METHODS.MQTT_SEND_VALUE, (uniqueId, stateVal) =>
      this._mqttSendValue(uniqueId as string, String(stateVal ?? '')),
    );
    this.registerMethod(CLU_METHODS.MQTT_ON_VALUE_CHANGE, (objectId, fn) =>
      this._mqttOnValueChange(objectId as string, fn),
    );

    this._timeChangeTimer = setInterval(() => {
      this._currentDate = new Date();
      const minute = this._tzParts().minute;
      if (this._lastMinute !== -1 && minute !== this._lastMinute) {
        this.triggerEvent(CLU_EVENTS.TIME_CHANGE);
      }
      this._lastMinute = minute;
    }, 1000);
  }

  private _tz(): string {
    return cluTimeZoneId(Number(this.getValue(CLU_FEATURES.TIME_ZONE) ?? 0));
  }

  private _tzParts(): TzParts {
    const tz = this._tz();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(this._currentDate);

    const get = (type: string): number => {
      const v = parts.find((p) => p.type === type)?.value ?? '0';
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };
    const wdStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const wdIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wdStr);
    const isoWd = wdIndex === 0 ? 7 : wdIndex > 0 ? wdIndex : 1;
    // hour12:false can return 24 for midnight in some locales
    const rawHour = get('hour');

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: rawHour === 24 ? 0 : rawHour,
      minute: get('minute'),
      second: get('second'),
      weekday: isoWd,
    };
  }

  private _formatDate(): string {
    const p = this._tzParts();
    return [
      p.year,
      String(p.month).padStart(2, '0'),
      String(p.day).padStart(2, '0'),
    ].join('-');
  }

  private _formatTime(): string {
    const p = this._tzParts();
    return [p.hour, p.minute, p.second]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  }

  get state(): CluState {
    return this._state;
  }

  setState(state: CluState): void {
    this._state = state;
    this.setValue(CLU_FEATURES.STATE, state);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMqttClient(): any {
    return this._mqttClient;
  }

  setMqttConnected(connected: boolean): void {
    this.setValue(CLU_FEATURES.MQTT_CONNECTION, connected);
  }

  isMqttEnabled(): boolean {
    return Boolean(this.get(CLU_FEATURES.USE_MQTT));
  }

  getMqttUrl(): string {
    return String(this.get(CLU_FEATURES.MQTT_URL) ?? '');
  }

  override loop(): void {
    const enabled = this.isMqttEnabled();
    if (!enabled && this._mqttClient != null) {
      this._mqttClient.end();
      this._mqttClient = null;
      this._mqttTopicHandlers.clear();
    }
    if (enabled && this._mqttClient == null && !this._mqttStartPending) {
      this._mqttStartPending = true;
      this._startMqtt().finally(() => {
        this._mqttStartPending = false;
      });
    }
  }

  private async _startMqtt(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mqttLib: typeof import('mqtt');
    try {
      mqttLib = await import('mqtt');
    } catch {
      console.warn('[VirtualCLU] mqtt package not installed — MQTT features disabled');
      this.setValue(CLU_FEATURES.USE_MQTT, false);
      return;
    }

    const url = this.getMqttUrl();
    const parentDir = resolve(this.rootDirectory, '..');
    const mqttDir = resolve(parentDir, 'mqtt');

    const connectOptions: Record<string, unknown> = {
      clientId: `${this._name}/${Date.now()}`,
      clean: false,
      keepalive: 10,
      connectTimeout: 4000,
      reconnectPeriod: 1000,
      will: {
        topic: MQTT_AVAILABILITY_TOPIC,
        payload: 'offline',
        retain: true,
        qos: 1,
      },
    };

    const caCertPath = resolve(mqttDir, 'ca.crt');
    const certPath = resolve(mqttDir, 'certificate.crt');
    const keyPath = resolve(mqttDir, 'key.pem');
    if (existsSync(caCertPath)) {
      connectOptions['ca'] = readFileSync(caCertPath);
    }
    if (existsSync(certPath) && existsSync(keyPath)) {
      connectOptions['cert'] = readFileSync(certPath);
      connectOptions['key'] = readFileSync(keyPath);
    }

    try {
      const client = mqttLib.connect(url, connectOptions);
      this._mqttClient = client;

      client.on('connect', () => {
        this.setMqttConnected(true);
        client.publish(MQTT_AVAILABILITY_TOPIC, 'online', { retain: true, qos: 1 });
      });
      client.on('close', () => this.setMqttConnected(false));
      client.on('error', (e: Error) =>
        console.error(`[${this._name}] MQTT error:`, e.message),
      );

      // single global message dispatcher
      client.on('message', (topic: string, payload: Buffer) => {
        this._mqttTopicHandlers.get(topic)?.(payload);
      });
    } catch (e) {
      console.error(`[${this._name}] MQTT connect error:`, e);
    }
  }

  private _addToLog(msg: LuaLike): null {
    this.setValue(CLU_FEATURES.LOG, msg);
    if (msg !== null && msg !== undefined) {
      console.info(`[${this._name}] ${msg}`);
    }
    return null;
  }

  private _clearLog(): null {
    this.setValue(CLU_FEATURES.LOG, null);
    return null;
  }

  private _mqttSendDiscovery(
    name: string,
    uniqueId: string,
    deviceClass: string | null,
    unit: string | null,
    valueTemplate: string | null,
  ): null {
    if (this._mqttClient == null) return null;
    const prefix = String(this.get(CLU_FEATURES.MQTT_DISCOVERY_PREFIX) ?? 'homeassistant');
    const rootTopic = `${prefix}/sensor/${uniqueId}`;
    const setTopic = `${rootTopic}/set`;

    const config: Record<string, unknown> = {
      name,
      unique_id: uniqueId,
      command_topic: setTopic,
      state_topic: `${rootTopic}/state`,
      availability_topic: MQTT_AVAILABILITY_TOPIC,
    };
    if (deviceClass != null) config['device_class'] = deviceClass;
    if (unit != null) config['unit_of_measurement'] = unit;
    if (valueTemplate != null) config['value_template'] = valueTemplate;

    this._mqttClient.publish(`${rootTopic}/config`, JSON.stringify(config), {
      retain: true,
      qos: 1,
    });

    if (!this._mqttTopicHandlers.has(setTopic)) {
      this._mqttClient.subscribe(setTopic, { qos: 1 });
      this._mqttTopicHandlers.set(setTopic, (payload: Buffer) => {
        try {
          const parsed = JSON.parse(payload.toString()) as LuaLike;
          this.setValue(CLU_FEATURES.MQTT_MESSAGE, parsed);
        } catch {
          this.setValue(CLU_FEATURES.MQTT_MESSAGE, payload.toString());
        }
        this.triggerEvent(CLU_EVENTS.MQTT_RECEIVE_VALUE);
      });
    }

    return null;
  }

  private _mqttSendValue(uniqueId: string, state: string): null {
    if (this._mqttClient == null) return null;
    const prefix = String(this.get(CLU_FEATURES.MQTT_DISCOVERY_PREFIX) ?? 'homeassistant');
    this._mqttClient.publish(`${prefix}/sensor/${uniqueId}/state`, state);
    return null;
  }

  private _mqttOnValueChange(objectId: LuaLike, fn: LuaLike): null {
    if (this.virtualSystem == null || typeof objectId !== 'string') return null;
    const parts = objectId.split('->');
    if (parts.length !== 2) return null;
    const [cluName] = parts;
    const obj = this.virtualSystem.getObject(cluName);
    if (isMqttCapable(obj)) {
      obj.mqttOnValueChange(objectId, fn);
    }
    return null;
  }

  override close(): void {
    if (this._timeChangeTimer != null) {
      clearInterval(this._timeChangeTimer);
      this._timeChangeTimer = null;
    }
    if (this._mqttClient != null) {
      try {
        this._mqttClient.publish(MQTT_AVAILABILITY_TOPIC, 'offline', { retain: true, qos: 1 });
      } catch { /* ignore */ }
      this._mqttClient.end();
      this._mqttClient = null;
    }
    this._mqttTopicHandlers.clear();
  }
}
