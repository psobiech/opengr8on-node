import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem } from './types.js';
export declare const TIMER_MODE: {
    readonly COUNT_DOWN: 0;
    readonly INTERVAL: 1;
};
export declare const TIMER_STATE: {
    readonly STOPPED: 0;
    readonly COUNTING: 1;
    readonly PAUSED: 2;
};
export declare const TIMER_FEATURES: {
    readonly TIME: 0;
    readonly MODE: 1;
    readonly STATE: 2;
    readonly VALUE: 3;
};
export declare const TIMER_METHODS: {
    readonly START: 0;
    readonly STOP: 1;
    readonly PAUSE: 2;
};
export declare const TIMER_EVENTS: {
    readonly TIMER: 0;
    readonly START: 1;
    readonly STOP: 2;
    readonly PAUSE: 3;
};
export declare class Timer extends VirtualObject {
    static readonly INDEX = 6;
    static readonly FEATURES: {
        readonly TIME: 0;
        readonly MODE: 1;
        readonly STATE: 2;
        readonly VALUE: 3;
    };
    static readonly METHODS: {
        readonly START: 0;
        readonly STOP: 1;
        readonly PAUSE: 2;
    };
    static readonly EVENTS: {
        readonly TIMER: 0;
        readonly START: 1;
        readonly STOP: 2;
        readonly PAUSE: 3;
    };
    private _runState;
    private _interval;
    private _lastTick;
    private _counter;
    constructor(virtualSystem: IVirtualSystem | null, name: string);
    private _onStart;
    private _restartTimer;
    private _tick;
    private _onStop;
    private _onPause;
    close(): void;
}
//# sourceMappingURL=Timer.d.ts.map