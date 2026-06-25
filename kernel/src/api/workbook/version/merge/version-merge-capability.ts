export { VERSION_CAPABILITY_KEYS } from './version-merge-capability-constants';
export type {
  VersionMergePublicCapability,
  VersionMergePublicOperation,
} from './version-merge-capability-constants';
export { getVersionMergeCapabilityDecision } from './version-merge-capability-decision';
export { versionMergeCapabilityDisabledDiagnostic } from './version-merge-capability-diagnostics';
export { getVersionControlGateStatus } from './version-merge-capability-gates';
export { getVersionHostCapabilityDecisions } from './version-merge-capability-host-policy';
export { versionMergeCapabilityForOperation } from './version-merge-capability-operations';
export type {
  HostCapabilityDecision,
  HostCapabilityDecisions,
  VersionControlGateStatus,
  VersionMergeCapabilityDecision,
  VersionMergeCapabilityDisabledReason,
} from './version-merge-capability-types';
