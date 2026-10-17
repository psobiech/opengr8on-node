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

// @ts-ignore - JS file in project
import { CLUClient } from '../CLUClient.js';

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

  private _getClient(): InstanceType<typeof CLUClient> | null {
    if (this._client != null) return this._client;

    const vs = this.virtualSystem;
    if (vs == null) return null;

    const localAddress = vs.localAddress;
    if (!localAddress) return null;

    const cipherKey = vs.getCipherKeyFor(this._remoteAddress);
    if (cipherKey == null) return null;

    const device = { address: this._remoteAddress };
    this._client = new CLUClient(localAddress, device, cipherKey);
    return this._client;
  }

  async remoteExecute(script: string): Promise<string | null> {
    const client = this._getClient();
    if (client == null) return null;
    try {
      return await client.execute(script) as string | null;
    } catch (e) {
      console.error(`[${this.name}] remote execute error:`, (e as Error).message);
      return null;
    }
  }

  remoteSet(objectName: string, featureIndex: number, value: LuaLike): void {
    const v = luaLiteral(value);
    void this.remoteExecute(`${objectName}:set(${featureIndex}, ${v})`);
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

  /** Proxy set: forwards to remote object with same name as this RemoteCLU. */
  override set(index: number, value: LuaLike): void {
    this.remoteSet(this.name, index, value);
  }

  /** Proxy execute: forwards method call to remote object. */
  override execute(index: number, ...args: LuaLike[]): LuaLike {
    this.remoteMethod(this.name, index, ...args);
    return null;
  }

  /** Find the interface definition for this object via ProjectRegistry + InterfaceRegistry. */
  findObjectInterface(): ParsedObject | null {
    const vs = this.virtualSystem;
    if (vs == null) return null;
    const pr = vs.getProjectRegistry();
    const ir = vs.getInterfaceRegistry();
    const clu = pr.getCluByIp(this._remoteAddress);
    if (clu == null) return null;
    const obj = pr.getObjectOnClu(clu.name, this.name);
    if (obj == null) return null;
    return ir.getObject(obj.typeName, 1);
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

    const publish = (integration: string, id: string, msg: object) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      (mqttClient as { publish: (t: string, p: string, o: object) => void })
        .publish(mqttDiscoveryTopic(prefix, integration, id), JSON.stringify(msg), { retain: true, qos: 1 });
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
        for (const f of spec.features) {
          const fId = `${uniqueId}_${f.index}`;
          publish('sensor', fId, mqttDiscoverySensor(f.name, fId, `${rootTopic}/feature/${f.index}`, {
            unit: f.unit, device,
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
      subscribe: (t: string, o: object) => void;
      on: (e: string, fn: unknown) => void;
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
        const cmd = parseJsonSafe(payload) as { state?: string } | null;
        const isOn = cmd?.state?.toUpperCase() !== 'OFF';
        this.remoteSet(this.name, spec.featureIndex, isOn ? 1 : 0);
        break;
      }
      case 'dimmer': {
        const cmd = parseJsonSafe(payload) as { state?: string; brightness?: number } | null;
        if (cmd?.state?.toUpperCase() === 'OFF') {
          this.remoteSet(this.name, spec.featureIndex, 0);
        } else if (cmd?.brightness != null) {
          this.remoteSet(this.name, spec.featureIndex, Math.max(0, Math.min(1, cmd.brightness / 255)));
        } else {
          this.remoteSet(this.name, spec.featureIndex, 1.0);
        }
        break;
      }
      case 'rgb_light': {
        const cmd = parseJsonSafe(payload) as { state?: string; color?: { r?: number; g?: number; b?: number; w?: number } } | null;
        if (cmd?.state?.toUpperCase() === 'OFF') {
          this.remoteSet(this.name, spec.rgbIndex, '#000000');
          this.remoteSet(this.name, spec.whiteIndex, 0);
        } else if (cmd?.color) {
          const r = Math.max(0, Math.min(255, cmd.color.r ?? 0));
          const g = Math.max(0, Math.min(255, cmd.color.g ?? 0));
          const b = Math.max(0, Math.min(255, cmd.color.b ?? 0));
          const w = Math.max(0, Math.min(255, cmd.color.w ?? 0));
          const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          this.remoteSet(this.name, spec.rgbIndex, hex);
          this.remoteSet(this.name, spec.whiteIndex, w / 255);
        }
        break;
      }
      case 'shutter': {
        if (topic === `${rootTopic}/set`) {
          const cmd = payload.trim().toUpperCase();
          if (cmd === 'STOP' && spec.stopMethodIndex != null) {
            this.remoteMethod(this.name, spec.stopMethodIndex);
          } else if (cmd === 'OPEN' && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, 100);
          } else if (cmd === 'CLOSE' && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, 0);
          }
        } else if (topic === `${rootTopic}/set_position`) {
          const pos = parseInt(payload.trim(), 10);
          if (!isNaN(pos) && spec.setPositionMethodIndex != null) {
            this.remoteMethod(this.name, spec.setPositionMethodIndex, Math.max(0, Math.min(100, pos)));
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
      (mqttClient as { publish: (t: string, p: string, o: object) => void })
        .publish(topic, payload, { retain: false, qos: 0 });
    };

    switch (spec.kind) {
      case 'temperature_sensor':
      case 'luminosity_sensor':
      case 'voltage_sensor': {
        const v = await this.remoteGet(this.name, spec.featureIndex);
        if (v !== null) publish(`${rootTopic}/state`, String(v));
        break;
      }
      case 'light_onoff': {
        const v = await this.remoteGet(this.name, spec.featureIndex);
        if (v !== null) {
          publish(`${rootTopic}/state`, JSON.stringify({ state: Number(v) > 0 ? 'ON' : 'OFF' }));
        }
        break;
      }
      case 'dimmer': {
        const v = await this.remoteGet(this.name, spec.featureIndex);
        if (v !== null) {
          const brightness = Math.round(Number(v) * 255);
          publish(`${rootTopic}/state`, JSON.stringify({ state: brightness > 0 ? 'ON' : 'OFF', brightness }));
        }
        break;
      }
      case 'rgb_light': {
        const [rgb, white] = await Promise.all([
          this.remoteGet(this.name, spec.rgbIndex),
          this.remoteGet(this.name, spec.whiteIndex),
        ]);
        if (rgb !== null) {
          const hex = String(rgb).replace(/^#/, '').padStart(6, '0');
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          const w = white != null ? Math.round(Number(white) * 255) : 0;
          publish(`${rootTopic}/state`, JSON.stringify({
            state: r > 0 || g > 0 || b > 0 || w > 0 ? 'ON' : 'OFF',
            color: { r, g, b, w },
          }));
        }
        break;
      }
      case 'shutter': {
        const v = await this.remoteGet(this.name, spec.positionIndex);
        if (v !== null) {
          const pos = Number(v);
          publish(`${rootTopic}/state`, pos >= 100 ? 'OPEN' : pos <= 0 ? 'CLOSE' : 'OPEN');
          publish(`${rootTopic}/position`, String(pos));
        }
        break;
      }
      // button, generic: no polling
    }
  }

  override close(): void {
    if (this._mqttClientRef != null && this._mqttMsgHandler != null) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (this._mqttClientRef as { off: (e: string, f: unknown) => void }).off('message', this._mqttMsgHandler);
      } catch { /* ignore */ }
      this._mqttClientRef = null;
      this._mqttMsgHandler = null;
    }
    if (this._client != null) {
      try { this._client.close(); } catch { /* ignore */ }
      this._client = null;
    }
  }
}

function resolveDeviceSpec(iface: ParsedObject): DeviceSpec {
  const n = iface.name.toUpperCase();
  const findF = (name: string) => iface.features.find(f => f.name.toLowerCase() === name.toLowerCase());
  const findM = (name: string) => iface.methods.find(m => m.name.toLowerCase() === name.toLowerCase());

  if (n.includes('TEMPERATURE')) {
    const f = findF('Value');
    if (f?.get) return { kind: 'temperature_sensor', featureIndex: f.index, unit: f.unit ?? '°C' };
  }
  if (n.includes('LUMINOSITY')) {
    const f = findF('Value');
    if (f?.get) return { kind: 'luminosity_sensor', featureIndex: f.index };
  }
  if (n.includes('VOLTAGE') || n.includes('POWER_SUPPLY')) {
    const f = findF('Value');
    if (f?.get) return { kind: 'voltage_sensor', featureIndex: f.index, unit: f.unit ?? 'V' };
  }
  if (n.includes('SHUTTER')) {
    const posF = findF('Position');
    if (posF?.get) {
      return {
        kind: 'shutter',
        positionIndex: posF.index,
        stopMethodIndex: findM('Stop')?.index ?? null,
        setPositionMethodIndex: (findM('SetPosition') ?? findM('Set position'))?.index ?? null,
      };
    }
  }
  if (n.startsWith('LED_RGB') || n.startsWith('R_LED_RGB')) {
    const rgb = findF('RGB');
    const red = findF('RedValue');
    const green = findF('GreenValue');
    const blue = findF('BlueValue');
    const white = findF('WhiteValue');
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
  if (n.includes('DIMM')) {
    const f = findF('Value');
    if (f?.get) return { kind: 'dimmer', featureIndex: f.index };
  }
  if (n.includes('DOUT') || n.includes('RELAY')) {
    const f = findF('Value');
    if (f?.get) return { kind: 'light_onoff', featureIndex: f.index };
  }
  if (n.includes('BUTTON')) {
    return { kind: 'button' };
  }

  return { kind: 'generic', features: iface.features.filter(f => f.get) };
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
  const n = Number(raw);
  if (!isNaN(n) && raw.trim() !== '') return n;
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

function parseJsonSafe(payload: string): unknown {
  try { return JSON.parse(payload); } catch { return null; }
}
