import type { VersionRef, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

export type VersionActionDisabledReasonId =
  | 'version-action-busy'
  | 'version-branch-name-invalid'
  | 'version-capability-host-denied'
  | 'version-capability-unavailable'
  | 'version-checkout-unsafe'
  | 'version-commit-message-required'
  | 'version-commit-no-eligible-changes'
  | 'version-commit-no-local-changes'
  | 'version-diff-incomplete'
  | 'version-dirty-status-unavailable'
  | 'version-head-stale'
  | 'version-history-incomplete'
  | 'version-provider-writes-pending'
  | 'version-recalc-pending'
  | 'version-rollback-reason-required'
  | 'version-status-refreshing'
  | 'version-status-unavailable'
  | 'version-surface-unavailable'
  | 'version-target-required'
  | 'version-unsupported-domain'
  | 'versioning-disabled';

export type VersionActionAvailability =
  | {
      readonly enabled: true;
      readonly disabledReason?: undefined;
      readonly disabledReasonId?: undefined;
    }
  | {
      readonly enabled: false;
      readonly disabledReason: string;
      readonly disabledReasonId: VersionActionDisabledReasonId;
    };

export type DisabledActionReason = {
  readonly id: VersionActionDisabledReasonId;
  readonly message: string;
};

export type VersionActionSurfaceData = {
  readonly surface?: VersionSurfaceStatus;
  readonly refs?: readonly Pick<VersionRef, 'name'>[];
};
