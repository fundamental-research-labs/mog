/**
 * Security Events
 *
 * Mirrors the Rust `compute_security::SecurityEvent` enum
 * over the wire. Events are emitted by the engine — both from local
 * policy CRUD calls (`wb_security_add_policy` / `remove_policy` /
 * `update_policy`) AND from the Yrs deep-observer when a remote peer
 * syncs the security map (`PoliciesReloaded`) — then drained in
 * batches via `wbSecurityDrainEvents()` and re-emitted on the kernel
 * event bus.
 *
 * The `kind` discriminator matches the Rust `#[serde(tag = "kind",
 * rename_all = "snake_case")]` emission. Field names are camelCase on
 * structs annotated with `rename_all = "camelCase"` (`PoliciesReloaded`
 * uses this) and snake_case on the others (default serde behaviour).
 *
 * Round-trip contract: if the Rust `SecurityEvent` enum grows a
 * variant, this file MUST be extended in lockstep. `SECURITY_EVENT_KINDS`
 * below captures the set the kernel currently relays so a mismatched
 * event surfaces as a warning at relay time (rather than silently
 * dropping) — see `kernel/src/services/security/security-event-relay.ts`.
 */
import type { BaseEvent } from '@mog/types-commands/event-base';
import type {
  AccessLevel,
  AccessPolicy,
  AccessTarget,
  PolicyId,
} from '@mog-sdk/types-document/security/types';

/**
 * Engine-side security event shapes as serialised by the bridge. These
 * are the raw payloads that come out of `wbSecurityDrainEvents()`
 * before the relay adapts them into kernel `SecurityEvent`s.
 */
export type RawSecurityEvent =
  | { kind: 'policy_added'; policy: AccessPolicy }
  | { kind: 'policy_removed'; id: PolicyId }
  | { kind: 'policy_updated'; id: PolicyId }
  | {
      kind: 'access_denied';
      // `AccessDenied` carries tags rather than a full principal —
      // `Principal` on the Rust side is not serialisable (its canonical
      // identity is an interned-pool slab pointer).
      principal_tags: string[];
      target: AccessTarget;
      operation: string;
    }
  | {
      kind: 'ambiguity_detected';
      warning: {
        principal_tags: string[];
        target: AccessTarget;
        conflicting_policies: PolicyId[];
        resolved_level: AccessLevel;
      };
    }
  | {
      kind: 'policies_reloaded';
      policyVersionBefore: number;
      policyVersionAfter: number;
      active: boolean;
    };

/**
 * Kernel-side `SecurityEvent` shape — wraps the raw Rust payload with
 * the `type` / `timestamp` envelope the event bus expects. One kernel
 * type per `RawSecurityEvent.kind`.
 */
export interface PolicyAddedEvent extends BaseEvent {
  type: 'security:policy-added';
  policy: AccessPolicy;
}

export interface PolicyRemovedEvent extends BaseEvent {
  type: 'security:policy-removed';
  policyId: PolicyId;
}

export interface PolicyUpdatedEvent extends BaseEvent {
  type: 'security:policy-updated';
  policyId: PolicyId;
}

export interface AccessDeniedEvent extends BaseEvent {
  type: 'security:access-denied';
  principalTags: string[];
  target: AccessTarget;
  operation: string;
}

export interface AmbiguityDetectedEvent extends BaseEvent {
  type: 'security:ambiguity-detected';
  principalTags: string[];
  target: AccessTarget;
  conflictingPolicies: PolicyId[];
  resolvedLevel: AccessLevel;
}

export interface PoliciesReloadedEvent extends BaseEvent {
  type: 'security:policies-reloaded';
  policyVersionBefore: number;
  policyVersionAfter: number;
  /** True iff the policy set is non-empty after the publish. */
  active: boolean;
}

/**
 * Union of every kernel-side security event. Join this into the
 * top-level `SpreadsheetEvent` union (see `events/index.ts`) so
 * subscribers receive security events through the same `on()` /
 * `onMany()` APIs as every other domain.
 */
export type SecurityEvent =
  | PolicyAddedEvent
  | PolicyRemovedEvent
  | PolicyUpdatedEvent
  | AccessDeniedEvent
  | AmbiguityDetectedEvent
  | PoliciesReloadedEvent;

/**
 * Enumerable list of `RawSecurityEvent.kind` values the relay knows
 * how to adapt. Exported so the relay can log-and-skip any unexpected
 * kind rather than throwing — a future Rust-side event added before
 * this file catches up should degrade gracefully.
 */
export const SECURITY_EVENT_KINDS = [
  'policy_added',
  'policy_removed',
  'policy_updated',
  'access_denied',
  'ambiguity_detected',
  'policies_reloaded',
] as const;

export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];
