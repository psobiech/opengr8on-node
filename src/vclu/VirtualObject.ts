import { EventEmitter } from 'node:events';
import type { IVirtualSystem, LuaLike } from './types.js';

export type { LuaLike };
export type FeatureFn = (value?: LuaLike) => LuaLike;
export type MethodFn = (...args: LuaLike[]) => LuaLike;
export type EventHandler = () => void | Promise<void>;

export class VirtualObject extends EventEmitter {
  protected _name: string;
  readonly virtualSystem: IVirtualSystem | null;

  protected readonly _featureValues = new Map<number, LuaLike>();
  protected readonly _featureFns = new Map<number, FeatureFn>();
  protected readonly _methods = new Map<number, MethodFn>();
  protected readonly _eventHandlers = new Map<number, EventHandler[]>();
  protected readonly _pendingEvents = new Map<number, Promise<void>>();

  constructor(virtualSystem: IVirtualSystem | null, name: string) {
    super({ captureRejections: true });
    this.virtualSystem = virtualSystem;
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  set name(v: string) {
    this._name = v;
  }

  /**
   * Register a bidirectional feature.
   * fn(undefined) → getter: return current/computed value.
   * fn(value) → setter: return the value to store.
   */
  registerFeature(index: number, fn: FeatureFn): void {
    this._featureFns.set(index, fn);
    const initial = fn(undefined);
    if (initial !== undefined) this._featureValues.set(index, initial);
  }

  get(index: number): LuaLike {
    const fn = this._featureFns.get(index);
    if (fn !== undefined) {
      const val = fn(undefined);
      if (val !== undefined) this._featureValues.set(index, val);
      return this._featureValues.get(index) ?? null;
    }
    return this._featureValues.get(index) ?? null;
  }

  set(index: number, value: LuaLike): void {
    const fn = this._featureFns.get(index);
    if (fn !== undefined) {
      const result = fn(value);
      this._featureValues.set(index, result !== undefined ? result : value);
    } else {
      this._featureValues.set(index, value);
    }
  }

  getValue(index: number): LuaLike {
    return this._featureValues.get(index) ?? null;
  }

  setValue(index: number, value: LuaLike): void {
    this._featureValues.set(index, value);
  }

  clearValue(index: number): void {
    this._featureValues.delete(index);
  }

  registerMethod(index: number, fn: MethodFn): void {
    this._methods.set(index, fn);
  }

  execute(index: number, ...args: LuaLike[]): LuaLike {
    const fn = this._methods.get(index);
    if (fn === undefined) return null;
    try {
      return fn(...args);
    } catch (e) {
      console.error(`[${this._name}] execute(${index}) error:`, e);
      return null;
    }
  }

  addEventHandler(address: number, fn: EventHandler): void {
    const existing = this._eventHandlers.get(address);
    if (existing !== undefined) {
      existing.push(fn);
    } else {
      this._eventHandlers.set(address, [fn]);
    }
  }

  isEventRegistered(address: number): boolean {
    const handlers = this._eventHandlers.get(address);
    return handlers !== undefined && handlers.length > 0;
  }

  async awaitEventTrigger(address: number): Promise<void> {
    const p = this._pendingEvents.get(address);
    if (p !== undefined) await p;
  }

  /** Run event handlers for address, serialising against any previous trigger. Returns Promise that resolves when all handlers complete. */
  runEvent(address: number): Promise<void> {
    const handlers = [...(this._eventHandlers.get(address) ?? [])];
    if (handlers.length === 0) return Promise.resolve();

    const prev = this._pendingEvents.get(address) ?? Promise.resolve();
    const p = prev
      .then(async () => {
        for (const h of handlers) {
          try {
            await h();
          } catch (e) {
            console.error(`[${this._name}] event address=${address} handler error:`, e);
          }
        }
      })
      .finally(() => {
        if (this._pendingEvents.get(address) === p) {
          this._pendingEvents.delete(address);
        }
      });

    this._pendingEvents.set(address, p);
    return p;
  }

  /** Fire event handlers asynchronously. Returns true if any handlers are registered. */
  triggerEvent(address: number, onCompleted?: () => void): boolean {
    if (!this.isEventRegistered(address)) {
      onCompleted?.();
      return false;
    }
    void this.runEvent(address).finally(() => onCompleted?.());
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setup(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  loop(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  close(): void {}
}
