import type { VersionCapability } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type { VersionMergePublicCapability } from './version-merge-capability-constants';

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

export type MaybeVersionRuntimeContext = DocumentContext & {
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
