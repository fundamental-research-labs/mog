import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionRecordRevision,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const PROMOTED_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'e'.repeat(64)}` as WorkbookCommitId;
const PENDING_REMOTE_SEGMENT_ID = `pending-remote-segment:sha256:${'d'.repeat(64)}` as const;
const REF_REVISION: VersionRecordRevision = { kind: 'counter', value: '1' };
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

describe('VersionHistoryPanelContent pending remote promotion', () => {
  it('shows pending remote backlog status and promotes it through workbook.version', async () => {
    const pendingProviderWrites = diagnostic(
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      { pendingRemoteSegmentCount: 1 },
    );
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [pendingProviderWrites],
          diagnostics: [pendingProviderWrites],
        },
      }),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const remoteStatus = screen.getByTestId('version-history-remote-promote-status');
    expect(remoteStatus).toHaveAttribute('data-state', 'pending');
    expect(remoteStatus).toHaveTextContent('Remote backlog');
    expect(remoteStatus).toHaveTextContent('Pending');
    expect(remoteStatus).toHaveTextContent(pendingProviderWrites.message);
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      pendingProviderWrites.message,
    );

    await user.click(screen.getByTestId('version-history-promote-remote-button'));

    await waitFor(() =>
      expect(workbook.version.promotePendingRemote).toHaveBeenCalledWith({
        includeDiagnostics: true,
      }),
    );
    await expectActionResult('Promoted 1 pending remote segment into 1 commit', 'success');
  });

  it('projects stale current status through stable redacted codes', async () => {
    const rawProviderRef = 'refs/provider-internal/main';
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        current: {
          branchName: rawProviderRef,
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_COMMIT_ID,
          stale: true,
          staleReason: 'refMoved',
        },
      }),
    });

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-status-code',
      'version.surfaceStatus.currentStale.refMoved',
    );
    expect(staleStatus).not.toHaveAttribute('data-checked-out-commit-id');
    expect(staleStatus).not.toHaveAttribute('data-latest-commit-id');
    expect(staleStatus).toHaveTextContent('Current checkout is stale');
    expect(staleStatus).toHaveTextContent(
      'Current checkout is stale because the branch head moved.',
    );
    expect(staleStatus).toHaveTextContent('version.surfaceStatus.currentStale.refMoved');
    expect(staleStatus).not.toHaveTextContent(rawProviderRef);
    expect(staleStatus).not.toHaveTextContent(HEAD_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent(LATEST_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent('aaaaaaaaaaaa');
    expect(staleStatus).not.toHaveTextContent('eeeeeeeeeeee');
  });

  it('projects stale pending remote reconciliation through stable redacted codes', async () => {
    const rawProviderRef = 'refs/provider-internal/sync/main';
    const pendingPromotion = diagnostic('Remote promotion is pending.', {
      pendingRemotePromotionActiveCount: 1,
      providerRef: rawProviderRef,
      providerKind: 'provider-yjs',
    });
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        current: {
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_COMMIT_ID,
          stale: true,
          staleReason: 'activeSessionBehind',
        },
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [pendingPromotion],
          diagnostics: [pendingPromotion],
        },
      }),
    });

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-status-code',
      'version.surfaceStatus.currentStale.activeSessionBehind',
    );
    expect(staleStatus).toHaveAttribute(
      'data-reconciliation-code',
      'version.surfaceStatus.pendingRemotePromotion',
    );
    expect(staleStatus).toHaveTextContent(
      'version.surfaceStatus.currentStale.activeSessionBehind',
    );
    expect(staleStatus).toHaveTextContent('version.surfaceStatus.pendingRemotePromotion');
    expect(staleStatus).not.toHaveTextContent(rawProviderRef);
    expect(staleStatus).not.toHaveTextContent('provider-yjs');
  });

  it('shows remote promote disabled reason from the surface capability', async () => {
    const reason = 'Host policy denies version:remotePromote.';
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        capabilityOverrides: {
          'version:remotePromote': disabledCapabilityState(reason, 'hostCapability', false),
        },
      }),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const promoteButton = screen.getByRole('button', { name: 'Promote remote' });
    expectDisabledButtonReason(promoteButton, reason);
    expect(screen.getByTestId('version-history-remote-promote-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(screen.getByTestId('version-history-capability-version-remotePromote')).toHaveAccessibleName(
      `Remote promote unavailable: ${reason}`,
    );

    await user.click(promoteButton);
    expect(workbook.version.promotePendingRemote).not.toHaveBeenCalled();
  });

  it('fails closed while refreshing capability status after remote promotion', async () => {
    const pendingProviderWrites = diagnostic(
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      { pendingRemoteSegmentCount: 1 },
    );
    const refreshedReason = 'Remote promotion is disabled until the provider reconnects.';
    const refreshedSurface = createDeferred<VersionSurfaceStatus>();
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(
        createSurfaceStatus({
          dirty: {
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [pendingProviderWrites],
            diagnostics: [pendingProviderWrites],
          },
        }),
      )
      .mockImplementationOnce(() => refreshedSurface.promise);
    const workbook = createWorkbook({ getSurfaceStatus });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByRole('button', { name: 'Promote remote' }));

    await waitFor(() =>
      expect(workbook.version.promotePendingRemote).toHaveBeenCalledWith({
        includeDiagnostics: true,
      }),
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Promote remote' }),
      'Version status is refreshing.',
    );

    await act(async () => {
      refreshedSurface.resolve(
        createSurfaceStatus({
          capabilityOverrides: {
            'version:remotePromote': disabledCapabilityState(
              refreshedReason,
              'hostCapability',
              true,
            ),
          },
        }),
      );
      await refreshedSurface.promise;
    });

    await waitFor(() =>
      expect(screen.getByTestId('version-history-remote-promote-status')).toHaveAttribute(
        'data-state',
        'unavailable',
      ),
    );
    expect(screen.getByTestId('version-history-remote-promote-status')).toHaveTextContent(
      refreshedReason,
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Promote remote' }),
      refreshedReason,
    );
    expect(
      screen.getByTestId('version-history-capability-version-remotePromote'),
    ).toHaveAccessibleName(`Remote promote unavailable: ${refreshedReason}`);
  });

  it('keeps destructive controls disabled while remote promotion is in flight', async () => {
    const pendingProviderWrites = diagnostic(
      'Remote sync changes are waiting to be promoted into version history; checkout is unsafe.',
      { pendingRemoteSegmentCount: 1 },
    );
    const promotion = createDeferred<
      Awaited<ReturnType<VersionHistoryWorkbook['version']['promotePendingRemote']>>
    >();
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [pendingProviderWrites],
          diagnostics: [pendingProviderWrites],
        },
      }),
      promotePendingRemote: jest.fn(() => promotion.promise),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    await user.type(screen.getByLabelText('Branch name'), 'scenario/frozen');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByTestId('version-history-promote-remote-button'));

    await waitFor(() =>
      expect(workbook.version.promotePendingRemote).toHaveBeenCalledWith({
        includeDiagnostics: true,
      }),
    );

    const runningReason = 'Wait for the current version action to finish.';
    expectDisabledButtonReason(screen.getByRole('button', { name: /^Commit$/ }), runningReason);
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Create branch' }),
      runningReason,
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      runningReason,
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      runningReason,
    );

    await act(async () => {
      promotion.resolve({
        ok: true,
        value: {
          status: 'success',
          promotedSegmentIds: [PENDING_REMOTE_SEGMENT_ID],
          commitIds: [PROMOTED_COMMIT_ID],
          skipped: [],
          diagnostics: [],
        },
      });
      await promotion.promise;
    });
    await expectActionResult('Promoted 1 pending remote segment into 1 commit', 'success');
  });

  it('surfaces failed pending remote promotion diagnostics in the action result region', async () => {
    const workbook = createWorkbook({
      promotePendingRemote: jest.fn(async () => ({
        ok: true,
        value: {
          status: 'failed',
          promotedSegmentIds: [],
          commitIds: [],
          skipped: [
            {
              segmentId: PENDING_REMOTE_SEGMENT_ID,
              reason: 'batch-status-terminal',
              message: 'The pending remote sync batch failed before promotion.',
            },
          ],
          diagnostics: [
            {
              code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
              severity: 'warning',
              message: 'Pending remote promotion is blocked by a failed sync batch.',
            },
          ],
        },
      })),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId('version-history-promote-remote-button'));

    await expectActionResult('Pending remote promotion is blocked by a failed sync batch.', 'error');
  });
});

function createWorkbook({
  surface = createSurfaceStatus(),
  getSurfaceStatus,
  promotePendingRemote,
}: {
  readonly surface?: VersionSurfaceStatus;
  readonly getSurfaceStatus?: VersionHistoryWorkbook['version']['getSurfaceStatus'];
  readonly promotePendingRemote?: VersionHistoryWorkbook['version']['promotePendingRemote'];
} = {}): VersionHistoryWorkbook {
  const version = {
    getSurfaceStatus: getSurfaceStatus ?? jest.fn(async () => surface),
    getStatus: jest.fn(async () => ({ schemaVersion: 1, rolloutStage: 'headless-local' })),
    getHead: jest.fn(async () => ({
      ok: true,
      value: { id: HEAD_COMMIT_ID, refName: 'refs/heads/main', refRevision: REF_REVISION },
    })),
    listCommits: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          commit(HEAD_COMMIT_ID, [PARENT_COMMIT_ID], 'Calculated forecast'),
          commit(PARENT_COMMIT_ID, [], 'Initial import'),
        ],
        limit: 20,
      },
    })),
    listRefs: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          { name: 'refs/heads/main', commitId: HEAD_COMMIT_ID, revision: REF_REVISION },
          {
            name: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            revision: { kind: 'counter', value: '2' },
          },
        ],
        limit: 2,
      },
    })),
    listReviews: jest.fn(async () => ({ ok: true, value: { items: [], limit: 5 } })),
    listProposals: jest.fn(async () => ({ ok: true, value: { items: [], limit: 5 } })),
    commit: jest.fn(),
    createBranch: jest.fn(),
    checkout: jest.fn(),
    diff: jest.fn(),
    revert: jest.fn(),
    promotePendingRemote:
      promotePendingRemote ??
      jest.fn(async () => ({
        ok: true,
        value: {
          status: 'success',
          promotedSegmentIds: [PENDING_REMOTE_SEGMENT_ID],
          commitIds: [PROMOTED_COMMIT_ID],
          skipped: [],
          diagnostics: [],
        },
      })),
  };
  return { version } as unknown as VersionHistoryWorkbook;
}

function createSurfaceStatus({
  current = {},
  dirty = {},
  capabilityOverrides = {},
}: {
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled: true,
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
      ALL_CAPABILITIES.map((capability) => [
        capability,
        capabilityOverrides[capability] ?? ({ enabled: true } satisfies VersionCapabilityState),
      ]),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

function commit(id: WorkbookCommitId, parents: WorkbookCommitId[], title: string) {
  return {
    id,
    parents,
    createdAt: '2026-06-22T10:10:00.000Z',
    author: { redacted: false, displayName: 'Reviewer' },
    annotation: { title: { kind: 'text', value: title } },
  };
}

function diagnostic(
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

function disabledCapabilityState(
  reason: string,
  dependency: VersionCapabilityDependency,
  retryable: boolean,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function expectActionResult(message: string, status: 'success' | 'error'): Promise<void> {
  await waitFor(() => {
    const result = screen.getByTestId('version-history-action-result');
    expect(result).toHaveAttribute('data-status', status);
    expect(result).toHaveTextContent(message);
  });
}

function expectDisabledButtonReason(button: HTMLElement, reason: string): void {
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  expect(screen.getAllByText(reason)[0]).toBeVisible();
}
