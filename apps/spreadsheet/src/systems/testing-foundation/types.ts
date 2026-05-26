/**
 * Testing Foundation Types
 *
 * Protocol for all system simulators and common type definitions.
 *
 * @module systems/testing-foundation
 */

// =============================================================================
// SystemSimulator Protocol
// =============================================================================

/**
 * Protocol for all system simulators.
 * Every simulator follows: create -> start -> (act + assert)* -> destroy
 *
 * flush() drains microtask queue via `await Promise.resolve()`.
 * XState v5 processes send() synchronously but fires subscription
 * callbacks via microtasks. Most tests won't need flush().
 */
export interface SystemSimulator<TSystem, TSnapshot> {
  /** Boot the system (calls system.start()) */
  start(): void;

  /**
   * Process pending state transitions (XState microtasks).
   * Implementation: `await Promise.resolve()` to drain microtask queue.
   * Most tests won't need this -- only for cross-actor coordination.
   */
  flush(): void | Promise<void>;

  /** Tear down system and all subscriptions */
  destroy(): void;

  /** Point-in-time snapshot for assertions (system-specific shape) */
  snapshot(): TSnapshot;

  /** Raw system access for escape hatch */
  readonly system: TSystem;

  /** End any active drag operation (delegates to system's DragTerminator) */
  endDrag(): void;

  /** Cancel any active drag operation (delegates to system's DragTerminator) */
  cancelDrag(): void;
}

// =============================================================================
// KeyModifiers
// =============================================================================

/** Common key modifier shape used by grid-editing and input testing. */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}
