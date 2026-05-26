// From contracts (types only)
export type { IDisposable } from '@mog-sdk/contracts/core';
export type { Result } from '@mog-sdk/contracts/core';

// From spreadsheet-utils (runtime implementations)
export {
  DisposableBase,
  DisposableStore,
  DisposableGroup,
  MutableDisposable,
  DisposableNone,
  toDisposable,
} from '@mog/spreadsheet-utils/disposable';
export { ok, err } from '@mog/spreadsheet-utils/result';

// Service-layer primitives (kernel-specific)
export { Subscribable } from './subscribable';
export type { Listener } from './subscribable';
export { TypedEventEmitter } from './event-emitter';
