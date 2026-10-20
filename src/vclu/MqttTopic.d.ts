import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem } from './types.js';
export declare const MQTT_TOPIC_FEATURES: {
    readonly TOPIC: 0;
    readonly MESSAGE: 1;
};
export declare const MQTT_TOPIC_METHODS: {
    readonly SUBSCRIBE: 0;
    readonly UNSUBSCRIBE: 1;
    readonly PUBLISH: 10;
};
export declare const MQTT_TOPIC_EVENTS: {
    readonly INIT: 0;
    readonly MESSAGE: 1;
};
export declare class MqttTopic extends VirtualObject {
    static readonly INDEX = 999;
    static readonly FEATURES: {
        readonly TOPIC: 0;
        readonly MESSAGE: 1;
    };
    static readonly METHODS: {
        readonly SUBSCRIBE: 0;
        readonly UNSUBSCRIBE: 1;
        readonly PUBLISH: 10;
    };
    static readonly EVENTS: {
        readonly INIT: 0;
        readonly MESSAGE: 1;
    };
    private _subscriptions;
    private _messageQueue;
    private _loopPending;
    private _messageHandlerRegistered;
    constructor(virtualSystem: IVirtualSystem | null, name: string);
    setup(): void;
    private _getMqttClient;
    private _subscribe;
    private _unsubscribe;
    private _publish;
    private _onMessage;
    private _isSubscribedTo;
    private _drainQueue;
    loop(): void;
    private _processMessage;
    close(): void;
}
//# sourceMappingURL=MqttTopic.d.ts.map