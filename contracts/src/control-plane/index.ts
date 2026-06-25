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

export type ControlPlaneCapabilityGateRolloutStage =
  | 'disabled'
  | 'shadow-only'
  | 'headless-local'
  | 'ui-beta'
  | 'collab-interop-beta'
  | 'default-on';

export type ControlPlaneCapabilityGateStage = ControlPlaneCapabilityGateRolloutStage;

export type ControlPlaneRuntimeKind =
  | 'headless-sdk'
  | 'browser'
  | 'workerd'
  | 'tauri'
  | 'node'
  | 'unknown';

export interface ControlPlaneCapabilityGateScope {
  readonly workbookId?: string;
  readonly sheetId?: string;
  readonly featureId?: string;
  readonly domainIds?: readonly string[];
  readonly surfaceIds?: readonly string[];
  readonly environmentIds?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly channelIds?: readonly string[];
  readonly clientRuntimeIds?: readonly string[];
  readonly labels?: readonly string[];
}

export interface ControlPlaneCapabilityGateScopeDelta {
  readonly added?: ControlPlaneCapabilityGateScope;
  readonly removed?: ControlPlaneCapabilityGateScope;
  readonly changedFields?: readonly string[];
  readonly summary?: string;
}

export type ControlPlanePreflightDigestAlgorithm = 'sha256' | 'opaque';

export interface ControlPlanePreflightDigest {
  readonly algorithm: ControlPlanePreflightDigestAlgorithm;
  readonly value: string;
}

export type GateEvidencePreflightDigest = ControlPlanePreflightDigest;

export interface ControlPlaneCasToken {
  readonly token: string;
  readonly version: string;
}

export interface ControlPlaneArtifactRuntimeRange {
  readonly runtimeKind?: ControlPlaneRuntimeKind;
  readonly artifactId?: string;
  readonly packageName?: string;
  readonly packageVersion?: string;
  readonly deployId?: string;
  readonly channelId?: string;
  readonly minClientVersion?: string;
  readonly maxClientVersion?: string;
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
  readonly stage: ControlPlaneCapabilityGateRolloutStage;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly status: ControlPlaneReadSnapshotStatus;
  readonly preflightDigest?: GateEvidencePreflightDigest;
  readonly casToken?: ControlPlaneCasToken;
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
  readonly casKey: string;
  readonly expectedPriorStage: ControlPlaneCapabilityGateRolloutStage;
  readonly targetStage: ControlPlaneCapabilityGateRolloutStage;
  readonly priorScope: ControlPlaneCapabilityGateScope;
  readonly targetScope: ControlPlaneCapabilityGateScope;
  readonly scopeDelta: ControlPlaneCapabilityGateScopeDelta;
  readonly preflightDigest: GateEvidencePreflightDigest;
  readonly artifactRuntimeRange?: ControlPlaneArtifactRuntimeRange;
  readonly clientRequestId?: string;
}

export type ControlPlaneDryRunResultStatus = 'not-applied';
export type ControlPlaneDryRunResultReason = 'noop' | 'unavailable';

export interface ControlPlaneDryRunResult {
  readonly status: ControlPlaneDryRunResultStatus;
  readonly reason: ControlPlaneDryRunResultReason;
  readonly applied: false;
  readonly casKey: string;
  readonly expectedPriorStage: ControlPlaneCapabilityGateRolloutStage;
  readonly targetStage: ControlPlaneCapabilityGateRolloutStage;
  readonly priorScope: ControlPlaneCapabilityGateScope;
  readonly targetScope: ControlPlaneCapabilityGateScope;
  readonly scopeDelta: ControlPlaneCapabilityGateScopeDelta;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
  readonly preflightDigest: GateEvidencePreflightDigest;
  readonly artifactRuntimeRange?: ControlPlaneArtifactRuntimeRange;
}

export interface ControlPlaneCompareAndSwapRequest {
  readonly casKey: string;
  readonly expectedPriorStage: ControlPlaneCapabilityGateRolloutStage;
  readonly targetStage: ControlPlaneCapabilityGateRolloutStage;
  readonly priorScope: ControlPlaneCapabilityGateScope;
  readonly targetScope: ControlPlaneCapabilityGateScope;
  readonly scopeDelta: ControlPlaneCapabilityGateScopeDelta;
  readonly preflightDigest: GateEvidencePreflightDigest;
  readonly expectedPriorCasToken: ControlPlaneCasToken;
  readonly artifactRuntimeRange?: ControlPlaneArtifactRuntimeRange;
  readonly clientRequestId?: string;
}

export type ControlPlaneCompareAndSwapResultStatus = 'not-applied';
export type ControlPlaneCompareAndSwapResultReason = 'unavailable';

export interface ControlPlaneCompareAndSwapResult {
  readonly status: ControlPlaneCompareAndSwapResultStatus;
  readonly reason: ControlPlaneCompareAndSwapResultReason;
  readonly applied: false;
  readonly casKey: string;
  readonly expectedPriorStage: ControlPlaneCapabilityGateRolloutStage;
  readonly targetStage: ControlPlaneCapabilityGateRolloutStage;
  readonly priorScope: ControlPlaneCapabilityGateScope;
  readonly targetScope: ControlPlaneCapabilityGateScope;
  readonly scopeDelta: ControlPlaneCapabilityGateScopeDelta;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
  readonly preflightDigest: GateEvidencePreflightDigest;
  readonly expectedPriorCasToken: ControlPlaneCasToken;
  readonly artifactRuntimeRange?: ControlPlaneArtifactRuntimeRange;
  readonly casReceipt: {
    readonly applied: false;
    readonly reason: ControlPlaneCompareAndSwapResultReason;
    readonly casKey: string;
    readonly expectedPriorCasToken: ControlPlaneCasToken;
  };
}

export interface ControlPlaneShadowObservationEvent {
  readonly entrypointId: Extract<ControlPlaneEntrypointId, 'control-plane.shadow.observe'>;
  readonly scope?: ControlPlaneCapabilityGateScope;
  readonly diagnostics: readonly ControlPlaneDiagnostic[];
}

export type ControlPlaneShadowObservationHook = (event: ControlPlaneShadowObservationEvent) => void;

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
