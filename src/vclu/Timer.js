import { VirtualObject } from './VirtualObject.js';
export const TIMER_MODE = {
    COUNT_DOWN: 0,
    INTERVAL: 1,
};
export const TIMER_STATE = {
    STOPPED: 0,
    COUNTING: 1,
    PAUSED: 2,
};
export const TIMER_FEATURES = {
    TIME: 0,
    MODE: 1,
    STATE: 2,
    VALUE: 3,
};
export const TIMER_METHODS = {
    START: 0,
    STOP: 1,
    PAUSE: 2,
};
export const TIMER_EVENTS = {
    TIMER: 0,
    START: 1,
    STOP: 2,
    PAUSE: 3,
};
export class Timer extends VirtualObject {
    static INDEX = 6;
    static FEATURES = TIMER_FEATURES;
    static METHODS = TIMER_METHODS;
    static EVENTS = TIMER_EVENTS;
    _runState = TIMER_STATE.STOPPED;
    _interval = null;
    _lastTick = 0n;
    _counter = 0n;
    constructor(virtualSystem, name) {
        super(virtualSystem, name);
        this.registerFeature(TIMER_FEATURES.TIME, (value) => {
            if (value === undefined) {
                return this.getValue(TIMER_FEATURES.TIME);
            }
            if (this._runState === TIMER_STATE.COUNTING) {
                this._restartTimer(BigInt(Number(this.get(TIMER_FEATURES.TIME)) * 1_000_000));
            }
            return value;
        });
        this.setValue(TIMER_FEATURES.TIME, 1000);
        this.setValue(TIMER_FEATURES.MODE, TIMER_MODE.COUNT_DOWN);
        this.registerFeature(TIMER_FEATURES.STATE, () => this._runState);
        this.registerFeature(TIMER_FEATURES.VALUE, () => Number(this._counter / 1000000n));
        this.registerMethod(TIMER_METHODS.START, () => this._onStart());
        this.registerMethod(TIMER_METHODS.STOP, () => this._onStop());
        this.registerMethod(TIMER_METHODS.PAUSE, () => this._onPause());
    }
    _onStart() {
        const timeMs = Number(this.get(TIMER_FEATURES.TIME) ?? 1000);
        this._restartTimer(BigInt(timeMs) * 1000000n);
        this._runState = TIMER_STATE.COUNTING;
        this.triggerEvent(TIMER_EVENTS.START);
        return null;
    }
    _restartTimer(timeNs) {
        if (this._interval != null) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this._counter = timeNs;
        this._lastTick = process.hrtime.bigint();
        const tickMs = Math.max(1, Math.min(100, Number(timeNs / 1000000n / 4n)));
        this._interval = setInterval(() => this._tick(timeNs), tickMs);
    }
    _tick(totalNs) {
        if (this._runState !== TIMER_STATE.COUNTING)
            return;
        const now = process.hrtime.bigint();
        const delta = now - this._lastTick;
        this._lastTick = now;
        this._counter -= delta;
        if (this._counter <= 0n) {
            const mode = Number(this.get(TIMER_FEATURES.MODE));
            if (mode === TIMER_MODE.INTERVAL) {
                const overshoot = -this._counter % totalNs;
                this._counter = totalNs - overshoot;
            }
            else {
                this._onStop();
            }
            this.triggerEvent(TIMER_EVENTS.TIMER);
        }
    }
    _onStop() {
        this._runState = TIMER_STATE.STOPPED;
        if (this._interval != null) {
            clearInterval(this._interval);
            this._interval = null;
        }
        const timeMs = Number(this.get(TIMER_FEATURES.TIME) ?? 1000);
        this._counter = BigInt(timeMs) * 1000000n;
        this.triggerEvent(TIMER_EVENTS.STOP);
        return null;
    }
    _onPause() {
        if (this._runState === TIMER_STATE.PAUSED) {
            this._lastTick = process.hrtime.bigint();
            this._runState = TIMER_STATE.COUNTING;
        }
        else if (this._runState === TIMER_STATE.COUNTING) {
            this._runState = TIMER_STATE.PAUSED;
            this.triggerEvent(TIMER_EVENTS.PAUSE);
        }
        return null;
    }
    close() {
        if (this._interval != null) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }
}
