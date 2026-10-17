import { VirtualObject } from './VirtualObject.js';
import { CLU_STATE } from './VirtualCLU.js';
import type { IVirtualSystem, LuaLike } from './types.js';

export const MQTT_TOPIC_FEATURES = {
  TOPIC: 0,
  MESSAGE: 1,
} as const;

export const MQTT_TOPIC_METHODS = {
  SUBSCRIBE: 0,
  UNSUBSCRIBE: 1,
  PUBLISH: 10,
} as const;

export const MQTT_TOPIC_EVENTS = {
  INIT: 0,
  MESSAGE: 1,
} as const;

interface Message {
  payload: Buffer;
  ack: (() => void) | null;
}

export class MqttTopic extends VirtualObject {
  static readonly INDEX = 999;
  static readonly FEATURES = MQTT_TOPIC_FEATURES;
  static readonly METHODS = MQTT_TOPIC_METHODS;
  static readonly EVENTS = MQTT_TOPIC_EVENTS;

  private _subscriptions = new Set<string>();
  private _messageQueue: Array<{ topic: string; msg: Message }> = [];
  private _loopPending = false;
  private _messageHandlerRegistered = false;

  constructor(virtualSystem: IVirtualSystem | null, name: string) {
    super(virtualSystem, name);

    this.setValue(MQTT_TOPIC_FEATURES.TOPIC, null);
    this.setValue(MQTT_TOPIC_FEATURES.MESSAGE, null);

    this.registerMethod(MQTT_TOPIC_METHODS.SUBSCRIBE, (topic) =>
      this._subscribe(String(topic ?? '')),
    );
    this.registerMethod(MQTT_TOPIC_METHODS.UNSUBSCRIBE, (topic) =>
      this._unsubscribe(String(topic ?? '')),
    );
    this.registerMethod(MQTT_TOPIC_METHODS.PUBLISH, (topic, message) =>
      this._publish(topic, message),
    );
  }

  override setup(): void {
    const clu = this.virtualSystem?.getVirtualClu();
    if (clu?.state !== CLU_STATE.OK) return;
    this.triggerEvent(MQTT_TOPIC_EVENTS.INIT);
  }

  private _getMqttClient(): unknown {
    return this.virtualSystem?.getVirtualClu().getMqttClient() ?? null;
  }

  private _subscribe(topic: string): boolean {
    const client = this._getMqttClient();
    if (client == null) return false;

    try {
      this._subscriptions.add(topic);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).subscribe(topic, { qos: 1 }, (err: Error | null) => {
        if (err) console.error(`[${this.name}] subscribe error:`, err);
      });
      if (!this._messageHandlerRegistered) {
        this._messageHandlerRegistered = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).on('message', (t: string, payload: Buffer) => {
          this._onMessage(t, payload);
        });
      }
      return true;
    } catch (e) {
      console.error(`[${this.name}] subscribe error:`, e);
      return false;
    }
  }

  private _unsubscribe(topic: string): boolean {
    const client = this._getMqttClient();
    if (client == null) return false;

    try {
      this._subscriptions.delete(topic);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).unsubscribe(topic);
      return true;
    } catch (e) {
      console.error(`[${this.name}] unsubscribe error:`, e);
      return false;
    }
  }

  private _publish(topicArg: LuaLike, messageArg: LuaLike): boolean {
    const client = this._getMqttClient();
    if (client == null) return false;

    const topic = topicArg != null ? String(topicArg) : String(this.get(MQTT_TOPIC_FEATURES.TOPIC) ?? '');
    if (!topic) return false;

    if (this._subscriptions.has(topic)) {
      console.warn(`[${this.name}] publish to subscribed topic ${topic} ignored (prevents loop)`);
      return false;
    }

    const message = messageArg != null ? messageArg : this.get(MQTT_TOPIC_FEATURES.MESSAGE);
    const payload = typeof message === 'object' && message !== null
      ? JSON.stringify(message)
      : String(message ?? '');

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).publish(topic, payload);
      return true;
    } catch (e) {
      console.error(`[${this.name}] publish error:`, e);
      return false;
    }
  }

  private _onMessage(topic: string, payload: Buffer): void {
    if (!this._isSubscribedTo(topic)) return;

    this._messageQueue.push({ topic, msg: { payload, ack: null } });
    if (!this._loopPending) {
      this._loopPending = true;
      setImmediate(() => this._drainQueue());
    }
  }

  private _isSubscribedTo(topic: string): boolean {
    for (const pattern of this._subscriptions) {
      if (mqttTopicMatches(pattern, topic)) return true;
    }
    return false;
  }

  private _drainQueue(): void {
    this._loopPending = false;
    this.loop();
  }

  override loop(): void {
    if (this.getValue(MQTT_TOPIC_FEATURES.MESSAGE) != null) return;

    const entry = this._messageQueue.shift();
    if (entry == null) return;

    void this._processMessage(entry).catch(
      (e) => console.error(`[${this.name}] message handler error:`, e),
    );
  }

  private async _processMessage(entry: { topic: string; msg: Message }): Promise<void> {
    await this.awaitEventTrigger(MQTT_TOPIC_EVENTS.MESSAGE);
    this.setValue(MQTT_TOPIC_FEATURES.TOPIC, entry.topic);
    this.setValue(MQTT_TOPIC_FEATURES.MESSAGE, parsePayload(entry.msg.payload));
    await this.runEvent(MQTT_TOPIC_EVENTS.MESSAGE);
    entry.msg.ack?.();
    this.clearValue(MQTT_TOPIC_FEATURES.MESSAGE);
    if (this._messageQueue.length > 0) {
      setImmediate(() => this._drainQueue());
    }
  }

  override close(): void {
    this._messageQueue.length = 0;
  }
}

function parsePayload(payload: Buffer): LuaLike {
  const text = payload.toString('utf8');
  try {
    const parsed = JSON.parse(text) as LuaLike;
    if (typeof parsed === 'string') return parsed;
    return parsed;
  } catch {
    return text;
  }
}

function mqttTopicMatches(pattern: string, topic: string): boolean {
  const pParts = pattern.split('/');
  const tParts = topic.split('/');

  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === '#') return true;
    if (pParts[i] !== '+' && pParts[i] !== tParts[i]) return false;
  }

  return pParts.length === tParts.length;
}
