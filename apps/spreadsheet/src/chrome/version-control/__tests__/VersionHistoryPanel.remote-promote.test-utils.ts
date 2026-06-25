import { jest } from '@jest/globals';
import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionPromotePendingRemoteResult,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  createSurfaceStatus,
  createWorkbook,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

export const PROMOTED_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const LATEST_REMOTE_COMMIT_ID = `commit:sha256:${'e'.repeat(64)}` as WorkbookCommitId;
export const PENDING_REMOTE_SEGMENT_ID = `pending-remote-segment:sha256:${'d'.repeat(64)}` as const;
export const PENDING_REMOTE_BACKLOG_MESSAGE =
  'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.';

type CreateRemotePromotionSurfaceStatusOptions = {
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
};

type CreateRemotePromotionWorkbookOptions = {
  readonly surface?: VersionSurfaceStatus;
  readonly getSurfaceStatus?: VersionHistoryWorkbook['version']['getSurfaceStatus'];
  readonly promotePendingRemote?: VersionHistoryWorkbook['version']['promotePendingRemote'];
};

export function createRemotePromotionSurfaceStatus({
  current = {},
  dirty = {},
  capabilityOverrides = {},
}: CreateRemotePromotionSurfaceStatusOptions = {}): VersionSurfaceStatus {
  const mergedCapabilityOverrides: Partial<Record<VersionCapability, VersionCapabilityState>> = {
    'version:revert': { enabled: true },
    ...capabilityOverrides,
  };

  return createSurfaceStatus({
    current,
    dirty,
    capabilityOverrides: mergedCapabilityOverrides,
  });
}

export function createRemotePromotionWorkbook({
  surface = createRemotePromotionSurfaceStatus(),
  getSurfaceStatus,
  promotePendingRemote,
}: CreateRemotePromotionWorkbookOptions = {}): VersionHistoryWorkbook {
  return createWorkbook({
    getSurfaceStatus: getSurfaceStatus ?? jest.fn(async () => surface),
    promotePendingRemote:
      promotePendingRemote ?? jest.fn(async () => successfulRemotePromotionResult()),
  });
}

export function successfulRemotePromotionResult(
  overrides: Partial<VersionPromotePendingRemoteResult> = {},
): Awaited<ReturnType<VersionHistoryWorkbook['version']['promotePendingRemote']>> {
  return {
    ok: true,
    value: {
      status: 'success',
      promotedSegmentIds: [PENDING_REMOTE_SEGMENT_ID],
      commitIds: [PROMOTED_COMMIT_ID],
      skipped: [],
      diagnostics: [],
      ...overrides,
    },
  };
}

export function pendingProviderWritesDiagnostic(
  message: string,
  data: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.pendingProviderWrites',
    severity: 'warning',
    message,
    data,
  };
}

export function disabledCapabilityState(
  reason: string,
  dependency: VersionCapabilityDependency,
  retryable: boolean,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}
