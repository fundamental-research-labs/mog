/**
 * Security Event Relay.
 *
 * Rust's `YrsComputeEngine` accumulates `SecurityEvent`s in a bounded
 * ring buffer (256 events by default, see `SecurityEventBuffer` in
 * `compute/core/src/storage/engine/security_events.rs`). The kernel
 * drains that buffer on a cadence and re-emits each event on the
 * shared kernel event bus so subscribers can react the same way they
 * would to any other domain event.
 *
 * Two reasons this is a pull relay rather than a push channel:
 *
 * 1. The bridge layer is request/response today; there is no
 *    engine-to-TS push channel. Adding one would require a new
 *    delegate pattern (long-running subscription across the Dispatch
 *    actor boundary) which is not part of the current bridge contract.
 * 2. Policy CRUD happens at user-interaction speed, not at formula
 *    tick speed — a 1-second poll is more than fine; the ring buffer
 *    absorbs short bursts (its `EVENT_BUFFER_CAP = 256` is well above
 *    any realistic burst rate).
 *
 * The relay also runs an `emitNow()` immediately after kernel context
 * construction so an event produced during seed-on-load (`active`
 * flips from false to true when a snapshot with policies loads)
 * surfaces on the first event-bus tick — without that, subscribers
 * attached in the same microtask as the kernel wiring could miss the
 * activation signal.
 */

import type { IEventBus } from '@mog-sdk/contracts/events';
import type {
  AccessDeniedEvent,
  AmbiguityDetectedEvent,
  PoliciesReloadedEvent,
  PolicyAddedEvent,
  PolicyRemovedEvent,
  PolicyUpdatedEvent,
  RawSecurityEvent,
  SecurityEvent,
} from '@mog-sdk/contracts/events';

interface SecurityEventRelaySource {
  /** Matches `ComputeBridge.wbSecurityDrainEvents()`. */
  wbSecurityDrainEvents(): Promise<unknown[]>;
  /**
   * Readiness predicate so the relay can self-protect against draining
   * before the underlying compute bridge has reached `STARTED`.
   * `wbSecurityDrainEvents` requires `STARTED` (it calls
   * `ensureInitialized()` on the WASM/NAPI boundary). Calling it any
   * earlier throws `BRIDGE_PHASE_INSUFFICIENT`, which the catch below
   * would log on every tick.
   *
   * Optional so existing test stubs don't break — when absent, the
   * relay assumes the source is always ready (the unit-test contract).
   */
  isInitialized?: boolean;
}

export interface SecurityEventRelayOptions {
  /** Poll cadence in milliseconds. Defaults to 1000. */
  intervalMs?: number;
  /**
   * Optional logger for unexpected payload shapes. If a `kind` comes
   * back from the bridge that this relay doesn't understand, the relay
   * logs once per-kind via this callback and continues — a new Rust
   * variant landed before the contracts file caught up should not
   * crash the kernel.
   */
  onUnknownKind?: (kind: string, raw: unknown) => void;
}

/**
 * Handle returned to callers — holds the interval id + drain state so
 * the caller can `.stop()` on disposal. Exposed `.drainOnce()` is used
 * by tests to force a synchronous drain without waiting for the timer.
 */
export interface SecurityEventRelay {
  start(): void;
  stop(): void;
  /**
   * Synchronously drain whatever's currently in the Rust buffer and
   * emit each event on the kernel bus. Used by the post-construction
   * kick in `createDocumentContext` and by tests.
   */
  drainOnce(): Promise<void>;
}

/**
 * Construct a relay. The relay is idle until `.start()` is called —
 * callers own lifecycle (typically the DocumentContext destroy path).
 */
export function createSecurityEventRelay(
  source: SecurityEventRelaySource,
  eventBus: IEventBus,
  options: SecurityEventRelayOptions = {},
): SecurityEventRelay {
  const intervalMs = options.intervalMs ?? 1000;
  const onUnknownKind = options.onUnknownKind ?? defaultLogUnknownKind;
  const warnedKinds = new Set<string>();

  let timer: ReturnType<typeof setInterval> | null = null;
  let draining = false;

  async function drainOnce(): Promise<void> {
    // Re-entrancy guard: a slow drain must not stack multiple
    // concurrent drains on the async boundary.
    if (draining) return;
    // Readiness guard: `wbSecurityDrainEvents` requires the compute bridge
    // to be in `STARTED` phase. The relay's first `start()` call kicks
    // a synchronous `drainOnce` to surface seed-on-load events, but at
    // that point the bridge is typically still in `CONTEXT_SET` (the
    // `DocumentLifecycleSystem` only flips it to `STARTED` in the next
    // step, `executeStartBridge`). Skip silently if the source declares
    // itself not-yet-initialized — the polling timer will retry.
    //
    // Without this guard, every premature drain logs a noisy
    // `BRIDGE_PHASE_INSUFFICIENT` warning *and* (more importantly)
    // pollutes the `recentErrors` ring buffer, which masks real load
    // failures in app-eval scenarios.
    if (source.isInitialized === false) return;
    draining = true;
    try {
      const raw = await source.wbSecurityDrainEvents();
      if (!Array.isArray(raw) || raw.length === 0) return;

      const now = Date.now();
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || !('kind' in entry)) continue;
        const kind = String((entry as { kind: unknown }).kind);
        const event = adaptRawEvent(entry as RawSecurityEvent, now);
        if (event === null) {
          if (!warnedKinds.has(kind)) {
            warnedKinds.add(kind);
            onUnknownKind(kind, entry);
          }
          continue;
        }
        eventBus.emit(event);
      }
    } catch (err) {
      // A transient bridge failure (e.g. engine restarted mid-drain)
      // should not take down the relay; the next tick retries.
      // eslint-disable-next-line no-console
      console.warn('[security-event-relay] drain failed:', err);
    } finally {
      draining = false;
    }
  }

  return {
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        void drainOnce();
      }, intervalMs);
      // Kick once immediately so seed-on-load events (a snapshot loaded
      // with active policies produces a `PoliciesReloaded` event during
      // `SecurityState::new` via the `publish_policies` emission path
      // in security_state.rs) don't wait a full tick to surface.
      void drainOnce();
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    drainOnce,
  };
}

function adaptRawEvent(raw: RawSecurityEvent, timestamp: number): SecurityEvent | null {
  switch (raw.kind) {
    case 'policy_added':
      return {
        type: 'security:policy-added',
        timestamp,
        policy: raw.policy,
      } satisfies PolicyAddedEvent;
    case 'policy_removed':
      return {
        type: 'security:policy-removed',
        timestamp,
        policyId: raw.id,
      } satisfies PolicyRemovedEvent;
    case 'policy_updated':
      return {
        type: 'security:policy-updated',
        timestamp,
        policyId: raw.id,
      } satisfies PolicyUpdatedEvent;
    case 'access_denied':
      return {
        type: 'security:access-denied',
        timestamp,
        principalTags: raw.principal_tags,
        target: raw.target,
        operation: raw.operation,
      } satisfies AccessDeniedEvent;
    case 'ambiguity_detected':
      return {
        type: 'security:ambiguity-detected',
        timestamp,
        principalTags: raw.warning.principal_tags,
        target: raw.warning.target,
        conflictingPolicies: raw.warning.conflicting_policies,
        resolvedLevel: raw.warning.resolved_level,
      } satisfies AmbiguityDetectedEvent;
    case 'policies_reloaded':
      return {
        type: 'security:policies-reloaded',
        timestamp,
        policyVersionBefore: raw.policyVersionBefore,
        policyVersionAfter: raw.policyVersionAfter,
        active: raw.active,
      } satisfies PoliciesReloadedEvent;
    default:
      return null;
  }
}

function defaultLogUnknownKind(kind: string, raw: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[security-event-relay] unknown SecurityEvent kind "${kind}"; ` +
      `contracts/src/events/security-events.ts is likely out of sync with ` +
      `compute-security::SecurityEvent. Dropping event:`,
    raw,
  );
}
