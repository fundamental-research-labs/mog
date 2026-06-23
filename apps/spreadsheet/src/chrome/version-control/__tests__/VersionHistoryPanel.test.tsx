import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionCapabilityState,
  VersionRecordRevision,
  VersionResult,
  VersionSemanticDiffPage,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const REF_REVISION: VersionRecordRevision = { kind: 'counter', value: '1' };
const ALL_CAPABILITIES: readonly VersionCapability[] = [
  'version:read', 'version:diff', 'version:commit', 'version:branch', 'version:checkout',
  'version:reviewRead', 'version:reviewWrite', 'version:proposal', 'version:mergePreview',
  'version:mergeApply', 'version:revert', 'version:provenance', 'version:remotePromote',
];

describe('VersionHistoryPanelContent', () => {
  it('loads version status, head, and recent commits, then refreshes through wb.version', async () => {
    const workbook = createWorkbook();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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

  it('announces refresh loading while preserving existing version history content', async () => {
    const refreshSurface = createDeferred<VersionSurfaceStatus>();
    let surfaceReadCount = 0;
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () => {
        surfaceReadCount += 1;
        return surfaceReadCount === 1 ? createSurfaceStatus() : refreshSurface.promise;
      }),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    expect(await screen.findByText('Calculated forecast')).toBeInTheDocument();
    await user.click(screen.getByTestId('panel-version-history-refresh'));

    const refreshStatus = screen.getByTestId('version-history-loading-status');
    expect(refreshStatus).toHaveAttribute('role', 'status');
    expect(refreshStatus).toHaveAttribute('aria-live', 'polite');
    expect(refreshStatus).toHaveAttribute('aria-atomic', 'true');
    expect(refreshStatus).toHaveTextContent('Refreshing version history');
    expect(screen.getByText('Calculated forecast')).toBeInTheDocument();

    refreshSurface.resolve(createSurfaceStatus());
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

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    expect(await screen.findByText('Initial import')).toBeInTheDocument();
    expect(screen.getByText('Graph not initialized.')).toBeInTheDocument();
  });

  it('calls the close handler from the panel close affordance', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={createWorkbook()} onClose={onClose} />);

    await screen.findByText('Initial import');
    await user.click(screen.getByTestId('panel-version-history-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus into the panel on mount', async () => {
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={createWorkbook()} onClose={jest.fn()} />);

    const closeButton = screen.getByTestId('panel-version-history-close');
    await waitFor(() => expect(closeButton).toHaveFocus());
    await screen.findByText('Calculated forecast');

    await user.tab();

    expect(screen.getByTestId('version-history-commit-message-input')).toHaveFocus();
  });

  it('exposes stable G4 selectors for real-input controls and visible disabled reasons', async () => {
    render(<VersionHistoryPanelContent workbook={createWorkbook()} onClose={jest.fn()} />);

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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    expect(screen.getByText('version:branch is not available.')).toBeVisible();
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
    const user = userEvent.setup();
    const reason = 'Versioning is disabled for this workbook.';

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toBeVisible();
    expect(staleStatus).toHaveTextContent('Current checkout is stale');
    expect(staleStatus).toHaveTextContent('main is stale because the branch head moved.');
    expect(staleStatus).not.toHaveTextContent(shortCommitId(HEAD_COMMIT_ID));
    expect(staleStatus).not.toHaveTextContent(shortCommitId(LATEST_COMMIT_ID));

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

  it('validates branch names client-side against public refs and existing branches', async () => {
    const workbook = createWorkbook();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    const branchInput = screen.getByTestId('version-history-branch-name-input');
    const createBranchButton = screen.getByTestId('version-history-create-branch-button');

    await user.type(branchInput, 'main');
    expectDisabledButtonReason(
      createBranchButton,
      'main is protected and cannot be created from the version panel.',
    );
    await user.click(createBranchButton);
    expect(workbook.version.createBranch).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'refs/tags/review');
    expectDisabledButtonReason(createBranchButton, 'Branch refs must use refs/heads/<branch>.');
    await user.click(createBranchButton);
    expect(workbook.version.createBranch).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'scenario/budget');
    expectDisabledButtonReason(createBranchButton, 'Branch scenario/budget already exists.');
    await user.click(createBranchButton);
    expect(workbook.version.createBranch).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'refs/heads/review/version-panel');
    expect(createBranchButton).toBeEnabled();
    await user.click(createBranchButton);
    await waitFor(() =>
      expect(workbook.version.createBranch).toHaveBeenCalledWith({
        name: 'refs/heads/review/version-panel',
        targetCommitId: HEAD_COMMIT_ID,
        expectedAbsent: true,
      }),
    );
    await expectActionResult('Created review/version-panel', 'success');
  });

  it('announces running and successful action states through a status live region', async () => {
    const commitResult =
      createDeferred<Awaited<ReturnType<VersionHistoryWorkbook['version']['commit']>>>();
    const workbook = createWorkbook({
      commit: jest.fn(async () => commitResult.promise),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Checkpoint');
    await user.click(screen.getByTestId('version-history-commit-button'));

    const runningStatus = within(
      await screen.findByTestId('version-history-action-result'),
    ).getByRole('status');
    expect(runningStatus).toHaveAttribute('aria-live', 'polite');
    expect(runningStatus).toHaveAttribute('aria-atomic', 'true');
    expect(runningStatus).toHaveAttribute('aria-busy', 'true');
    expect(runningStatus).toHaveTextContent('Committing changes');

    commitResult.resolve({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        parents: [PARENT_COMMIT_ID],
        createdAt: '2026-06-22T10:15:00.000Z',
        author: { redacted: false, displayName: 'Reviewer' },
        annotation: { title: { kind: 'text', value: 'Snapshot before review' } },
      },
    });
    await expectActionResult('Committed changes', 'success');
    expect(
      within(screen.getByTestId('version-history-action-result')).getByRole('status'),
    ).toHaveTextContent('Committed changes');
  });

  it('calls commit, createBranch, checkout, and parent diff through workbook.version', async () => {
    const workbook = createWorkbook();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    await user.type(
      screen.getByTestId('version-history-commit-message-input'),
      'Snapshot before review',
    );
    await user.click(screen.getByTestId('version-history-commit-button'));
    await waitFor(() =>
      expect(workbook.version.commit).toHaveBeenCalledWith({
        message: 'Snapshot before review',
        expectedHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
        },
      }),
    );
    await expectActionResult('Committed changes', 'success');
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId(branchTargetTestId(PARENT_COMMIT_ID)));
    expect(screen.getByTestId('version-history-branch-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      PARENT_COMMIT_ID,
    );
    await user.type(
      screen.getByTestId('version-history-branch-name-input'),
      'review/version-panel',
    );
    await user.click(screen.getByTestId('version-history-create-branch-button'));
    await waitFor(() =>
      expect(workbook.version.createBranch).toHaveBeenCalledWith({
        name: 'refs/heads/review/version-panel',
        targetCommitId: PARENT_COMMIT_ID,
        expectedAbsent: true,
      }),
    );
    await expectActionResult('Created review/version-panel', 'success');
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(3));

    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/scenario/budget')));
    await waitFor(() =>
      expect(workbook.version.checkout).toHaveBeenCalledWith(
        {
          kind: 'ref',
          name: 'refs/heads/scenario/budget',
        },
        { includeDiagnostics: true },
      ),
    );
    await expectActionResult('Checked out scenario/budget', 'success');
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(4));

    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    await waitFor(() =>
      expect(workbook.version.diff).toHaveBeenCalledWith(PARENT_COMMIT_ID, HEAD_COMMIT_ID, {
        pageSize: 50,
        includeDiagnostics: true,
      }),
    );
    await expectActionResult('Loaded parent diff', 'success');
    const parentDiff = await screen.findByTestId('version-history-parent-diff');
    expect(parentDiff).toHaveTextContent('cells value');
    const diffStatus = within(parentDiff).getByRole('status');
    expect(diffStatus).toHaveAttribute('aria-live', 'polite');
    expect(diffStatus).toHaveAttribute('aria-atomic', 'true');
    expect(diffStatus).toHaveTextContent(
      `Parent Diff Base ${shortCommitId(PARENT_COMMIT_ID)} Target ${shortCommitId(
        HEAD_COMMIT_ID,
      )} State Changes. Change count 1`,
    );
  });

  it.each([
    ['empty', semanticDiffPage([]), 'empty', 'Diff returned no entries', 'Empty preview'],
    ['unsupported', semanticDiffPage([diffEntry({ diagnostics: [diffDiagnostic('unsupportedDomain', 'unsupported')] })]), 'unsupported', 'Unsupported semantic state', 'Unsupported state'],
    ['stale', semanticDiffPage([diffEntry({ diagnostics: [diffDiagnostic('VERSION_REF_CONFLICT', 'retry')] })]), 'stale', 'Stale diff reference', 'Stale reference'],
    ['conflict-only', semanticDiffPage([diffEntry({ changeId: 'merge-conflict:sha256:1' })]), 'conflict-only', 'Conflicts only', 'Conflicts only'],
  ])('renders a distinct %s parent diff preview state', async (_, page, state, title, label) => {
    const workbook = createWorkbook({ diff: jest.fn(async () => ({ ok: true, value: page })) });
    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);
    await screen.findByText('Calculated forecast');
    await userEvent.setup().click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    const parentDiff = await screen.findByTestId('version-history-parent-diff');
    expect(parentDiff).toHaveAttribute('data-state', state);
    expect(parentDiff).toHaveTextContent(title);
    expect(within(parentDiff).getByRole('status')).toHaveTextContent(`State ${label}`);
    expect(parentDiff).not.toHaveTextContent('No semantic changes');
  });

  it('surfaces commit, branch, checkout, and parent diff errors in the action result region', async () => {
    const workbook = createWorkbook({
      commit: jest.fn(async () => failedInvalidState('Commit rejected by version provider.')),
      createBranch: jest.fn(async () =>
        failedInvalidBranchName(
          'refs/heads/review/provider-rejected',
          'Branch rejected by version provider.',
        ),
      ),
      checkout: jest.fn(async () => failedInvalidState('Checkout rejected by version provider.')),
      diff: jest.fn(async () => failedNotFound('version diff', 'Diff target is unavailable.')),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Rejected commit');
    await user.click(screen.getByTestId('version-history-commit-button'));
    await expectActionResult('Commit rejected by version provider.', 'error');

    await user.type(
      screen.getByTestId('version-history-branch-name-input'),
      'review/provider-rejected',
    );
    await user.click(screen.getByTestId('version-history-create-branch-button'));
    await expectActionResult('Branch rejected by version provider.', 'error');

    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/scenario/budget')));
    await expectActionResult('Checkout rejected by version provider.', 'error');

    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    await expectActionResult('Diff target is unavailable.', 'error');
  });
});

function createWorkbook(
  overrides: Partial<VersionHistoryWorkbook['version']> = {},
): VersionHistoryWorkbook {
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
    ...overrides,
  };
  return { version } as unknown as VersionHistoryWorkbook;
}

function semanticDiffPage(items: VersionSemanticDiffPage['items']): VersionSemanticDiffPage {
  return { items, limit: 50, readRevision: { kind: 'counter', value: '4' }, order: 'semantic-change-order' };
}

function diffEntry({
  changeId = 'change-1',
  diagnostics,
}: {
  readonly changeId?: string;
  readonly diagnostics?: VersionSemanticDiffPage['items'][number]['diagnostics'];
} = {}): VersionSemanticDiffPage['items'][number] {
  return {
    structural: { kind: 'metadata', changeId, domain: 'cells', entityId: 'sheet-1!A1', propertyPath: ['value'] },
    before: { kind: 'value', value: { kind: 'blank' } },
    after: { kind: 'value', value: '42' },
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function diffDiagnostic(issueCode: string, recoverability: 'retry' | 'unsupported') {
  return { issueCode, severity: 'warning' as const, recoverability, messageTemplateId: `version.diff.${issueCode}`, safeMessage: issueCode, redacted: true };
}

function createSurfaceStatus({
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

function hostDeniedCapabilityState(capability: VersionCapability): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'hostCapability',
    reason: `Host policy denies ${capability}.`,
    retryable: false,
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
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

function expectReasonById(id: string, reason: string): void {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing disabled reason ${id}`);
  expect(element).toHaveTextContent(reason);
  expect(element).toBeVisible();
}

function expectDisabledButtonReason(button: HTMLElement, reason: string): void {
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  expect(screen.getAllByText(reason)[0]).toBeVisible();
}

function failedInvalidState<T = never>(reason: string): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'invalid_state', state: 'blocked', allowed: [], reason },
  };
}

function failedInvalidBranchName<T = never>(branchName: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_branch_name', branchName, reason } };
}

function failedNotFound<T = never>(target: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'not_found', target, reason } };
}

function branchTargetTestId(commitId: string): string {
  return `version-history-branch-target-${safeDomId(commitId)}`;
}

function checkoutBranchTestId(refName: string): string {
  return `version-history-checkout-branch-${safeDomId(refName)}`;
}

function parentDiffButtonTestId(commitId: string): string {
  return `version-history-parent-diff-button-${safeDomId(commitId)}`;
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function shortCommitId(id: string): string {
  return id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12);
}
