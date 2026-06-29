import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionCapabilityState,
  VersionDiffGroup,
  VersionDiffGroupId,
  VersionDiffOverview,
  VersionMergeReview,
  VersionRecordRevision,
  VersionResult,
  VersionSemanticDiffPage,
  VersionSurfaceStatus,
  VersionWorkingTreeDiffPage,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

export type { VersionHistoryWorkbook } from '../VersionHistoryPanel';
export { shortCommitId } from '../version-history-format';

type VersionHistoryPanelUser = ReturnType<typeof userEvent.setup>;

export const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
export const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
export const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
export const REF_REVISION: VersionRecordRevision = { kind: 'counter', value: '1' };
export const DIFF_GROUP_ID = 'diff-group:cells:A1' as VersionDiffGroupId;

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

type VersionHistoryVersion = VersionHistoryWorkbook['version'];

type VersionHistoryWorkbookVersionOverrides = Partial<
  Omit<VersionHistoryVersion, 'refs' | 'reviews' | 'proposals'>
> & {
  readonly refs?: Partial<VersionHistoryVersion['refs']>;
  readonly reviews?: {
    readonly advanced?: Partial<VersionHistoryVersion['reviews']['advanced']>;
  };
  readonly proposals?: Partial<VersionHistoryVersion['proposals']>;
};

export function createWorkbook(
  overrides: VersionHistoryWorkbookVersionOverrides = {},
): VersionHistoryWorkbook {
  const {
    refs: refsOverrides,
    reviews: reviewsOverrides,
    proposals: proposalsOverrides,
    ...topLevelOverrides
  } = overrides;
  const directVersionMethods = {
    getHead: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        refName: 'refs/heads/main',
        refRevision: REF_REVISION,
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
    revert: jest.fn(async () => ({
      ok: true,
      value: {
        schemaVersion: 1,
        status: 'planned',
        target: {
          kind: 'commit',
          commitId: PARENT_COMMIT_ID,
        },
        diagnostics: [],
        mutationGuarantee: 'no-write-attempted',
      },
    })),
    diff: jest.fn(async () => ({ ok: true, value: semanticDiffPage([diffEntry()]) })),
    diffOverview: jest.fn(
      async (
        baseCommitId: Parameters<VersionHistoryVersion['diffOverview']>[0],
        targetCommitId: Parameters<VersionHistoryVersion['diffOverview']>[1],
      ) => ({
        ok: true,
        value: versionDiffOverview({
          baseCommitId: baseCommitId as WorkbookCommitId,
          targetCommitId: targetCommitId as WorkbookCommitId,
        }),
      }),
    ),
    diffGroupDetail: jest.fn(async () => ({
      ok: true,
      value: semanticDiffPage([diffEntry()]),
    })),
    diffWorkingTree: jest.fn(async () => ({
      ok: true,
      value: workingTreeDiffPage([diffEntry()]),
    })),
    previewMerge: jest.fn(async () => ({
      ok: true,
      value: createCleanMergeReview(),
    })),
  };
  const refs = {
    readRef: jest.fn(
      async (name: Parameters<VersionHistoryVersion['refs']['readRef']>[0]) => ({
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
      }),
    ),
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
            name: 'refs/heads/budget',
            commitId: PARENT_COMMIT_ID,
            revision: { kind: 'counter', value: '2' },
          },
        ],
        limit: 2,
      },
    })),
    createBranch: jest.fn(
      async (options: Parameters<VersionHistoryVersion['refs']['createBranch']>[0]) => ({
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
    ...refsOverrides,
  };
  const reviews = {
    advanced: {
      listReviews: jest.fn(async () => ({
        ok: true,
        value: {
          items: [],
          limit: 5,
        },
      })),
      ...reviewsOverrides?.advanced,
    },
  };
  const proposals = {
    list: jest.fn(async () => ({
      ok: true,
      value: {
        items: [],
        limit: 5,
      },
    })),
    ...proposalsOverrides,
  };
  const version = {
    getSurfaceStatus: jest.fn(async () => createSurfaceStatus()),
    getStatus: jest.fn(async () => ({ schemaVersion: 1, rolloutStage: 'headless-local' })),
    ...directVersionMethods,
    commitCurrent: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        parents: [PARENT_COMMIT_ID],
        createdAt: '2026-06-22T10:15:00.000Z',
        author: { redacted: false, displayName: 'Reviewer' },
        annotation: { title: { kind: 'text', value: 'Snapshot before review' } },
      },
    })),
    createBranchFromCurrent: jest.fn(async (name) => ({
      ok: true,
      value: {
        name: `refs/heads/${name}`,
        commitId: HEAD_COMMIT_ID,
        revision: { kind: 'counter', value: '3' },
      },
    })),
    checkoutBranch: jest.fn(async (name) => ({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        plan: {
          strategy: 'fullSnapshot',
          target: {
            kind: 'ref',
            refName: name === 'budget' ? 'refs/heads/budget' : `refs/heads/${name}`,
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
    checkoutCommit: jest.fn(async (commitId) => ({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        plan: {
          strategy: 'fullSnapshot',
          target: {
            kind: 'commit',
            commitId,
          },
          commitId,
          parentCommitIds: [],
          requiredDependencies: [],
          requiredDependencyCount: 0,
        },
        diagnostics: [],
        mutationGuarantee: 'no-workbook-mutation',
      },
    })),
    refs,
    reviews,
    proposals,
    ...topLevelOverrides,
  };

  return { version } as unknown as VersionHistoryWorkbook;
}

export function semanticDiffPage(
  items: VersionSemanticDiffPage['items'],
  options: { readonly nextCursor?: VersionSemanticDiffPage['nextCursor'] } = {},
): VersionSemanticDiffPage {
  return {
    items,
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
    limit: 50,
    readRevision: { kind: 'counter', value: '4' },
    order: 'semantic-change-order',
  };
}

export function workingTreeDiffPage(
  items: VersionSemanticDiffPage['items'],
  options: { readonly nextCursor?: VersionSemanticDiffPage['nextCursor'] } = {},
): VersionWorkingTreeDiffPage {
  const workingTreeDiffId = `working-tree-diff:sha256:${'d'.repeat(64)}` as VersionWorkingTreeDiffPage['workingTreeDiffId'];
  const targetRef = 'refs/heads/main' as const;
  const captureRevision = 1;
  const dirtyStatusRevision = '1';
  const checkoutPreflightToken = 'token-1';
  const baseSemanticStateDigest = {
    algorithm: 'sha256' as const,
    digest: 'base-semantic-state',
  };
  const currentSemanticStateDigest = {
    algorithm: 'sha256' as const,
    digest: 'current-semantic-state',
  };
  const overview = versionDiffOverview({
    baseCommitId: HEAD_COMMIT_ID,
    exactTotalChanges: items.length,
  });
  delete (overview as { targetCommitId?: WorkbookCommitId }).targetCommitId;
  return {
    ...semanticDiffPage(items, options),
    kind: 'workingTree',
    workingTreeDiffId,
    baseCommitId: HEAD_COMMIT_ID,
    targetRef,
    captureRevision,
    dirtyStatusRevision,
    checkoutPreflightToken,
    baseSemanticStateDigest,
    currentSemanticStateDigest,
    overview: {
      ...overview,
      kind: 'workingTree',
      workingTreeDiffId,
      targetRef,
      captureRevision,
      dirtyStatusRevision,
      checkoutPreflightToken,
      baseSemanticStateDigest,
      currentSemanticStateDigest,
    },
  };
}

export function versionDiffOverview({
  baseCommitId = PARENT_COMMIT_ID,
  targetCommitId = HEAD_COMMIT_ID,
  exactTotalChanges = 1,
  summary: summaryOverrides = {},
  groups,
}: {
  readonly baseCommitId?: WorkbookCommitId;
  readonly targetCommitId?: WorkbookCommitId;
  readonly exactTotalChanges?: number | null;
  readonly summary?: Partial<VersionDiffOverview['summary']>;
  readonly groups?: readonly VersionDiffGroup[];
} = {}): VersionDiffOverview {
  const hasExactTotalChanges = exactTotalChanges !== null;
  const groupChangeCount = hasExactTotalChanges
    ? exactTotalChanges
    : summaryOverrides.minimumChangeCount ?? 1;

  return {
    baseCommitId,
    targetCommitId,
    readRevision: { kind: 'counter', value: '4' },
    order: 'semantic-change-order',
    summary: {
      ...(hasExactTotalChanges ? { exactTotalChanges } : {}),
      countPrecision: 'exact',
      domainCounts: hasExactTotalChanges
        ? [
            {
              domain: 'cells',
              exactCount: exactTotalChanges,
              countPrecision: 'exact',
            },
          ]
        : [],
      operationCounts: hasExactTotalChanges
        ? [
            {
              operation: 'changed',
              exactCount: exactTotalChanges,
              countPrecision: 'exact',
            },
          ]
        : [],
      incomplete: false,
      diagnostics: [],
      ...summaryOverrides,
    },
    groups: {
      items:
        groups ??
        (groupChangeCount > 0
          ? [
              {
                groupId: DIFF_GROUP_ID,
                key: {
                  kind: 'cellRange',
                  sheetId: 'sheet-1',
                  domain: 'cells',
                  operation: 'changed',
                  rowStart: 1,
                  rowEnd: 1,
                  columnStart: 1,
                  columnEnd: 1,
                },
                kind: 'cellRange',
                domain: 'cells',
                sheetId: 'sheet-1',
                sheetName: { kind: 'value', value: 'Sheet1' },
                address: { kind: 'value', value: 'A1' },
                operation: 'changed',
                changeCount: groupChangeCount,
                countPrecision: 'exact',
                sampleChangeIds: ['change-1'],
                hasDetail: true,
                diagnostics: [],
              },
            ]
          : []),
      limit: 50,
    },
    unsupportedFilters: [],
    diagnostics: [],
  };
}

export function createCleanMergeReview(
  overrides: Partial<VersionMergeReview> = {},
): VersionMergeReview {
  const review = {
    schemaVersion: 1,
    status: 'clean',
    from: {
      kind: 'branch',
      name: 'budget',
      refName: 'refs/heads/budget',
      commitId: PARENT_COMMIT_ID,
    },
    into: {
      kind: 'current',
      commitId: HEAD_COMMIT_ID,
      refName: 'refs/heads/main',
      detached: false,
    },
    changes: [],
    conflicts: [],
    selectedResolutions: [],
    diagnostics: [],
    choose: jest.fn(),
    chooseAll: jest.fn(),
    save: jest.fn(),
    toApplyInput: jest.fn(),
    apply: jest.fn(async () => ({
      ok: true,
      value: {
        status: 'applied',
        commitRef: {
          id: LATEST_COMMIT_ID,
          refName: 'refs/heads/main',
          refRevision: REF_REVISION,
        },
        diagnostics: [],
      },
    })),
    ...overrides,
  } as unknown as VersionMergeReview;
  return {
    ...review,
    choose: jest.fn(() => review),
    chooseAll: jest.fn(() => review),
    ...overrides,
  } as VersionMergeReview;
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
  expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
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

export function commitRowTestId(commitId: string): string {
  return `version-history-commit-row-${safeDomId(commitId)}`;
}

export function commitMenuButtonTestId(commitId: string): string {
  return `version-history-commit-menu-button-${safeDomId(commitId)}`;
}

export function checkoutCommitTestId(commitId: string): string {
  return `version-history-checkout-commit-${safeDomId(commitId)}`;
}

export function createBranchFromCommitTestId(commitId: string): string {
  return `version-history-create-branch-from-commit-${safeDomId(commitId)}`;
}

export function commitBranchNameInputTestId(commitId: string): string {
  return `version-history-commit-branch-name-input-${safeDomId(commitId)}`;
}

export function createBranchFromCommitSubmitTestId(commitId: string): string {
  return `version-history-create-branch-from-commit-submit-${safeDomId(commitId)}`;
}

export function checkoutBranchTestId(refName: string): string {
  return `version-history-checkout-branch-${safeDomId(refName)}`;
}

export async function openCurrentBranchMenu(user: VersionHistoryPanelUser): Promise<HTMLElement> {
  const menu = screen.getByTestId('version-history-current-branch-menu');
  if (menu.getAttribute('data-state') !== 'open') {
    await user.click(screen.getByTestId('version-history-current-branch-trigger'));
    await waitFor(() => expect(menu).toHaveAttribute('data-state', 'open'));
    await screen.findByTestId('version-history-branch-name-input');
  }
  return menu;
}

export function parentDiffButtonTestId(commitId: string): string {
  return `version-history-parent-diff-button-${safeDomId(commitId)}`;
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
