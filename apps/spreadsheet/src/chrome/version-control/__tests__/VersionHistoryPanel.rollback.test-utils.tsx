import { jest } from '@jest/globals';
import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionResult,
  VersionStoreDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  REF_REVISION,
  createWorkbook as createVersionHistoryWorkbook,
  renderVersionHistoryPanel,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

export {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  branchTargetTestId,
  createDeferred,
  expectActionResult,
  expectDisabledButtonReason,
  shortCommitId,
} from './VersionHistoryPanel.test-utils';
export type { VersionHistoryWorkbook } from './VersionHistoryPanel.test-utils';

const ALL_CAPABILITIES: readonly VersionCapability[] = [
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
  'version:remotePromote',
];

export function renderRollbackPanel({
  workbook = createRollbackWorkbook(),
  onClose,
}: {
  readonly workbook?: VersionHistoryWorkbook;
  readonly onClose?: () => void;
} = {}) {
  return renderVersionHistoryPanel({ workbook, onClose });
}

export function createRollbackWorkbook({
  surface = createRollbackSurfaceStatus(),
  getSurfaceStatus,
  revert,
}: {
  readonly surface?: VersionSurfaceStatus;
  readonly getSurfaceStatus?: VersionHistoryWorkbook['version']['getSurfaceStatus'];
  readonly revert?: VersionHistoryWorkbook['version']['revert'];
} = {}): VersionHistoryWorkbook {
  return createVersionHistoryWorkbook({
    getSurfaceStatus: getSurfaceStatus ?? jest.fn(async () => surface),
    revert:
      revert ??
      jest.fn(async (input: Parameters<VersionHistoryWorkbook['version']['revert']>[0]) => ({
        ok: true,
        value: {
          schemaVersion: 1,
          status: 'planned',
          target: input.target,
          diagnostics: [],
          mutationGuarantee: 'no-write-attempted',
        },
      })),
  });
}

export function createRollbackSurfaceStatus({
  revertEnabled = false,
  featureGateEnabled = true,
  current = {},
  dirty = {},
  capabilityOverrides = {},
}: {
  readonly revertEnabled?: boolean;
  readonly featureGateEnabled?: boolean;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled,
    storage: { ready: true, backend: 'memory', diagnostics: [] },
    current: {
      headCommitId: HEAD_COMMIT_ID,
      branchName: 'refs/heads/main',
      detached: false,
      stale: false,
      ...current,
    },
    dirty: {
      statusRevision: '1',
      checkoutPreflightToken: 'token-1',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: true,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
      ...dirty,
    },
    capabilities: Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => {
        const override = capabilityOverrides[capability];
        if (override) return [capability, override];
        if (capability === 'version:revert' && !revertEnabled) {
          return [
            capability,
            disabledCapabilityState(
              'Authored revert is reserved until an upstream revert contract exists.',
              'upstreamRevertContract',
              false,
            ),
          ];
        }
        return [capability, { enabled: true } satisfies VersionCapabilityState];
      }),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

export function disabledCapabilityState(
  reason: string,
  dependency: VersionCapabilityDependency,
  retryable: boolean,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

export function failedStaleHead<T = never>(
  expectedHeadId: WorkbookCommitId,
  actualHeadId: WorkbookCommitId,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_head', expectedHeadId, actualHeadId },
  };
}

export function rejectedRollbackDryRun(
  safeMessage: string,
): Awaited<ReturnType<VersionHistoryWorkbook['version']['revert']>> {
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      status: 'rejected',
      target: { kind: 'commit', commitId: HEAD_COMMIT_ID },
      diagnostics: [
        {
          issueCode: 'VERSION_REVERT_BLOCKED' as VersionStoreDiagnostic['issueCode'],
          severity: 'warning',
          recoverability: 'retry',
          messageTemplateId:
            'version.revert.blocked' as VersionStoreDiagnostic['messageTemplateId'],
          safeMessage,
          redacted: true,
          mutationGuarantee: 'ref-not-mutated',
        },
      ],
      mutationGuarantee: 'ref-not-mutated',
    },
  };
}
