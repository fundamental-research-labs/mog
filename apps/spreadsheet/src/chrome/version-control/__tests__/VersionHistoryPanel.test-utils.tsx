import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionCapabilityState,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeResult,
  VersionRecordRevision,
  VersionResult,
  VersionSemanticDiffPage,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersion,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

export type { VersionHistoryWorkbook } from '../VersionHistoryPanel';
export { shortCommitId } from '../version-history-format';

export const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const MERGE_COMMIT_ID = `commit:sha256:${'d'.repeat(64)}` as WorkbookCommitId;
export const REF_REVISION: VersionRecordRevision = { kind: 'counter', value: '1' };

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

export type DirectMergeVersionHistoryWorkbook = VersionHistoryWorkbook & {
  readonly version: VersionHistoryWorkbook['version'] &
    Pick<WorkbookVersion, 'merge' | 'applyMerge'>;
};

type RenderVersionHistoryPanelOptions = {
  readonly workbook?: VersionHistoryWorkbook;
  readonly onClose?: () => void;
};

export function renderVersionHistoryPanel({
  workbook = createWorkbook(),
  onClose = jest.fn(),
}: RenderVersionHistoryPanelOptions = {}) {
  const user = userEvent.setup();

  const rendered = render(<VersionHistoryPanelContent workbook={workbook} onClose={onClose} />);

  return { user, workbook, onClose, ...rendered };
}

export function createWorkbook(
  overrides: Partial<DirectMergeVersionHistoryWorkbook['version']> = {},
): DirectMergeVersionHistoryWorkbook {
  const version = {
    getSurfaceStatus: jest.fn(async () => createSurfaceStatus()),
    getStatus: jest.fn(async () => ({ schemaVersion: 1, rolloutStage: 'headless-local' })),
    getHead: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        refName: 'refs/heads/main',
        refRevision: REF_REVISION,
      },
    })),
    readRef: jest.fn(async (name: Parameters<VersionHistoryWorkbook['version']['readRef']>[0]) => ({
      ok: true,
      value: {
        status: 'success',
        ref:
          name === 'HEAD'
            ? {
                name: 'HEAD',
                target: 'refs/heads/main',
                revision: REF_REVISION,
              }
            : {
                name,
                commitId: name === 'refs/heads/main' ? HEAD_COMMIT_ID : PARENT_COMMIT_ID,
                revision:
                  name === 'refs/heads/main' ? REF_REVISION : { kind: 'counter', value: '2' },
              },
        diagnostics: [],
      },
    })),
    listCommits: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          {
            id: HEAD_COMMIT_ID,
            parents: [PARENT_COMMIT_ID],
            createdAt: '2026-06-22T10:10:00.000Z',
            author: { redacted: false, displayName: 'Reviewer' },
            annotation: { title: { kind: 'text', value: 'Calculated forecast' } },
          },
          {
            id: PARENT_COMMIT_ID,
            parents: [],
            createdAt: '2026-06-22T10:00:00.000Z',
            author: { redacted: false, displayName: 'Reviewer' },
            annotation: { title: { kind: 'text', value: 'Initial import' } },
          },
        ],
        limit: 20,
      },
    })),
    listRefs: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          {
            name: 'refs/heads/main',
            commitId: HEAD_COMMIT_ID,
            revision: REF_REVISION,
          },
          {
            name: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            revision: { kind: 'counter', value: '2' },
          },
        ],
        limit: 2,
      },
    })),
    listReviews: jest.fn(async () => ({
      ok: true,
      value: {
        items: [],
        limit: 5,
      },
    })),
    listProposals: jest.fn(async () => ({
      ok: true,
      value: {
        items: [],
        limit: 5,
      },
    })),
    commit: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        parents: [PARENT_COMMIT_ID],
        createdAt: '2026-06-22T10:15:00.000Z',
        author: { redacted: false, displayName: 'Reviewer' },
        annotation: { title: { kind: 'text', value: 'Snapshot before review' } },
      },
    })),
    createBranch: jest.fn(
      async (options: Parameters<VersionHistoryWorkbook['version']['createBranch']>[0]) => ({
        ok: true,
        value: {
          name: options.name,
          commitId: options.targetCommitId,
          revision: { kind: 'counter', value: '3' },
        },
      }),
    ),
    promotePendingRemote: jest.fn(async () => ({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [],
        diagnostics: [],
      },
    })),
    checkout: jest.fn(async () => ({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        plan: {
          strategy: 'fullSnapshot',
          target: {
            kind: 'ref',
            refName: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            refRevision: { kind: 'counter', value: '2' },
          },
          commitId: PARENT_COMMIT_ID,
          parentCommitIds: [],
          requiredDependencies: [],
          requiredDependencyCount: 0,
        },
        diagnostics: [],
        mutationGuarantee: 'no-workbook-mutation',
      },
    })),
    diff: jest.fn(async () => ({ ok: true, value: semanticDiffPage([diffEntry()]) })),
    merge: jest.fn(
      async (input: Parameters<DirectMergeVersionHistoryWorkbook['version']['merge']>[0]) => ({
        ok: true,
        value: cleanMergeResult(input.base, input.ours, input.theirs),
      }),
    ),
    applyMerge: jest.fn(
      async (input: Parameters<DirectMergeVersionHistoryWorkbook['version']['applyMerge']>[0]) => {
        const mergeInput = directMergeInput(input);
        return {
          ok: true,
          value: appliedMergeResult(mergeInput.base, mergeInput.ours, mergeInput.theirs),
        };
      },
    ),
    ...overrides,
  };

  return { version } as unknown as DirectMergeVersionHistoryWorkbook;
}

export function semanticDiffPage(items: VersionSemanticDiffPage['items']): VersionSemanticDiffPage {
  return {
    items,
    limit: 50,
    readRevision: { kind: 'counter', value: '4' },
    order: 'semantic-change-order',
  };
}

export function diffEntry({
  changeId = 'change-1',
  diagnostics,
}: {
  readonly changeId?: string;
  readonly diagnostics?: VersionSemanticDiffPage['items'][number]['diagnostics'];
} = {}): VersionSemanticDiffPage['items'][number] {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: { kind: 'blank' } },
    after: { kind: 'value', value: '42' },
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function diffDiagnostic(issueCode: string, recoverability: 'retry' | 'unsupported') {
  return {
    issueCode,
    severity: 'warning' as const,
    recoverability,
    messageTemplateId: `version.diff.${issueCode}`,
    safeMessage: issueCode,
    redacted: true,
  };
}

export function cleanMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  changes: readonly VersionMergeChange[] = [mergeChange()],
): VersionMergeResult {
  return {
    status: 'clean',
    base,
    ours,
    theirs,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function conflictedMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  conflict: VersionMergeConflict = sameCellMergeConflict(),
): VersionMergeResult {
  return {
    status: 'conflicted',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [conflict],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function appliedMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  changes: readonly VersionMergeChange[] = [mergeChange()],
): VersionApplyMergeResult {
  return {
    status: 'applied',
    base,
    ours,
    theirs,
    commitRef: {
      id: MERGE_COMMIT_ID,
      refName: 'refs/heads/main',
      refRevision: { kind: 'counter', value: '5' },
    },
    changes,
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'merge-commit-created',
  };
}

export function sameCellMergeConflict(): VersionMergeConflict {
  const conflictId = 'conflict:sha256:same-cell-a1';
  return {
    conflictId,
    conflictDigest: 'sha256:same-cell-a1',
    conflictKind: 'same-property',
    structural: {
      kind: 'metadata',
      changeId: 'merge-conflict-a1',
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    resolutionOptions: [
      mergeResolutionOption(conflictId, 'acceptOurs', 'ours'),
      mergeResolutionOption(conflictId, 'acceptTheirs', 'theirs'),
      mergeResolutionOption(conflictId, 'acceptBase', 'base'),
    ],
  };
}

export function mergeResolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`Missing merge resolution option ${kind}`);

  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function createSurfaceStatus({
  disabledCapabilities = [],
  featureGateEnabled = true,
  current = {},
  dirty = {},
  capabilityOverrides = {},
}: {
  readonly disabledCapabilities?: readonly VersionCapability[];
  readonly featureGateEnabled?: boolean;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
} = {}): VersionSurfaceStatus {
  const disabled = new Set<VersionCapability>([
    'version:revert',
    ...(!featureGateEnabled ? ALL_CAPABILITIES : []),
    ...disabledCapabilities,
  ]);

  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled,
    storage: {
      ready: true,
      backend: 'memory',
      diagnostics: [],
    },
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
        const defaultState: VersionCapabilityState = disabled.has(capability)
          ? {
              enabled: false,
              dependency: featureGateEnabled
                ? capability === 'version:revert'
                  ? 'upstreamRevertContract'
                  : 'VC-05'
                : 'featureGate',
              reason: featureGateEnabled
                ? `${capability} is not available.`
                : 'The versionControl feature gate is disabled.',
              retryable: false,
            }
          : { enabled: true };

        return [capability, capabilityOverrides[capability] ?? defaultState];
      }),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

export function hostDeniedCapabilityState(capability: VersionCapability): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'hostCapability',
    reason: `Host policy denies ${capability}.`,
    retryable: false,
  };
}

export function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

export async function expectActionResult(
  message: string,
  status: 'success' | 'error',
): Promise<void> {
  await waitFor(() => {
    const result = screen.getByTestId('version-history-action-result');
    expect(result).toHaveAttribute('data-status', status);
    expect(result).toHaveTextContent(message);
  });
}

export function expectReasonById(id: string, reason: string): void {
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing disabled reason ${id}`);

  expect(element).toHaveTextContent(reason);
  expect(element).toBeVisible();
}

export function expectDisabledButtonReason(button: HTMLElement, reason: string): void {
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  expect(screen.getAllByText(reason)[0]).toBeVisible();
}

export function failedInvalidState<T = never>(reason: string): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'invalid_state', state: 'blocked', allowed: [], reason },
  };
}

export function failedInvalidBranchName<T = never>(
  branchName: string,
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_branch_name', branchName, reason } };
}

export function failedNotFound<T = never>(target: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'not_found', target, reason } };
}

export function branchTargetTestId(commitId: string): string {
  return `version-history-branch-target-${safeDomId(commitId)}`;
}

export function checkoutBranchTestId(refName: string): string {
  return `version-history-checkout-branch-${safeDomId(refName)}`;
}

export function parentDiffButtonTestId(commitId: string): string {
  return `version-history-parent-diff-button-${safeDomId(commitId)}`;
}

export function mergeSourceRefSelectTestId(): string {
  return 'version-merge-source-ref-select';
}

export function mergePreviewButtonTestId(): string {
  return 'version-merge-preview-button';
}

export function mergeApplyButtonTestId(): string {
  return 'version-merge-apply-button';
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function mergeChange(): VersionMergeChange {
  return {
    structural: {
      kind: 'metadata',
      changeId: 'merge-change-a1',
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    merged: { kind: 'value', value: 'theirs' },
    display: { address: { kind: 'value', value: 'A1' } },
  };
}

function mergeResolutionOption(
  conflictId: string,
  kind: VersionApplyMergeResolution['kind'],
  value: string,
) {
  return {
    optionId: `option:${kind}`,
    conflictId,
    kind,
    value: { kind: 'value' as const, value },
    recalcRequired: true,
  };
}

function directMergeInput(input: VersionMergeInput | Parameters<WorkbookVersion['applyMerge']>[0]) {
  if ('base' in input) return input;

  return {
    base: PARENT_COMMIT_ID,
    ours: HEAD_COMMIT_ID,
    theirs: LATEST_COMMIT_ID,
  };
}
