import type { InterfaceRegistry } from '../parsers/interfaces/InterfaceRegistry.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
export type LuaLike = string | number | boolean | null | {
    readonly [key: string]: LuaLike;
} | readonly LuaLike[];
export interface Subscription {
    object: IVirtualObject;
    index: number;
}
export interface IVirtualObject {
    name: string;
    get(index: number): LuaLike;
    set(index: number, value: LuaLike): void;
    getValue(index: number): LuaLike;
    setValue(index: number, value: LuaLike): void;
    clearValue(index: number): void;
    execute(index: number, ...args: LuaLike[]): LuaLike;
    addEventHandler(address: number, fn: () => void | Promise<void>): void;
    isEventRegistered(address: number): boolean;
    triggerEvent(address: number, onCompleted?: () => void): boolean;
    awaitEventTrigger(address: number): Promise<void>;
    setup(): void;
    loop(): void;
    close(): void;
}
export interface IVirtualCLU extends IVirtualObject {
    state: number;
    setState(state: number): void;
    getMqttClient(): any;
    setMqttConnected(connected: boolean): void;
    isMqttEnabled(): boolean;
    getMqttUrl(): string;
    triggerEvent(address: number, onCompleted?: () => void): boolean;
}
export type WorkerMessage = {
    type: 'started';
} | {
    type: 'clientReport';
    addr: string;
    port: number;
    sessionId: number;
    response: string;
} | {
    type: 'error';
    message: string;
} | {
    type: 'scriptError';
    message: string;
};
export interface IVirtualSystem {
    readonly localAddress: string | undefined;
    getObject(name: string): IVirtualObject | null;
    getVirtualClu(): IVirtualCLU;
    getCipherKeyFor(address: string): unknown;
    getInterfaceRegistry(): InterfaceRegistry;
    getProjectRegistry(): ProjectRegistry;
    luaCall(script: string): LuaLike;
    fetchValues(subscriptions: Subscription[]): string;
    clientRegister(remoteAddr: string, addr: string, port: number, sessionId: number, subs: Subscription[]): string;
    clientDestroy(addr: string, port: number, sessionId: number): number;
    newObject(index: number, name: string, ipAddress: string | null): void;
    newGate(index: number, name: string): void;
    setup(): void;
    loop(): void;
    close(): void;
}
//# sourceMappingURL=types.d.ts.map