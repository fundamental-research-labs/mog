/**
 * Disposable — Handle-based lifecycle management.
 *
 * Three primitives for consumer-scoped stateful APIs:
 *
 * 1. `IDisposable` — interface for any resource with explicit lifecycle.
 * 2. `DisposableBase` — abstract class with idempotent dispose + Symbol.dispose.
 * 3. `DisposableStore` — tracks child disposables; disposing the store disposes all children.
 *
 * Supports TC39 Explicit Resource Management (TS 5.2+):
 *   using region = wb.viewport.createRegion(sheetId, bounds);
 *   // auto-disposed at block exit
 *
 */

/**
 * A resource with explicit lifecycle. Implements TC39 Explicit Resource
 * Management (Symbol.dispose) for use with `using` declarations.
 */
export interface IDisposable {
  dispose(): void;
  [Symbol.dispose](): void;
}

/**
 * A disposable that can also be called as a function (shorthand for dispose).
 * This type alias stays in contracts since it's used in service interface signatures.
 */
export type CallableDisposable = (() => void) & IDisposable;
