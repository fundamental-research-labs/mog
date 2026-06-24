import type { DocumentContext } from '../../../../context';
import type {
  MaybeVersionRuntimeContext,
  VersionControlGateStatus,
} from './version-merge-capability-types';
import { isRecord, readBoolean } from './version-merge-capability-utils';

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
  const capabilityGate = readBoolean(capabilities, ['versionControlMerge', 'versionControl.merge']);
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
