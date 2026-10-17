import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem } from './types.js';
export declare const CLU_STATE: {
    readonly STARTING: 0;
    readonly OK: 1;
    readonly ERROR: 2;
    readonly EMERGENCY: 4;
    readonly MONITOR: 5;
};
export type CluState = (typeof CLU_STATE)[keyof typeof CLU_STATE];
export declare const CLU_FEATURES: {
    readonly UPTIME: 0;
    readonly LOG: 1;
    readonly STATE: 2;
    readonly DATE: 5;
    readonly TIME: 6;
    readonly DAY_OF_MONTH: 7;
    readonly MONTH: 8;
    readonly YEAR: 9;
    readonly DAY_OF_WEEK: 10;
    readonly HOUR: 11;
    readonly MINUTE: 12;
    readonly TIMESTAMP: 13;
    readonly TIME_ZONE: 14;
    readonly MQTT_URL: 20;
    readonly USE_MQTT: 21;
    readonly MQTT_CONNECTION: 22;
    readonly MQTT_DISCOVERY: 23;
    readonly MQTT_DISCOVERY_PREFIX: 24;
    readonly MQTT_MESSAGE: 25;
};
export declare const CLU_METHODS: {
    readonly ADD_TO_LOG: 0;
    readonly CLEAR_LOG: 1;
    readonly MQTT_SEND_DISCOVERY: 20;
    readonly MQTT_SEND_VALUE: 21;
    readonly MQTT_ON_VALUE_CHANGE: 30;
};
export declare const CLU_EVENTS: {
    readonly INIT: 0;
    readonly TIME_CHANGE: 13;
    readonly MQTT_RECEIVE_VALUE: 20;
};
export declare class VirtualCLU extends VirtualObject {
    static readonly INDEX = 0;
    static readonly FEATURES: {
        readonly UPTIME: 0;
        readonly LOG: 1;
        readonly STATE: 2;
        readonly DATE: 5;
        readonly TIME: 6;
        readonly DAY_OF_MONTH: 7;
        readonly MONTH: 8;
        readonly YEAR: 9;
        readonly DAY_OF_WEEK: 10;
        readonly HOUR: 11;
        readonly MINUTE: 12;
        readonly TIMESTAMP: 13;
        readonly TIME_ZONE: 14;
        readonly MQTT_URL: 20;
        readonly USE_MQTT: 21;
        readonly MQTT_CONNECTION: 22;
        readonly MQTT_DISCOVERY: 23;
        readonly MQTT_DISCOVERY_PREFIX: 24;
        readonly MQTT_MESSAGE: 25;
    };
    static readonly METHODS: {
        readonly ADD_TO_LOG: 0;
        readonly CLEAR_LOG: 1;
        readonly MQTT_SEND_DISCOVERY: 20;
        readonly MQTT_SEND_VALUE: 21;
        readonly MQTT_ON_VALUE_CHANGE: 30;
    };
    static readonly EVENTS: {
        readonly INIT: 0;
        readonly TIME_CHANGE: 13;
        readonly MQTT_RECEIVE_VALUE: 20;
    };
    readonly rootDirectory: string;
    private _state;
    private _currentDate;
    private _timeChangeTimer;
    private _mqttClient;
    private _mqttStartPending;
    /** topic → callback; prevents duplicate on('message') bindings */
    private _mqttTopicHandlers;
    constructor(virtualSystem: IVirtualSystem | null, rootDirectory: string, name: string);
    private _tz;
    private _tzParts;
    private _formatDate;
    private _formatTime;
    get state(): CluState;
    setState(state: CluState): void;
    getMqttClient(): any;
    setMqttConnected(connected: boolean): void;
    isMqttEnabled(): boolean;
    getMqttUrl(): string;
    loop(): void;
    private _startMqtt;
    private _addToLog;
    private _clearLog;
    private _mqttSendDiscovery;
    private _mqttSendValue;
    private _mqttOnValueChange;
    close(): void;
}
//# sourceMappingURL=VirtualCLU.d.ts.map