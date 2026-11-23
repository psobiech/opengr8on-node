import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, IVirtualCLU, LuaLike } from './types.js';
import type { ParsedObject, ParsedFeature } from '../parsers/interfaces/InterfaceRegistry.js';
import { CLU_FEATURES } from './VirtualCLU.js';
import {
  mqttDiscoverySensor,
  mqttDiscoveryTopic,
  mqttDiscoveryLight,
  mqttDiscoveryButton,
  mqttDiscoveryShutter,
  mqttRootTopic,
  type MqttDiscoveryDevice,
} from './MqttDiscovery.js';

import { CLUClient } from '../CLUClient.js';
import { CLUDevice } from '../device/CLUDevice.js';
import type { CipherKey } from '../CipherKey.js';

export const REMOTE_CLU_METHODS = {
  EXECUTE: 0,
} as const;

type DeviceSpec =
  | { kind: 'temperature_sensor'; featureIndex: number; unit: string }
  | { kind: 'luminosity_sensor'; featureIndex: number }
  | { kind: 'voltage_sensor'; featureIndex: number; unit: string }
  | { kind: 'light_onoff'; featureIndex: number }
  | { kind: 'dimmer'; featureIndex: number }
  | { kind: 'rgb_light'; rgbIndex: number; redIndex: number; greenIndex: number; blueIndex: number; whiteIndex: number }
  | { kind: 'shutter'; positionIndex: number; stopMethodIndex: number | null; setPositionMethodIndex: number | null }
  | { kind: 'button' }
  | { kind: 'generic'; features: ParsedFeature[] };

/**
 * Proxy for a remote CLU. Forwards get/set/execute calls as LuaScript commands
 * over UDP to the remote CLU at the configured address.
 *
 * Created when Lua calls OBJECT:new(1, ipAddress, name).
 */
export class RemoteCLU extends VirtualObject {
  static readonly INDEX = 1;
  static readonly METHODS = REMOTE_CLU_METHODS;

  private readonly _remoteAddress: string;
  private _client: InstanceType<typeof CLUClient> | null = null;
  private _mqttDiscoveryPublished = false;
  private _deviceSpec: DeviceSpec | null = null;
  private _lastStatePollMs = 0;
  private _pendingStatePoll = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _mqttClientRef: any = null;
  private _mqttMsgHandler: ((topic: string, payload: Buffer) => void) | null = null;

  constructor(virtualSystem: IVirtualSystem | null, name: string, remoteAddress: string) {
    super(virtualSystem, name);
    this._remoteAddress = remoteAddress;
  }

  /** Proxy set: forwards to remote object with same name as this RemoteCLU. */
  override set(index: number, value: LuaLike): void {
    this.remoteSet(this.name, index, value);
  }

  /** Proxy execute: forwards method call to remote object. */
  override execute(index: number, ...args: LuaLike[]): LuaLike {
    this.remoteMethod(this.name, index, ...args);
    return null;
  }

  override loop(): void {
    const clu = this.virtualSystem?.getVirtualClu();
    if (clu == null) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mqttClient = clu.getMqttClient();
    if (mqttClient == null) return;
    if (!clu.getValue(CLU_FEATURES.MQTT_DISCOVERY)) return;

    if (!this._mqttDiscoveryPublished) {
      const iface = this.findObjectInterface();
      if (iface == null) return;
      this._deviceSpec = resolveDeviceSpec(iface);
      this._publishMqttDiscovery(iface, mqttClient, clu);
      this._subscribeCommands(mqttClient, clu);
      this._mqttDiscoveryPublished = true;
    }

    const now = Date.now();
    if (!this._pendingStatePoll && now - this._lastStatePollMs >= 1000) {
      this._lastStatePollMs = now;
      this._pendingStatePoll = true;
      void this._pollAndPublishState(mqttClient, clu).finally(() => {
        this._pendingStatePoll = false;
      });
    }
  }

  override close(): void {
    if (this._mqttClientRef != null && this._mqttMsgHandler != null) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (this._mqttClientRef as { off: (event: string, listener: unknown) => void }).off('message', this._mqttMsgHandler);
      } catch { /* ignore */ }
      this._mqttClientRef = null;
      this._mqttMsgHandler = null;
    }
    if (this._client != null) {
      try { this._client.close(); } catch { /* ignore */ }
      this._client = null;
    }
  }

  /** Find the interface definition for this object via ProjectRegistry + InterfaceRegistry. */
  findObjectInterface(): ParsedObject | null {
    const virtualSystem = this.virtualSystem;
    if (virtualSystem == null) return null;
    const projectRegistry = virtualSystem.getProjectRegistry();
    const interfaceRegistry = virtualSystem.getInterfaceRegistry();
    const clu = projectRegistry.getCluByIp(this._remoteAddress);
    if (clu == null) return null;
    const projectObject = projectRegistry.getObjectOnClu(clu.name, this.name);
    if (projectObject == null) return null;
    return interfaceRegistry.getObject(projectObject.typeName, 1);
  }

  private _publishMqttDiscovery(iface: ParsedObject, mqttClient: unknown, clu: IVirtualCLU): void {
    const prefix = String(clu.getValue(CLU_FEATURES.MQTT_DISCOVERY_PREFIX) ?? 'homeassistant');
    const rootTopic = mqttRootTopic(clu.name, this.name);
    const uniqueId = `${clu.name}_${this.name}`;
    const device: MqttDiscoveryDevice = {
      identifiers: [uniqueId],
      name: this.name,
      manufacturer: 'Grenton',
      model: iface.name,
    };

    const publish = (integration: string, id: string, message: object) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      (mqttClient as { publish: (topic: string, payload: string, options: object) => void })
        .publish(mqttDiscoveryTopic(prefix, integration, id), JSON.stringify(message), { retain: true, qos: 1 });
    };

    const spec = this._deviceSpec!;

    switch (spec.kind) {
      case 'temperature_sensor':
        publish('sensor', uniqueId, mqttDiscoverySensor(this.name, uniqueId, rootTopic, {
          deviceClass: 'temperature', unit: spec.unit, valueTemplate: '{{ value | float }}', device,
        }));
        break;

      case 'luminosity_sensor':
        publish('sensor', uniqueId, mqttDiscoverySensor(this.name, uniqueId, rootTopic, {
          unit: '%', valueTemplate: '{{ value | float }}', device,
        }));
        break;

      case 'voltage_sensor':
        publish('sensor', uniqueId, mqttDiscoverySensor(this.name, uniqueId, rootTopic, {
          deviceClass: 'voltage', unit: spec.unit, valueTemplate: '{{ value | float }}', device,
        }));
        break;

      case 'light_onoff':
        publish('light', uniqueId, mqttDiscoveryLight(this.name, uniqueId, rootTopic, ['on_off'], { device }));
        break;

      case 'dimmer':
        publish('light', uniqueId, mqttDiscoveryLight(this.name, uniqueId, rootTopic, ['brightness'], { device }));
        break;

      case 'rgb_light':
        publish('light', uniqueId, mqttDiscoveryLight(this.name, uniqueId, rootTopic, ['rgbw'], { device }));
        break;

      case 'shutter':
        publish('cover', uniqueId, mqttDiscoveryShutter(this.name, uniqueId, rootTopic, { device }));
        break;

      case 'button':
        publish('event', uniqueId, mqttDiscoveryButton(this.name, uniqueId, rootTopic, { device }));
        break;

      case 'generic':
        for (const feature of spec.features) {
          const featureUniqueId = `${uniqueId}_${feature.index}`;
          publish('sensor', featureUniqueId, mqttDiscoverySensor(feature.name, featureUniqueId, `${rootTopic}/feature/${feature.index}`, {
            unit: feature.unit, device,
          }));
        }
        break;
    }
  }

  private _subscribeCommands(mqttClient: unknown, clu: IVirtualCLU): void {
    const spec = this._deviceSpec;
    if (!spec) return;

    const rootTopic = mqttRootTopic(clu.name, this.name);
    const commandTopics: string[] = [];

    switch (spec.kind) {
      case 'light_onoff':
      case 'dimmer':
      case 'rgb_light':
        commandTopics.push(`${rootTopic}/set`);
        break;
      case 'shutter':
        commandTopics.push(`${rootTopic}/set`, `${rootTopic}/set_position`);
        break;
      default:
        return;
    }

    const client = mqttClient as {
      subscribe: (topic: string, options: object) => void;
      on: (event: string, listener: unknown) => void;
    };
    for (const topic of commandTopics) {
      client.subscribe(topic, { qos: 1 });
    }

    const topicSet = new Set(commandTopics);
    this._mqttClientRef = mqttClient;
    this._mqttMsgHandler = (topic: string, payload: Buffer) => {
      if (topicSet.has(topic)) {
        this._handleMqttCommand(topic, payload.toString(), rootTopic);
      }
    };
    client.on('message', this._mqttMsgHandler);
  }

  private _handleMqttCommand(topic: string, payload: string, rootTopic: string): void {
    const spec = this._deviceSpec;
    if (!spec) return;

    switch (spec.kind) {
      case 'light_onoff': {
        const command = parseJsonSafe(payload) as { state?: string } | null;
        const isOn = command?.state?.toUpperCase() !== 'OFF';
        this.remoteSet(this.name, spec.featureIndex, isOn ? 1 : 0);
        break;
      }
      case 'dimmer': {
        const command = parseJsonSafe(payload) as { state?: string; brightness?: number } | null;
        if (command?.state?.toUpperCase() === 'OFF') {
          this.remoteSet(this.name, spec.featureIndex, 0);
        } else if (command?.brightness != null) {
          this.remoteSet(this.name, spec.featureIndex, Math.max(0, Math.min(1, command.brightness / 255)));
        } else {
          this.remoteSet(this.name, spec.featureIndex, 1.0);
        }
        break;
      }
      case 'rgb_light': {
        const command = parseJsonSafe(payload) as { state?: string; color?: { r?: number; g?: number; b?: number; w?: number } } | null;
        if (command?.state?.toUpperCase() === 'OFF') {
          this.remoteSet(this.name, spec.rgbIndex, '#000000');
          this.remoteSet(this.name, spec.whiteIndex, 0);
        } else if (command?.color) {
          const red = Math.max(0, Math.min(255, command.color.r ?? 0));
          const green = Math.max(0, Math.min(255, command.color.g ?? 0));
          const blue = Math.max(0, Math.min(255, command.color.b ?? 0));
          const white = Math.max(0, Math.min(255, command.color.w ?? 0));
          const hex = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
          this.remoteSet(this.name, spec.rgbIndex, hex);
          this.remoteSet(this.name, spec.whiteIndex, white / 255);
        }
        break;
      }
      case 'shutter': {
        if (topic === `${rootTopic}/set`) {
          const command = payload.trim().toUpperCase();
          if (command === 'STOP' && spec.stopMethodIndex != null) {
            this.remoteMethod(this.name, spec.stopMethodIndex);
          } else if (command === 'OPEN' && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, 100);
          } else if (command === 'CLOSE' && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, 0);
          }
        } else if (topic === `${rootTopic}/set_position`) {
          const position = parseInt(payload.trim(), 10);
          if (!isNaN(position) && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, Math.max(0, Math.min(100, position)));
          }
        }
        break;
      }
    }
  }

  private async _pollAndPublishState(mqttClient: unknown, clu: IVirtualCLU): Promise<void> {
    const spec = this._deviceSpec;
    if (!spec) return;

    const rootTopic = mqttRootTopic(clu.name, this.name);
    const publish = (topic: string, payload: string) => {
      (mqttClient as { publish: (topic: string, payload: string, options: object) => void })
        .publish(topic, payload, { retain: false, qos: 0 });
    };

    switch (spec.kind) {
      case 'temperature_sensor':
      case 'luminosity_sensor':
      case 'voltage_sensor': {
        const featureValue = await this.remoteGet(this.name, spec.featureIndex);
        if (featureValue !== null) publish(`${rootTopic}/state`, String(featureValue));
        break;
      }
      case 'light_onoff': {
        const featureValue = await this.remoteGet(this.name, spec.featureIndex);
        if (featureValue !== null) {
          publish(`${rootTopic}/state`, JSON.stringify({ state: Number(featureValue) > 0 ? 'ON' : 'OFF' }));
        }
        break;
      }
      case 'dimmer': {
        const featureValue = await this.remoteGet(this.name, spec.featureIndex);
        if (featureValue !== null) {
          const brightness = Math.round(Number(featureValue) * 255);
          publish(`${rootTopic}/state`, JSON.stringify({ state: brightness > 0 ? 'ON' : 'OFF', brightness }));
        }
        break;
      }
      case 'rgb_light': {
        const [rgbValue, whiteValue] = await Promise.all([
          this.remoteGet(this.name, spec.rgbIndex),
          this.remoteGet(this.name, spec.whiteIndex),
        ]);
        if (rgbValue !== null) {
          const hex = String(rgbValue).replace(/^#/, '').padStart(6, '0');
          const red = parseInt(hex.slice(0, 2), 16);
          const green = parseInt(hex.slice(2, 4), 16);
          const blue = parseInt(hex.slice(4, 6), 16);
          const white = whiteValue != null ? Math.round(Number(whiteValue) * 255) : 0;
          publish(`${rootTopic}/state`, JSON.stringify({
            state: red > 0 || green > 0 || blue > 0 || white > 0 ? 'ON' : 'OFF',
            color: { r: red, g: green, b: blue, w: white },
          }));
        }
        break;
      }
      case 'shutter': {
        const featureValue = await this.remoteGet(this.name, spec.positionIndex);
        if (featureValue !== null) {
          const position = Number(featureValue);
          publish(`${rootTopic}/state`, position >= 100 ? 'OPEN' : position <= 0 ? 'CLOSE' : 'OPEN');
          publish(`${rootTopic}/position`, String(position));
        }
        break;
      }
      // button, generic: no polling
    }
  }

  remoteSet(objectName: string, featureIndex: number, value: LuaLike): void {
    const valueLiteral = luaLiteral(value);
    void this.remoteExecute(`${objectName}:set(${featureIndex}, ${valueLiteral})`);
  }

  async remoteGet(objectName: string, featureIndex: number): Promise<LuaLike> {
    const result = await this.remoteExecute(`${objectName}:get(${featureIndex})`);
    return parseRemoteResult(result);
  }

  remoteMethod(objectName: string, methodIndex: number, ...args: LuaLike[]): void {
    const argStr = args.map(luaLiteral).join(', ');
    const script = args.length > 0
      ? `${objectName}:execute(${methodIndex}, ${argStr})`
      : `${objectName}:execute(${methodIndex})`;
    void this.remoteExecute(script);
  }

  async remoteExecute(script: string): Promise<string | null> {
    const client = this._getClient();
    if (client == null) return null;
    try {
      return await client.execute(script) as string | null;
    } catch (error) {
      console.error(`[${this.name}] remote execute error:`, (error as Error).message);
      return null;
    }
  }

  private _getClient(): InstanceType<typeof CLUClient> | null {
    if (this._client != null) return this._client;

    const virtualSystem = this.virtualSystem;
    if (virtualSystem == null) return null;

    const localAddress = virtualSystem.localAddress;
    if (!localAddress) return null;

    const cipherKey = virtualSystem.getCipherKeyFor(this._remoteAddress);
    if (cipherKey == null) return null;

    const device = new CLUDevice({ address: this._remoteAddress });
    this._client = new CLUClient(localAddress, device, cipherKey as CipherKey);
    return this._client;
  }
}

function resolveDeviceSpec(iface: ParsedObject): DeviceSpec {
  const upperName = iface.name.toUpperCase();
  const findFeature = (name: string) => iface.features.find(feature => feature.name.toLowerCase() === name.toLowerCase());
  const findMethod = (name: string) => iface.methods.find(method => method.name.toLowerCase() === name.toLowerCase());

  if (upperName.includes('TEMPERATURE')) {
    const valueFeature = findFeature('Value');
    if (valueFeature?.get) return { kind: 'temperature_sensor', featureIndex: valueFeature.index, unit: valueFeature.unit ?? '°C' };
  }
  if (upperName.includes('LUMINOSITY')) {
    const valueFeature = findFeature('Value');
    if (valueFeature?.get) return { kind: 'luminosity_sensor', featureIndex: valueFeature.index };
  }
  if (upperName.includes('VOLTAGE') || upperName.includes('POWER_SUPPLY')) {
    const valueFeature = findFeature('Value');
    if (valueFeature?.get) return { kind: 'voltage_sensor', featureIndex: valueFeature.index, unit: valueFeature.unit ?? 'V' };
  }
  if (upperName.includes('SHUTTER')) {
    const positionFeature = findFeature('Position');
    if (positionFeature?.get) {
      return {
        kind: 'shutter',
        positionIndex: positionFeature.index,
        stopMethodIndex: findMethod('Stop')?.index ?? null,
        setPositionMethodIndex: (findMethod('SetPosition') ?? findMethod('Set position'))?.index ?? null,
      };
    }
  }
  if (upperName.startsWith('LED_RGB') || upperName.startsWith('R_LED_RGB')) {
    const rgb = findFeature('RGB');
    const red = findFeature('RedValue');
    const green = findFeature('GreenValue');
    const blue = findFeature('BlueValue');
    const white = findFeature('WhiteValue');
    if (rgb && red && green && blue && white) {
      return {
        kind: 'rgb_light',
        rgbIndex: rgb.index,
        redIndex: red.index,
        greenIndex: green.index,
        blueIndex: blue.index,
        whiteIndex: white.index,
      };
    }
  }
  if (upperName.includes('DIMM')) {
    const valueFeature = findFeature('Value');
    if (valueFeature?.get) return { kind: 'dimmer', featureIndex: valueFeature.index };
  }
  if (upperName.includes('DOUT') || upperName.includes('RELAY')) {
    const valueFeature = findFeature('Value');
    if (valueFeature?.get) return { kind: 'light_onoff', featureIndex: valueFeature.index };
  }
  if (upperName.includes('BUTTON')) {
    return { kind: 'button' };
  }

  return { kind: 'generic', features: iface.features.filter(feature => feature.get) };
}

function parseJsonSafe(payload: string): unknown {
  try { return JSON.parse(payload); } catch { return null; }
}

function luaLiteral(value: LuaLike): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(value)) return `{${value.map(luaLiteral).join(',')}}`;
  return JSON.stringify(value);
}

function parseRemoteResult(raw: string | null): LuaLike {
  if (raw === null || raw === 'nil') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const numericValue = Number(raw);
  if (!isNaN(numericValue) && raw.trim() !== '') return numericValue;
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}
