import { VirtualObject } from './VirtualObject.js';
export const MQTT_TOPIC_FEATURES = {
    TOPIC: 0,
    MESSAGE: 1,
};
export const MQTT_TOPIC_METHODS = {
    SUBSCRIBE: 0,
    UNSUBSCRIBE: 1,
    PUBLISH: 10,
};
export const MQTT_TOPIC_EVENTS = {
    INIT: 0,
    MESSAGE: 1,
};
export class MqttTopic extends VirtualObject {
    static INDEX = 999;
    static FEATURES = MQTT_TOPIC_FEATURES;
    static METHODS = MQTT_TOPIC_METHODS;
    static EVENTS = MQTT_TOPIC_EVENTS;
    _subscriptions = new Set();
    _messageQueue = [];
    _loopPending = false;
    _messageHandlerRegistered = false;
    constructor(virtualSystem, name) {
        super(virtualSystem, name);
        this.setValue(MQTT_TOPIC_FEATURES.TOPIC, null);
        this.setValue(MQTT_TOPIC_FEATURES.MESSAGE, null);
        this.registerMethod(MQTT_TOPIC_METHODS.SUBSCRIBE, (topic) => this._subscribe(String(topic ?? '')));
        this.registerMethod(MQTT_TOPIC_METHODS.UNSUBSCRIBE, (topic) => this._unsubscribe(String(topic ?? '')));
        this.registerMethod(MQTT_TOPIC_METHODS.PUBLISH, (topic, message) => this._publish(topic, message));
    }
    setup() {
        const clu = this.virtualSystem?.getVirtualClu();
        if (clu?.state !== 1 /* OK */)
            return; // wait for CLU to be OK
        this.triggerEvent(MQTT_TOPIC_EVENTS.INIT);
    }
    _getMqttClient() {
        return this.virtualSystem?.getVirtualClu().getMqttClient() ?? null;
    }
    _subscribe(topic) {
        const client = this._getMqttClient();
        if (client == null)
            return false;
        try {
            this._subscriptions.add(topic);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.subscribe(topic, { qos: 1 }, (err) => {
                if (err)
                    console.error(`[${this.name}] subscribe error:`, err);
            });
            if (!this._messageHandlerRegistered) {
                this._messageHandlerRegistered = true;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                client.on('message', (t, payload, packet) => {
                    this._onMessage(t, payload, packet);
                });
            }
            return true;
        }
        catch (e) {
            console.error(`[${this.name}] subscribe error:`, e);
            return false;
        }
    }
    _unsubscribe(topic) {
        const client = this._getMqttClient();
        if (client == null)
            return false;
        try {
            this._subscriptions.delete(topic);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.unsubscribe(topic);
            return true;
        }
        catch (e) {
            console.error(`[${this.name}] unsubscribe error:`, e);
            return false;
        }
    }
    _publish(topicArg, messageArg) {
        const client = this._getMqttClient();
        if (client == null)
            return false;
        const topic = topicArg != null ? String(topicArg) : String(this.get(MQTT_TOPIC_FEATURES.TOPIC) ?? '');
        if (!topic)
            return false;
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
            client.publish(topic, payload);
            return true;
        }
        catch (e) {
            console.error(`[${this.name}] publish error:`, e);
            return false;
        }
    }
    _onMessage(topic, payload, packet) {
        void packet;
        if (!this._isSubscribedTo(topic))
            return;
        this._messageQueue.push({ topic, msg: { payload, ack: null } });
        if (!this._loopPending) {
            this._loopPending = true;
            setImmediate(() => this._drainQueue());
        }
    }
    _isSubscribedTo(topic) {
        for (const pattern of this._subscriptions) {
            if (mqttTopicMatches(pattern, topic))
                return true;
        }
        return false;
    }
    _drainQueue() {
        this._loopPending = false;
        this.loop();
    }
    loop() {
        const currentMsg = this.getValue(MQTT_TOPIC_FEATURES.MESSAGE);
        if (currentMsg != null)
            return; // already processing
        const entry = this._messageQueue.shift();
        if (entry == null)
            return;
        const { topic, msg } = entry;
        const parsed = parsePayload(msg.payload);
        void this.awaitEventTrigger(MQTT_TOPIC_EVENTS.MESSAGE).then(() => {
            this.setValue(MQTT_TOPIC_FEATURES.TOPIC, topic);
            this.setValue(MQTT_TOPIC_FEATURES.MESSAGE, parsed);
            this.triggerEvent(MQTT_TOPIC_EVENTS.MESSAGE, () => {
                msg.ack?.();
                this.clearValue(MQTT_TOPIC_FEATURES.MESSAGE);
                // process next queued message
                if (this._messageQueue.length > 0) {
                    setImmediate(() => this._drainQueue());
                }
            });
        });
    }
    close() {
        this._messageQueue.length = 0;
    }
}
function parsePayload(payload) {
    const text = payload.toString('utf8');
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string')
            return parsed;
        return parsed;
    }
    catch {
        return text;
    }
}
function mqttTopicMatches(pattern, topic) {
    const pParts = pattern.split('/');
    const tParts = topic.split('/');
    for (let i = 0; i < pParts.length; i++) {
        if (pParts[i] === '#')
            return true;
        if (pParts[i] !== '+' && pParts[i] !== tParts[i])
            return false;
    }
    return pParts.length === tParts.length;
}
