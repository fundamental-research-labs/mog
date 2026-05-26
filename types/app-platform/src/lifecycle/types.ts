import type { AppId } from '../manifest/types';
import type { RouteSnapshot } from '../routing/types';

// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __appInstanceIdBrand: unique symbol;

/** Opaque identifier for a running app instance. */
export type AppInstanceId = string & {
  readonly [__appInstanceIdBrand]: typeof __appInstanceIdBrand;
};

/** Create a branded AppInstanceId from a raw string. */
export function createAppInstanceId(raw: string): AppInstanceId {
  return raw as AppInstanceId;
}

// ─── Instance State ──────────────────────────────────────────────────────────

/** Lifecycle state of a running app instance. */
export type AppInstanceState =
  | 'created'
  | 'launching'
  | 'running'
  | 'suspended'
  | 'closing'
  | 'closed'
  | 'launchDenied'
  | 'launchIncompatible'
  | 'crashed';

// ─── Lifecycle Hooks ─────────────────────────────────────────────────────────

/** Named lifecycle hooks an app can implement. */
export type AppLifecycleHook = 'onLaunch' | 'onSuspend' | 'onResume' | 'onClose' | 'onCrash';

// ─── Resource Grant Snapshot ─────────────────────────────────────────────────

/** Opaque snapshot of a resource binding granted to an instance. */
export interface ResourceBindingSnapshot {
  /** Logical key from the app's binding descriptor. */
  readonly logicalKey: string;
  /** Resource kind. */
  readonly resourceKind: string;
  /** Whether the binding is currently active. */
  readonly active: boolean;
}

// ─── Capability Grant Snapshot ───────────────────────────────────────────────

/** Opaque snapshot of a capability granted to an instance. */
export interface CapabilityGrantSnapshot {
  /** Capability ID. */
  readonly capabilityId: string;
  /** Whether the grant is currently active. */
  readonly active: boolean;
}

// ─── View State ──────────────────────────────────────────────────────────────

/** Opaque view state persisted across suspend/resume cycles. */
export type AppViewState = Record<string, unknown>;

// ─── Instance Snapshot ───────────────────────────────────────────────────────

/** Complete snapshot of an app instance's current state. */
export interface AppInstanceSnapshot {
  /** Unique instance identifier. */
  readonly instanceId: AppInstanceId;
  /** App that this instance is running. */
  readonly appId: AppId;
  /** Current route within the app. */
  readonly route: RouteSnapshot;
  /** Active resource bindings. */
  readonly resourceBindings: readonly ResourceBindingSnapshot[];
  /** Active capability grants. */
  readonly grants: readonly CapabilityGrantSnapshot[];
  /** Persisted view state. */
  readonly viewState: AppViewState;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO-8601 last-active timestamp. */
  readonly lastActiveAt: string;
  /** Current lifecycle state. */
  readonly state: AppInstanceState;
}
