import type {
  ControlPlaneCasToken,
  ControlPlaneCompareAndSwapRequest,
  ControlPlaneCompareAndSwapResult,
  ControlPlaneDryRunRequest,
  ControlPlaneDryRunResult,
  ControlPlaneEntrypointId,
} from '../control-plane';

export const VERSION_CAPABILITY_GATE_ENTRYPOINT_IDS = Object.freeze([
  'control-plane.capability-gates.read',
  'control-plane.capability-gates.dry-run',
  'control-plane.capability-gates.compare-and-swap',
] as const satisfies readonly ControlPlaneEntrypointId[]);
export type VersionCapabilityGateEntrypointId =
  (typeof VERSION_CAPABILITY_GATE_ENTRYPOINT_IDS)[number];

export const VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_STATUSES = Object.freeze([
  'not-applied',
] as const);
export type VersionCapabilityGateDryRunResultStatus =
  (typeof VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_STATUSES)[number];

export const VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_REASONS = Object.freeze([
  'noop',
  'unavailable',
] as const);
export type VersionCapabilityGateDryRunResultReason =
  (typeof VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_REASONS)[number];

export const VERSION_CAPABILITY_GATE_CAS_RESULT_STATUSES = Object.freeze(['not-applied'] as const);
export type VersionCapabilityGateCompareAndSwapResultStatus =
  (typeof VERSION_CAPABILITY_GATE_CAS_RESULT_STATUSES)[number];

export const VERSION_CAPABILITY_GATE_CAS_RESULT_REASONS = Object.freeze([
  'unavailable',
  'stale-cas-token',
] as const);
export type VersionCapabilityGateCompareAndSwapResultReason =
  (typeof VERSION_CAPABILITY_GATE_CAS_RESULT_REASONS)[number];

export type VersionCapabilityGateDryRunRequest = ControlPlaneDryRunRequest;

export interface VersionCapabilityGateDryRunResult extends Omit<
  ControlPlaneDryRunResult,
  'applied' | 'reason' | 'status'
> {
  readonly status: VersionCapabilityGateDryRunResultStatus;
  readonly reason: VersionCapabilityGateDryRunResultReason;
  readonly applied: false;
}

export type VersionCapabilityGateCompareAndSwapRequest = ControlPlaneCompareAndSwapRequest;

export interface VersionCapabilityGateCompareAndSwapReceipt extends Omit<
  ControlPlaneCompareAndSwapResult['casReceipt'],
  'reason'
> {
  readonly reason: VersionCapabilityGateCompareAndSwapResultReason;
  readonly readbackCasToken?: ControlPlaneCasToken;
}

export interface VersionCapabilityGateCompareAndSwapResult extends Omit<
  ControlPlaneCompareAndSwapResult,
  'applied' | 'casReceipt' | 'reason' | 'status'
> {
  readonly status: VersionCapabilityGateCompareAndSwapResultStatus;
  readonly reason: VersionCapabilityGateCompareAndSwapResultReason;
  readonly applied: false;
  readonly casReceipt: VersionCapabilityGateCompareAndSwapReceipt;
}

export interface VersionCapabilityGateDryRunContract {
  readonly entrypointId: Extract<
    VersionCapabilityGateEntrypointId,
    'control-plane.capability-gates.dry-run'
  >;
  readonly request: VersionCapabilityGateDryRunRequest;
  readonly result: VersionCapabilityGateDryRunResult;
}

export interface VersionCapabilityGateCompareAndSwapContract {
  readonly entrypointId: Extract<
    VersionCapabilityGateEntrypointId,
    'control-plane.capability-gates.compare-and-swap'
  >;
  readonly request: VersionCapabilityGateCompareAndSwapRequest;
  readonly result: VersionCapabilityGateCompareAndSwapResult;
}
