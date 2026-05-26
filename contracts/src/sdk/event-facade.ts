/**
 * Public event subscription facade.
 *
 * Replaces raw IEventBus exposure on DocumentHandle with a typed,
 * disposable subscription API over stable MogSdkEvent types.
 */

import type { MogSdkEventType, TypedMogSdkEvent, MogSdkEvent } from './mog-sdk-event';

// ---------------------------------------------------------------------------
// Disposable subscription handle
// ---------------------------------------------------------------------------

export interface MogSdkSubscription {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Event facade interface
// ---------------------------------------------------------------------------

export interface IMogSdkEventFacade {
  /**
   * Subscribe to a specific stable event type.
   * Returns a disposable subscription handle.
   */
  on<K extends MogSdkEventType>(
    type: K,
    handler: (event: TypedMogSdkEvent<K>) => void,
  ): MogSdkSubscription;

  /**
   * Subscribe to multiple stable event types with one handler.
   */
  onMany(
    types: readonly MogSdkEventType[],
    handler: (event: MogSdkEvent) => void,
  ): MogSdkSubscription;

  /**
   * Subscribe to all stable SDK events.
   */
  onAll(handler: (event: MogSdkEvent) => void): MogSdkSubscription;

  /**
   * Wait for the next occurrence of a specific event type.
   * Resolves with the event payload. Rejects if the document is disposed.
   */
  once<K extends MogSdkEventType>(type: K): Promise<TypedMogSdkEvent<K>>;
}
