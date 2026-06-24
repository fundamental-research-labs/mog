import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import type {
  VersionCapability,
  VersionCapabilityState,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  PARENT_COMMIT_ID,
  branchTargetTestId,
  checkoutBranchTestId,
  createDeferred,
  createSurfaceStatus,
  createWorkbook,
  expectDisabledButtonReason,
  expectReasonById,
  hostDeniedCapabilityState,
  parentDiffButtonTestId,
  renderVersionHistoryPanel,
  safeDomId,
  shortCommitId,
} from './VersionHistoryPanel.test-utils';

describe('VersionHistoryPanelContent', () => {
  it('loads version status, head, and recent commits, then refreshes through wb.version', async () => {
    const workbook = createWorkbook();

    const { user } = renderVersionHistoryPanel({ workbook });

    const loadingStatus = screen.getByTestId('version-history-loading');
    expect(loadingStatus).toHaveAttribute('role', 'status');
    expect(loadingStatus).toHaveAttribute('aria-live', 'polite');
    expect(loadingStatus).toHaveAttribute('aria-atomic', 'true');
    expect(loadingStatus).toHaveTextContent('Loading version history');

    expect(await screen.findByText('Initial import')).toBeInTheDocument();
    expect(screen.getByText('Calculated forecast')).toBeInTheDocument();
    expect(screen.getByText('scenario/budget')).toBeInTheDocument();
    expect(screen.getByText('authoring')).toBeInTheDocument();
    expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getHead).toHaveBeenCalledTimes(1);
    expect(workbook.version.listCommits).toHaveBeenCalledWith({
      pageSize: 20,
      includeDiagnostics: true,
    });
    expect(workbook.version.listRefs).toHaveBeenCalledWith({ includeDiagnostics: true });
    expect(screen.getByTestId(parentDiffButtonTestId(PARENT_COMMIT_ID))).toBeDisabled();

    await user.click(screen.getByTestId('panel-version-history-refresh'));
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));
  });

  it('queues manual refresh while preserving existing version history content', async () => {
    const firstRefreshSurface = createDeferred<VersionSurfaceStatus>();
    const secondRefreshSurface = createDeferred<VersionSurfaceStatus>();
    const dirtySurface = createSurfaceStatus({
      dirty: { hasUncommittedLocalChanges: true, checkoutSafe: false },
    });
    let surfaceReadCount = 0;
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () => {
        surfaceReadCount += 1;
        if (surfaceReadCount === 1) return dirtySurface;
        if (surfaceReadCount === 2) return firstRefreshSurface.promise;
        if (surfaceReadCount === 3) return secondRefreshSurface.promise;
        return dirtySurface;
      }),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    expect(await screen.findByText('Calculated forecast')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    expect(screen.getByTestId('version-history-commit-button')).toBeEnabled();
    await user.click(screen.getByTestId('panel-version-history-refresh'));

    const refreshStatus = screen.getByTestId('version-history-loading-status');
    expect(refreshStatus).toHaveAttribute('role', 'status');
    expect(refreshStatus).toHaveAttribute('aria-live', 'polite');
    expect(refreshStatus).toHaveAttribute('aria-atomic', 'true');
    expect(refreshStatus).toHaveTextContent('Refreshing version history');
    expect(screen.getByText('Calculated forecast')).toBeInTheDocument();
    expect(screen.getByTestId('version-history-commit-button')).toBeEnabled();

    const refreshButton = screen.getByTestId('panel-version-history-refresh');
    expect(refreshButton).toBeEnabled();
    expect(refreshButton).toHaveAttribute('aria-busy', 'true');

    await user.click(refreshButton);
    expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2);

    firstRefreshSurface.resolve(createSurfaceStatus());
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(3));

    secondRefreshSurface.resolve(createSurfaceStatus());
    await waitFor(() =>
      expect(screen.queryByTestId('version-history-loading-status')).not.toBeInTheDocument(),
    );
  });

  it('shows partial version diagnostics without dropping available commit history', async () => {
    const workbook = createWorkbook({
      getHead: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getHead',
          diagnostics: [
            {
              code: 'VERSION_GRAPH_UNINITIALIZED',
              severity: 'warning',
              message: 'Graph not initialized.',
            },
          ],
        },
      })),
    });

    renderVersionHistoryPanel({ workbook });

    expect(await screen.findByText('Initial import')).toBeInTheDocument();
    expect(screen.getByText('Graph not initialized.')).toBeInTheDocument();
  });

  it('calls the close handler from the panel close affordance', async () => {
    const onClose = jest.fn();

    const { user } = renderVersionHistoryPanel({ onClose });

    await screen.findByText('Initial import');
    await user.click(screen.getByTestId('panel-version-history-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus into the panel on mount', async () => {
    const { user } = renderVersionHistoryPanel();

    const closeButton = screen.getByTestId('panel-version-history-close');
    await waitFor(() => expect(closeButton).toHaveFocus());
    await screen.findByText('Calculated forecast');

    await user.tab();

    expect(screen.getByTestId('version-history-commit-message-input')).toHaveFocus();
  });

  it('exposes stable G4 selectors for real-input controls and visible disabled reasons', async () => {
    renderVersionHistoryPanel();

    await screen.findByText('Calculated forecast');

    expect(screen.getByTestId('version-history-commit-message-input')).toHaveAccessibleName(
      'Commit message',
    );
    expect(screen.getByTestId('version-history-commit-button')).toBeDisabled();
    expectReasonById('version-commit-disabled-reason', 'Enter a commit message.');

    expect(screen.getByTestId('version-history-branch-name-input')).toHaveAccessibleName(
      'Branch name',
    );
    expect(screen.getByTestId('version-history-branch-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      HEAD_COMMIT_ID,
    );
    expect(screen.getByTestId('version-history-create-branch-button')).toBeDisabled();
    expectReasonById('version-branch-disabled-reason', 'Enter a branch name.');

    expect(screen.getByTestId(branchTargetTestId(HEAD_COMMIT_ID))).toHaveAccessibleName(
      `Use ${shortCommitId(HEAD_COMMIT_ID)} as branch target`,
    );
    expect(screen.getAllByText('Target')[0]).toBeVisible();
    expect(
      screen.getByTestId(checkoutBranchTestId('refs/heads/scenario/budget')),
    ).toHaveAccessibleName('Checkout scenario/budget');

    const parentDiffButton = screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID));
    expect(parentDiffButton).toHaveAccessibleName(
      `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
    );
    expect(screen.getByTestId(parentDiffButtonTestId(PARENT_COMMIT_ID))).toBeDisabled();
    expectReasonById(
      `version-diff-disabled-${safeDomId(PARENT_COMMIT_ID)}`,
      'Root commits do not have a parent diff.',
    );
    expect(screen.getByTestId('version-history-capability-version-read')).toHaveAccessibleName(
      'Read enabled',
    );
    expect(
      screen.getByTestId('version-history-capability-version-remotePromote'),
    ).toHaveAccessibleName('Remote promote enabled');
    expect(screen.getByTestId('version-history-remote-promote-status')).toHaveAttribute(
      'data-state',
      'ready',
    );
    expect(screen.getByTestId('version-history-promote-remote-button')).toBeEnabled();
  });

  it('renders one summary row for every capability in the surface contract', async () => {
    const surface = createSurfaceStatus();
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () => surface),
    });

    renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    const summary = screen.getByRole('region', { name: 'Version capabilities' });
    const renderedIds = Array.from(
      summary.querySelectorAll<HTMLElement>('[data-testid^="version-history-capability-"]'),
      (row) => {
        const id = row.getAttribute('data-testid');
        if (!id) throw new Error('Capability summary row is missing data-testid.');
        return id;
      },
    );
    const expectedIds = Object.keys(surface.capabilities).map(
      (capability) => `version-history-capability-${safeDomId(capability)}`,
    );

    expect(renderedIds).toEqual(expectedIds);
  });

  it('keeps commit, branch, checkout, and diff controls disabled when capabilities are unavailable', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          disabledCapabilities: [
            'version:commit',
            'version:branch',
            'version:checkout',
            'version:diff',
          ],
        }),
      ),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    await user.type(screen.getByLabelText('Branch name'), 'review/version-panel');

    const commitButton = screen.getByRole('button', { name: /^Commit$/ });
    const branchButton = screen.getByRole('button', { name: 'Create branch' });
    const checkoutButton = screen.getByRole('button', { name: 'Checkout scenario/budget' });
    const diffButton = screen.getByRole('button', {
      name: `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
    });

    expect(commitButton).toBeDisabled();
    expect(commitButton).toHaveAccessibleDescription('version:commit is not available.');
    expect(screen.getByText('version:commit is not available.')).toBeVisible();
    expect(branchButton).toBeDisabled();
    expect(branchButton).toHaveAccessibleDescription('version:branch is not available.');
    expect(screen.getAllByText('version:branch is not available.')[0]).toBeVisible();
    expect(checkoutButton).toBeDisabled();
    expect(checkoutButton).toHaveAccessibleDescription('version:checkout is not available.');
    expect(screen.getByText('version:checkout is not available.')).toBeVisible();
    expect(diffButton).toBeDisabled();
    expect(diffButton).toHaveAccessibleDescription('version:diff is not available.');
    expect(screen.getByTestId('version-diff-unavailable-reason')).toHaveTextContent(
      'version:diff is not available.',
    );
    expect(screen.getByTestId('version-history-capability-version-diff')).toHaveAccessibleName(
      'Diff unavailable: version:diff is not available.',
    );
    expect(screen.getByTestId('version-history-capability-version-diff')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
  });

  it('shows the disabled-versioning reason across commit, branch, checkout, and diff controls', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () => createSurfaceStatus({ featureGateEnabled: false })),
    });
    const reason = 'Versioning is disabled for this workbook.';

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    await user.type(screen.getByLabelText('Branch name'), 'review/version-panel');

    expectDisabledButtonReason(screen.getByRole('button', { name: /^Commit$/ }), reason);
    expectDisabledButtonReason(screen.getByRole('button', { name: 'Create branch' }), reason);
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      reason,
    );
    expectDisabledButtonReason(
      screen.getByRole('button', {
        name: `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
      }),
      reason,
    );
  });

  it('shows capability-denied reasons across commit, branch, checkout, and diff controls', async () => {
    const deniedCapabilities = [
      'version:commit',
      'version:branch',
      'version:checkout',
      'version:diff',
    ] as const;
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          capabilityOverrides: Object.fromEntries(
            deniedCapabilities.map((capability) => [
              capability,
              hostDeniedCapabilityState(capability),
            ]),
          ) as Partial<Record<VersionCapability, VersionCapabilityState>>,
        }),
      ),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    await user.type(screen.getByLabelText('Branch name'), 'review/version-panel');

    expectDisabledButtonReason(
      screen.getByRole('button', { name: /^Commit$/ }),
      'Host policy denies version:commit.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Create branch' }),
      'Host policy denies version:branch.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      'Host policy denies version:checkout.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', {
        name: `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
      }),
      'Host policy denies version:diff.',
    );
  });

  it('shows provider-write disabled reasons for commit and checkout controls', async () => {
    const providerWriteReason = {
      code: 'version.surfaceStatus.pendingProviderWrites',
      severity: 'warning' as const,
      message: 'Version provider writes are in flight; checkout is unsafe until they settle.',
    };
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          dirty: {
            hasUncommittedLocalChanges: true,
            commitEligibleChanges: true,
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [providerWriteReason],
            diagnostics: [providerWriteReason],
          },
        }),
      ),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');

    expectDisabledButtonReason(
      screen.getByRole('button', { name: /^Commit$/ }),
      'Wait for provider writes to settle before committing.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      providerWriteReason.message,
    );
  });

  it('shows dirty-domain disabled reasons for commit and checkout controls', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          dirty: {
            hasUncommittedLocalChanges: true,
            commitEligibleChanges: false,
            unsupportedDirtyDomains: ['charts', 'pivotTables'],
            checkoutSafe: false,
            unsafeReasons: [
              {
                code: 'version.surfaceStatus.dirtyWorkingState',
                severity: 'warning',
                message: 'Workbook has uncommitted local changes; checkout would discard them.',
              },
            ],
          },
        }),
      ),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');

    expectDisabledButtonReason(
      screen.getByRole('button', { name: /^Commit$/ }),
      'Changes in charts, pivotTables cannot be committed yet.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      'Commit or discard changes in charts, pivotTables before checking out.',
    );
  });

  it('shows dirty checkout, stale commit, and parentless diff disabled reasons', async () => {
    const checkoutUnsafeReason = {
      code: 'version.surfaceStatus.dirtyWorkingState',
      severity: 'warning' as const,
      message: 'Workbook has uncommitted local changes; checkout would discard them.',
    };
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          current: { stale: true, staleReason: 'refMoved' },
          dirty: {
            hasUncommittedLocalChanges: true,
            checkoutSafe: false,
            unsafeReasons: [checkoutUnsafeReason],
            diagnostics: [checkoutUnsafeReason],
          },
        }),
      ),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');

    const commitButton = screen.getByRole('button', { name: /^Commit$/ });
    const checkoutButton = screen.getByRole('button', { name: 'Checkout scenario/budget' });
    const rootDiffButton = screen.getByRole('button', {
      name: `Diff ${shortCommitId(PARENT_COMMIT_ID)} against parent`,
    });

    expect(commitButton).toBeDisabled();
    expect(commitButton).toHaveAccessibleDescription(
      'main is stale because the branch head moved. Refresh before committing.',
    );
    expect(
      screen.getByText('main is stale because the branch head moved. Refresh before committing.'),
    ).toBeVisible();
    expect(checkoutButton).toBeDisabled();
    expect(checkoutButton).toHaveAccessibleDescription(
      'main is stale because the branch head moved. Checkout is blocked until the active checkout session is refreshed.',
    );
    expect(rootDiffButton).toBeDisabled();
    expect(rootDiffButton).toHaveAccessibleDescription('Root commits do not have a parent diff.');
    expect(screen.getByText('Root commits do not have a parent diff.')).toBeVisible();
  });

  it('shows stale current status and disables checkout for a clean stale session', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          current: {
            branchName: 'main',
            checkedOutCommitId: HEAD_COMMIT_ID,
            refHeadAtMaterialization: HEAD_COMMIT_ID,
            currentRefHeadId: LATEST_COMMIT_ID,
            stale: true,
            staleReason: 'refMoved',
          },
          dirty: {
            hasUncommittedLocalChanges: false,
            commitEligibleChanges: true,
            checkoutSafe: true,
          },
        }),
      ),
      getHead: jest.fn(async () => ({
        ok: true,
        value: {
          id: LATEST_COMMIT_ID,
          refName: 'refs/heads/main',
          refRevision: { kind: 'counter', value: '9' },
        },
      })),
    });

    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toBeVisible();
    expect(staleStatus).toHaveTextContent('Current checkout is stale');
    expect(staleStatus).toHaveTextContent(
      'Checkout from main is stale because the branch head moved.',
    );
    expect(staleStatus).not.toHaveTextContent(shortCommitId(HEAD_COMMIT_ID));
    expect(staleStatus).not.toHaveTextContent(shortCommitId(LATEST_COMMIT_ID));
    expect(screen.getByTestId('version-history-branch-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      HEAD_COMMIT_ID,
    );
    expect(screen.getByTestId('version-history-rollback-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      HEAD_COMMIT_ID,
    );
    expect(screen.getByTestId('version-merge-target-head')).toHaveTextContent(
      shortCommitId(HEAD_COMMIT_ID),
    );

    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');

    expectDisabledButtonReason(
      screen.getByRole('button', { name: /^Commit$/ }),
      'main is stale because the branch head moved. Refresh before committing.',
    );
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Checkout scenario/budget' }),
      'main is stale because the branch head moved. Checkout is blocked until the active checkout session is refreshed.',
    );
  });

  it('shows restored detached checkout status without a current branch label', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          current: {
            headCommitId: undefined,
            checkedOutCommitId: PARENT_COMMIT_ID,
            branchName: 'refs/heads/main',
            detached: true,
            stale: false,
          },
        }),
      ),
      getHead: jest.fn(async () => ({
        ok: true,
        value: {
          id: LATEST_COMMIT_ID,
          refName: 'refs/heads/main',
          refRevision: { kind: 'counter', value: '9' },
        },
      })),
    });

    renderVersionHistoryPanel({ workbook });

    const statusSummary = await screen.findByRole('region', { name: 'Version status' });
    expect(statusSummary).toHaveTextContent('Detached or unavailable');
    expect(statusSummary).toHaveTextContent(shortCommitId(PARENT_COMMIT_ID));
    expect(statusSummary).not.toHaveTextContent('refs/heads/main');
    expect(statusSummary).not.toHaveTextContent('main');
    expect(screen.getByTestId('version-history-branch-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      PARENT_COMMIT_ID,
    );
  });
});
