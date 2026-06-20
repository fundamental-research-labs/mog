export const CONTROL_PLANE_ENTRYPOINT_IDS = [
  'control-plane.capability-gates.read',
  'control-plane.capability-gates.dry-run',
  'control-plane.capability-gates.compare-and-swap',
  'control-plane.shadow.observe',
] as const;

export type ControlPlaneEntrypointId = (typeof CONTROL_PLANE_ENTRYPOINT_IDS)[number];

export type ControlPlaneEntrypointStatus = 'available' | 'disabled' | 'unavailable';

export interface ControlPlaneEntrypointDescriptor {
  readonly id: ControlPlaneEntrypointId;
  readonly status: ControlPlaneEntrypointStatus;
  readonly description?: string;
}

export interface ControlPlaneEntrypointInventory {
  readonly entrypoints: readonly ControlPlaneEntrypointDescriptor[];
}

export type ControlPlaneCapabilityGateStage = 'read' | 'dry-run' | 'compare-and-swap';

export interface ControlPlaneCapabilityGateScope {
  readonly workbookId?: string;
  readonly sheetId?: string;
  readonly featureId?: string;
  readonly principalId?: string;
  readonly labels?: readonly string[];
}

export type ControlPlanePreflightDigestAlgorithm = 'sha256' | 'opaque';

export interface ControlPlanePreflightDigest {
  readonly algorithm: ControlPlanePreflightDigestAlgorithm;
  readonly value: string;
}

export type ControlPlaneDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ControlPlaneDiagnostic {
  readonly severity: ControlPlaneDiagnosticSeverity;
  readonly code: string;
  readonly message?: string;
  readonly entrypointId?: ControlPlaneEntrypointId;
}

export type ControlPlaneReadSnapshotStatus = 'available' | 'disabled' | 'unavailable';

export interface ControlPlaneCapabilityGateSnapshot {
  readonly gateId: string;
  readonly stage: ControlPlaneCapabilityGateStage;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly status: ControlPlaneReadSnapshotStatus;
  readonly preflightDigest?: ControlPlanePreflightDigest;
  readonly diagnostics?: readonly ControlPlaneDiagnostic[];
}

export interface ControlPlaneReadRequest {
  readonly scope?: ControlPlaneCapabilityGateScope;
}

export interface ControlPlaneReadSnapshot {
  readonly status: ControlPlaneReadSnapshotStatus;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly gates: readonly ControlPlaneCapabilityGateSnapshot[];
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
}

export interface ControlPlaneDryRunRequest {
  readonly gateId: string;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly expectedDigest?: ControlPlanePreflightDigest;
  readonly clientRequestId?: string;
}

export type ControlPlaneDryRunResultStatus = 'not-applied';
export type ControlPlaneDryRunResultReason = 'noop' | 'unavailable';

export interface ControlPlaneDryRunResult {
  readonly status: ControlPlaneDryRunResultStatus;
  readonly reason: ControlPlaneDryRunResultReason;
  readonly applied: false;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
  readonly preflightDigest?: ControlPlanePreflightDigest;
}

export interface ControlPlaneCompareAndSwapRequest {
  readonly gateId: string;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly expectedDigest: ControlPlanePreflightDigest;
  readonly clientRequestId?: string;
}

export type ControlPlaneCompareAndSwapResultStatus = 'not-applied';
export type ControlPlaneCompareAndSwapResultReason = 'unavailable';

export interface ControlPlaneCompareAndSwapResult {
  readonly status: ControlPlaneCompareAndSwapResultStatus;
  readonly reason: ControlPlaneCompareAndSwapResultReason;
  readonly applied: false;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
  readonly currentDigest?: ControlPlanePreflightDigest;
}

export interface ControlPlaneShadowObservationEvent {
  readonly entrypointId: Extract<ControlPlaneEntrypointId, 'control-plane.shadow.observe'>;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
}

export type ControlPlaneShadowObservationHook = (
  event: ControlPlaneShadowObservationEvent,
) => void;

export interface ControlPlaneShadowObservationOptions {
  readonly scope?: ControlPlaneCapabilityGateScope;
}

export interface ControlPlaneDisposable {
  dispose(): void;
}

export interface ControlPlaneClient {
  readonly entrypoints: ControlPlaneEntrypointInventory;
  readCapabilityGates(request?: ControlPlaneReadRequest): Promise<ControlPlaneReadSnapshot>;
  dryRunCapabilityGate(request: ControlPlaneDryRunRequest): Promise<ControlPlaneDryRunResult>;
  compareAndSwapCapabilityGate(
    request: ControlPlaneCompareAndSwapRequest,
  ): Promise<ControlPlaneCompareAndSwapResult>;
  observeShadow(
    hook: ControlPlaneShadowObservationHook,
    options?: ControlPlaneShadowObservationOptions,
  ): ControlPlaneDisposable;
}
