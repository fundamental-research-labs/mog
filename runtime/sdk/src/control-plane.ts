import {
  CONTROL_PLANE_ENTRYPOINT_IDS,
  type ControlPlaneClient,
  type ControlPlaneCompareAndSwapRequest,
  type ControlPlaneCompareAndSwapResult,
  type ControlPlaneDiagnostic,
  type ControlPlaneDryRunRequest,
  type ControlPlaneDryRunResult,
  type ControlPlaneEntrypointDescriptor,
  type ControlPlaneEntrypointId,
  type ControlPlaneEntrypointInventory,
  type ControlPlaneReadRequest,
  type ControlPlaneReadSnapshot,
  type ControlPlaneShadowObservationHook,
  type ControlPlaneShadowObservationOptions,
} from '@mog-sdk/contracts/control-plane';

export {
  CONTROL_PLANE_ENTRYPOINT_IDS,
  type ControlPlaneArtifactRuntimeRange,
  type ControlPlaneCapabilityGateScope,
  type ControlPlaneCapabilityGateScopeDelta,
  type ControlPlaneCapabilityGateSnapshot,
  type ControlPlaneCapabilityGateStage,
  type ControlPlaneCapabilityGateRolloutStage,
  type ControlPlaneCasToken,
  type ControlPlaneClient,
  type ControlPlaneCompareAndSwapRequest,
  type ControlPlaneCompareAndSwapResult,
  type ControlPlaneCompareAndSwapResultReason,
  type ControlPlaneCompareAndSwapResultStatus,
  type ControlPlaneDiagnostic,
  type ControlPlaneDiagnosticSeverity,
  type ControlPlaneDisposable,
  type ControlPlaneDryRunRequest,
  type ControlPlaneDryRunResult,
  type ControlPlaneDryRunResultReason,
  type ControlPlaneDryRunResultStatus,
  type ControlPlaneEntrypointDescriptor,
  type ControlPlaneEntrypointId,
  type ControlPlaneEntrypointInventory,
  type ControlPlaneEntrypointStatus,
  type ControlPlaneRuntimeKind,
  type GateEvidencePreflightDigest,
  type ControlPlanePreflightDigest,
  type ControlPlanePreflightDigestAlgorithm,
  type ControlPlaneReadRequest,
  type ControlPlaneReadSnapshot,
  type ControlPlaneReadSnapshotStatus,
  type ControlPlaneShadowObservationEvent,
  type ControlPlaneShadowObservationHook,
  type ControlPlaneShadowObservationOptions,
} from '@mog-sdk/contracts/control-plane';

const ENTRYPOINT_DESCRIPTIONS: Record<ControlPlaneEntrypointId, string> = {
  'control-plane.capability-gates.read':
    'Read public capability-gate status snapshots when a control plane is available.',
  'control-plane.capability-gates.dry-run':
    'Evaluate a public capability-gate write without applying state when a control plane is available.',
  'control-plane.capability-gates.compare-and-swap':
    'Apply a public capability-gate compare-and-swap when a control plane is available.',
  'control-plane.shadow.observe':
    'Observe public shadow control-plane events when a control plane is available.',
};

const UNAVAILABLE_DIAGNOSTIC: ControlPlaneDiagnostic = Object.freeze({
  severity: 'info',
  code: 'control-plane.unavailable',
  message: 'The public SDK control-plane surface is inert in this runtime.',
});

const NOOP_DIAGNOSTIC: ControlPlaneDiagnostic = Object.freeze({
  severity: 'info',
  code: 'control-plane.noop',
  message: 'No capability-gate state was changed.',
});

const UNAVAILABLE_DIAGNOSTICS: readonly ControlPlaneDiagnostic[] = Object.freeze([
  UNAVAILABLE_DIAGNOSTIC,
]);

const NOOP_DIAGNOSTICS: readonly ControlPlaneDiagnostic[] = Object.freeze([NOOP_DIAGNOSTIC]);

const entrypointDescriptors: readonly ControlPlaneEntrypointDescriptor[] = Object.freeze(
  CONTROL_PLANE_ENTRYPOINT_IDS.map((id) =>
    Object.freeze({
      id,
      status: 'disabled',
      description: ENTRYPOINT_DESCRIPTIONS[id],
    } satisfies ControlPlaneEntrypointDescriptor),
  ),
);

export const controlPlaneEntrypoints: ControlPlaneEntrypointInventory = Object.freeze({
  entrypoints: entrypointDescriptors,
});

const disposable = Object.freeze({
  dispose(): void {
    // Inert public control-plane observers do not allocate subscriptions.
  },
});

export function observeControlPlaneShadow(
  _hook: ControlPlaneShadowObservationHook,
  _options?: ControlPlaneShadowObservationOptions,
): typeof disposable {
  return disposable;
}

export function createInertControlPlane(): ControlPlaneClient {
  return Object.freeze({
    entrypoints: controlPlaneEntrypoints,
    async readCapabilityGates(
      request?: ControlPlaneReadRequest,
    ): Promise<ControlPlaneReadSnapshot> {
      return Object.freeze({
        status: 'disabled',
        scope: request?.scope,
        gates: Object.freeze([]),
        diagnostics: UNAVAILABLE_DIAGNOSTICS,
      });
    },
    async dryRunCapabilityGate(
      request: ControlPlaneDryRunRequest,
    ): Promise<ControlPlaneDryRunResult> {
      return Object.freeze({
        status: 'not-applied',
        reason: 'noop',
        applied: false,
        casKey: request.casKey,
        expectedPriorStage: request.expectedPriorStage,
        targetStage: request.targetStage,
        priorScope: request.priorScope,
        targetScope: request.targetScope,
        scopeDelta: request.scopeDelta,
        diagnostics: NOOP_DIAGNOSTICS,
        preflightDigest: request.preflightDigest,
        artifactRuntimeRange: request.artifactRuntimeRange,
      });
    },
    async compareAndSwapCapabilityGate(
      request: ControlPlaneCompareAndSwapRequest,
    ): Promise<ControlPlaneCompareAndSwapResult> {
      return Object.freeze({
        status: 'not-applied',
        reason: 'unavailable',
        applied: false,
        casKey: request.casKey,
        expectedPriorStage: request.expectedPriorStage,
        targetStage: request.targetStage,
        priorScope: request.priorScope,
        targetScope: request.targetScope,
        scopeDelta: request.scopeDelta,
        diagnostics: UNAVAILABLE_DIAGNOSTICS,
        preflightDigest: request.preflightDigest,
        expectedPriorCasToken: request.expectedPriorCasToken,
        artifactRuntimeRange: request.artifactRuntimeRange,
        casReceipt: Object.freeze({
          applied: false,
          reason: 'unavailable',
          casKey: request.casKey,
          expectedPriorCasToken: request.expectedPriorCasToken,
        }),
      });
    },
    observeShadow: observeControlPlaneShadow,
  });
}
