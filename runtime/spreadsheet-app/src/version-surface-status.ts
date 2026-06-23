import type {
  SpreadsheetCapability,
  SpreadsheetPolicyDecision,
  SpreadsheetPolicySnapshot,
} from './public-types';
import { RUNTIME_POLICY_SNAPSHOT_CAPABILITIES } from './runtime-policy-capabilities';

type VersionCapability = Extract<SpreadsheetCapability, `version:${string}`>;

type VersionCapabilityState =
  | { readonly enabled: true }
  | {
      readonly enabled: false;
      readonly dependency?: string;
      readonly reason: string;
      readonly retryable: boolean;
    };

type VersionSurfaceStatus = {
  readonly schemaVersion: 1;
  readonly capabilities: Record<string, VersionCapabilityState | undefined>;
  readonly diagnostics?: readonly unknown[];
};

export const VERSION_SURFACE_HOST_CAPABILITY_DENIED_DIAGNOSTIC_CODE =
  'version.surfaceStatus.hostCapabilityDenied';

const VERSION_SURFACE_UI_CAPABILITIES =
  RUNTIME_POLICY_SNAPSHOT_CAPABILITIES.filter(isVersionCapability);

export function projectVersionSurfaceStatusForPolicy(
  status: unknown,
  policy: SpreadsheetPolicySnapshot | undefined,
): unknown {
  if (!policy || !isVersionSurfaceStatus(status)) return status;

  const projectedCapabilities = { ...status.capabilities };
  const deniedCapabilities: VersionCapability[] = [];
  let changed = false;

  for (const capability of VERSION_SURFACE_UI_CAPABILITIES) {
    const decision = versionCapabilityDecision(policy, capability);
    if (decision === 'allowed') continue;

    deniedCapabilities.push(capability);
    const nextState = hostCapabilityDeniedState(capability, decision);
    if (!sameCapabilityState(projectedCapabilities[capability], nextState)) {
      projectedCapabilities[capability] = nextState;
      changed = true;
    }
  }

  if (!changed) return status;

  return {
    ...status,
    capabilities: projectedCapabilities,
    diagnostics: [
      ...(Array.isArray(status.diagnostics) ? status.diagnostics : []),
      {
        code: VERSION_SURFACE_HOST_CAPABILITY_DENIED_DIAGNOSTIC_CODE,
        severity: 'warning',
        message: 'Host policy denied workbook version capabilities.',
        dependency: 'hostCapability',
        data: { deniedCapabilities },
      },
    ],
  };
}

function isVersionCapability(capability: SpreadsheetCapability): capability is VersionCapability {
  return capability.startsWith('version:');
}

function isVersionSurfaceStatus(value: unknown): value is VersionSurfaceStatus {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { readonly schemaVersion?: unknown }).schemaVersion === 1 &&
    isRecord((value as { readonly capabilities?: unknown }).capabilities)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function versionCapabilityDecision(
  policy: SpreadsheetPolicySnapshot,
  capability: VersionCapability,
): SpreadsheetPolicyDecision {
  return (
    policy.decisions.find((decision) => decision.capability === capability)?.decision ?? 'denied'
  );
}

function hostCapabilityDeniedState(
  capability: VersionCapability,
  decision: Exclude<SpreadsheetPolicyDecision, 'allowed'>,
): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'hostCapability',
    reason:
      decision === 'approval-required'
        ? `Host policy requires approval for ${capability}.`
        : `Host policy denies ${capability}.`,
    retryable: decision === 'approval-required',
  };
}

function sameCapabilityState(
  left: VersionCapabilityState | undefined,
  right: VersionCapabilityState,
): boolean {
  if (!left) return false;
  if (left.enabled !== right.enabled) return false;
  if (left.enabled || right.enabled) return left.enabled === right.enabled;
  return (
    left.dependency === right.dependency &&
    left.reason === right.reason &&
    left.retryable === right.retryable
  );
}
