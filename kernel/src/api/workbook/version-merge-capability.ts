import type {
  VersionCapability,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

export type VersionMergePublicOperation = 'merge' | 'applyMerge';
export type VersionMergePublicCapability = Extract<
  VersionCapability,
  'version:mergePreview' | 'version:mergeApply'
>;

export const VERSION_CAPABILITY_KEYS = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:revert',
  'version:provenance',
] as const satisfies readonly VersionCapability[];

export type VersionMergeCapabilityDisabledReason =
  | 'versionControlDisabled'
  | 'mergeCapabilityDisabled'
  | 'mergeKillSwitchActive'
  | 'hostCapabilityDenied'
  | 'hostCapabilityApprovalRequired';

export type VersionControlGateStatus = {
  readonly enabled: boolean;
  readonly discovered: boolean;
  readonly editingEnabled: boolean;
  readonly mergeEnabled: boolean;
  readonly mergeDiscovered: boolean;
  readonly mergeKillSwitchActive: boolean;
  readonly mergeKillSwitchDiscovered: boolean;
};

export type VersionMergeCapabilityDecision =
  | {
      readonly enabled: true;
      readonly status: VersionControlGateStatus;
    }
  | {
      readonly enabled: false;
      readonly capability: VersionMergePublicCapability;
      readonly reason: VersionMergeCapabilityDisabledReason;
      readonly status: VersionControlGateStatus;
    };

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
  readonly featureGates?: unknown;
  readonly hostFeatureGates?: unknown;
  readonly gates?: unknown;
  readonly policy?: unknown;
  readonly policySnapshot?: unknown;
  readonly versionPolicy?: unknown;
  readonly hostCapabilityPolicy?: unknown;
  readonly hostPolicy?: unknown;
};

export type HostCapabilityDecision = 'allowed' | 'denied' | 'approval-required';
export type HostCapabilityDecisions = Partial<Record<VersionCapability, HostCapabilityDecision>>;

export function getVersionControlGateStatus(ctx: DocumentContext): VersionControlGateStatus {
  const runtime = ctx as MaybeVersionRuntimeContext;
  let versionControl: boolean | undefined;
  let editing: boolean | undefined;
  let merge: boolean | undefined;

  for (const candidate of [runtime.featureGates, runtime.hostFeatureGates, runtime.gates]) {
    versionControl ??= readVersionControlGate(candidate);
    editing ??= readEditingGate(candidate);
    merge ??= readVersionControlMergeGate(candidate);
  }

  let mergeKillSwitch: boolean | undefined;
  for (const candidate of [
    runtime.versioning,
    runtime.versionStore,
    runtime.version,
    runtime.featureGates,
    runtime.hostFeatureGates,
    runtime.gates,
    runtime.policy,
    runtime.policySnapshot,
    runtime.versionPolicy,
    runtime.hostCapabilityPolicy,
    runtime.hostPolicy,
  ]) {
    mergeKillSwitch ??= readVersionControlMergeKillSwitch(candidate);
  }

  return {
    enabled: versionControl ?? true,
    discovered: versionControl !== undefined,
    editingEnabled: editing ?? true,
    mergeEnabled: merge ?? true,
    mergeDiscovered: merge !== undefined,
    mergeKillSwitchActive: mergeKillSwitch ?? false,
    mergeKillSwitchDiscovered: mergeKillSwitch !== undefined,
  };
}

export function getVersionMergeCapabilityDecision(
  ctx: DocumentContext,
  capability: VersionMergePublicCapability,
): VersionMergeCapabilityDecision {
  const status = getVersionControlGateStatus(ctx);
  if (!status.enabled) {
    return { enabled: false, capability, reason: 'versionControlDisabled', status };
  }
  if (!status.mergeEnabled) {
    return { enabled: false, capability, reason: 'mergeCapabilityDisabled', status };
  }
  if (status.mergeKillSwitchActive) {
    return { enabled: false, capability, reason: 'mergeKillSwitchActive', status };
  }

  const hostDecision = getVersionHostCapabilityDecisions(ctx)[capability];
  if (hostDecision === 'denied') {
    return { enabled: false, capability, reason: 'hostCapabilityDenied', status };
  }
  if (hostDecision === 'approval-required') {
    return { enabled: false, capability, reason: 'hostCapabilityApprovalRequired', status };
  }
  return { enabled: true, status };
}

export function getVersionHostCapabilityDecisions(
  ctx: DocumentContext,
): HostCapabilityDecisions {
  const runtime = ctx as MaybeVersionRuntimeContext;
  for (const candidate of [
    runtime.policy,
    runtime.policySnapshot,
    runtime.versionPolicy,
    runtime.hostCapabilityPolicy,
    runtime.hostPolicy,
  ]) {
    const decisions = readHostCapabilityDecisions(candidate);
    if (decisions) return decisions;
  }
  return {};
}

export function versionMergeCapabilityDisabledDiagnostic(
  operation: VersionMergePublicOperation,
  decision: Extract<VersionMergeCapabilityDecision, { readonly enabled: false }>,
): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: `version.${operation}.capabilityDisabled`,
    safeMessage: safeMessageForDisabledReason(decision.reason),
    payload: {
      operation,
      endpointStatus: 'capabilityDisabled',
      capability: 'versionControl.merge',
      publicCapability: decision.capability,
      reason: decision.reason,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function safeMessageForDisabledReason(reason: VersionMergeCapabilityDisabledReason): string {
  switch (reason) {
    case 'versionControlDisabled':
      return 'Version-control merge endpoints are disabled for this workbook.';
    case 'mergeCapabilityDisabled':
      return 'Version-control merge capability is disabled for this workbook.';
    case 'mergeKillSwitchActive':
      return 'Version-control merge endpoints are disabled by the runtime kill switch.';
    case 'hostCapabilityDenied':
      return 'Host policy denies version-control merge capability for this workbook.';
    case 'hostCapabilityApprovalRequired':
      return 'Host policy requires approval for version-control merge capability.';
  }
}

function readVersionControlGate(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  if (typeof capabilities?.versionControl === 'boolean') return capabilities.versionControl;
  if (typeof value.versionControl === 'boolean') return value.versionControl;
  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  return readBoolean(versionControl, ['enabled']);
}

function readVersionControlMergeGate(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const capabilityGate = readBoolean(capabilities, [
    'versionControlMerge',
    'versionControl.merge',
  ]);
  if (capabilityGate !== undefined) return capabilityGate;

  const directGate = readBoolean(value, ['versionControlMerge', 'versionControl.merge']);
  if (directGate !== undefined) return directGate;

  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  const nestedVersionGate = readBoolean(versionControl, ['merge', 'mergeEnabled']);
  if (nestedVersionGate !== undefined) return nestedVersionGate;

  const merge = isRecord(value.merge) ? value.merge : null;
  const nestedMergeGate = readBoolean(merge, ['enabled']);
  if (nestedMergeGate !== undefined) return nestedMergeGate;

  const disabled = readBoolean(value, ['versionControlMergeDisabled']);
  return disabled === undefined ? undefined : !disabled;
}

function readVersionControlMergeKillSwitch(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const direct = readBoolean(value, [
    'versionControlMergeKillSwitch',
    'versionControlMergeKillSwitchActive',
    'versionControl.merge.killSwitch',
  ]);
  if (direct !== undefined) return direct;

  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const capabilitySwitch = readBoolean(capabilities, [
    'versionControlMergeKillSwitch',
    'versionControl.merge.killSwitch',
  ]);
  if (capabilitySwitch !== undefined) return capabilitySwitch;

  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  const nestedVersionSwitch = readBoolean(versionControl, [
    'mergeKillSwitch',
    'mergeKillSwitchActive',
  ]);
  if (nestedVersionSwitch !== undefined) return nestedVersionSwitch;

  const versionControlMerge = isRecord(value.versionControlMerge)
    ? value.versionControlMerge
    : null;
  const nestedMergeSwitch = readBoolean(versionControlMerge, [
    'killSwitch',
    'killSwitchActive',
    'disabledByKillSwitch',
  ]);
  if (nestedMergeSwitch !== undefined) return nestedMergeSwitch;

  const merge = isRecord(value.merge) ? value.merge : null;
  return readBoolean(merge, ['killSwitch', 'killSwitchActive', 'disabledByKillSwitch']);
}

function readEditingGate(value: unknown): boolean | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.editing === 'boolean' ? value.editing : undefined;
}

function readHostCapabilityDecisions(value: unknown): HostCapabilityDecisions | null {
  const source =
    Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.decisions) ? value.decisions : null;
  if (!source) return null;

  const decisions: HostCapabilityDecisions = {};
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const capability = toVersionCapability(entry.capability);
    const decision = toHostCapabilityDecision(entry.decision);
    if (capability && decision) decisions[capability] = decision;
  }
  return Object.keys(decisions).length > 0 ? decisions : null;
}

function toVersionCapability(value: unknown): VersionCapability | null {
  return typeof value === 'string' && (VERSION_CAPABILITY_KEYS as readonly string[]).includes(value)
    ? (value as VersionCapability)
    : null;
}

function toHostCapabilityDecision(value: unknown): HostCapabilityDecision | null {
  return value === 'allowed' || value === 'denied' || value === 'approval-required' ? value : null;
}

function readBoolean(
  value: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): boolean | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key] as boolean;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
