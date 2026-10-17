import { EventEmitter } from 'node:events';
import type { IVirtualSystem, LuaLike } from './types.js';
export type { LuaLike };
export type FeatureFn = (value?: LuaLike) => LuaLike;
export type MethodFn = (...args: LuaLike[]) => LuaLike;
export type EventHandler = () => void | Promise<void>;
export declare class VirtualObject extends EventEmitter {
    protected _name: string;
    readonly virtualSystem: IVirtualSystem | null;
    protected readonly _featureValues: Map<number, LuaLike>;
    protected readonly _featureFns: Map<number, FeatureFn>;
    protected readonly _methods: Map<number, MethodFn>;
    protected readonly _eventHandlers: Map<number, EventHandler[]>;
    protected readonly _pendingEvents: Map<number, Promise<void>>;
    constructor(virtualSystem: IVirtualSystem | null, name: string);
    get name(): string;
    set name(v: string);
    /**
     * Register a bidirectional feature.
     * fn(undefined) → getter: return current/computed value.
     * fn(value) → setter: return the value to store.
     */
    registerFeature(index: number, fn: FeatureFn): void;
    get(index: number): LuaLike;
    set(index: number, value: LuaLike): void;
    getValue(index: number): LuaLike;
    setValue(index: number, value: LuaLike): void;
    clearValue(index: number): void;
    registerMethod(index: number, fn: MethodFn): void;
    execute(index: number, ...args: LuaLike[]): LuaLike;
    addEventHandler(address: number, fn: EventHandler): void;
    isEventRegistered(address: number): boolean;
    awaitEventTrigger(address: number): Promise<void>;
    /**
     * Fire event handlers asynchronously, serialising against previous trigger for same address.
     * Returns true if any handlers are registered.
     */
    triggerEvent(address: number, onCompleted?: () => void): boolean;
    setup(): void;
    loop(): void;
    close(): void;
}
//# sourceMappingURL=VirtualObject.d.ts.map