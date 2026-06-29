import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { VersionDiffOverview } from '@mog-sdk/contracts/api';

import {
  DIFF_GROUP_ID,
  HEAD_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  checkoutBranchTestId,
  checkoutCommitTestId,
  commitBranchNameInputTestId,
  commitMenuButtonTestId,
  commitRowTestId,
  createDeferred,
  createBranchFromCommitSubmitTestId,
  createBranchFromCommitTestId,
  createSurfaceStatus,
  createWorkbook,
  expectActionResult,
  expectDisabledButtonReason,
  failedInvalidBranchName,
  failedInvalidState,
  failedNotFound,
  openCurrentBranchMenu,
  parentDiffButtonTestId,
  renderVersionHistoryPanel,
  shortCommitId,
  versionDiffOverview,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

type ParentDiffPreviewCase = readonly [
  label: string,
  overview: VersionDiffOverview,
  state: string,
  title: string,
  statusLabel: string,
];

const parentDiffPreviewCases: readonly ParentDiffPreviewCase[] = [
  [
    'empty',
    versionDiffOverview({ exactTotalChanges: 0 }),
    'empty',
    'No grouped changes',
    '0 changes',
  ],
  ['changes', versionDiffOverview(), 'changes', 'Changes', '1 change'],
  [
    'incomplete',
    versionDiffOverview({
      exactTotalChanges: null,
      summary: {
        minimumChangeCount: 1,
        countPrecision: 'lowerBound',
        domainCounts: [
          {
            domain: 'cells',
            minimumCount: 1,
            countPrecision: 'lowerBound',
          },
        ],
        operationCounts: [
          {
            operation: 'changed',
            minimumCount: 1,
            countPrecision: 'lowerBound',
          },
        ],
        incomplete: true,
      },
    }),
    'incomplete',
    'Incomplete',
    '1+ changes',
  ],
];

describe('VersionHistoryPanelContent action flows', () => {
  it('validates branch names client-side against public refs and existing branches', async () => {
    const workbook = createWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await openCurrentBranchMenu(user);

    const branchInput = screen.getByTestId('version-history-branch-name-input');
    const createBranchButton = screen.getByTestId('version-history-create-branch-button');

    await user.type(branchInput, 'main');
    expectDisabledButtonReason(
      createBranchButton,
      'main is protected and cannot be created from the version panel.',
    );
    await user.click(createBranchButton);
    expect(workbook.version.createBranchFromCurrent).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'refs/tags/review');
    expectDisabledButtonReason(createBranchButton, 'Enter a branch name without ref prefixes.');
    await user.click(createBranchButton);
    expect(workbook.version.createBranchFromCurrent).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'budget');
    expectDisabledButtonReason(createBranchButton, 'Branch budget already exists.');
    await user.click(createBranchButton);
    expect(workbook.version.createBranchFromCurrent).not.toHaveBeenCalled();

    await user.clear(branchInput);
    await user.type(branchInput, 'version-panel');
    expect(createBranchButton).toBeEnabled();
    await user.click(createBranchButton);
    await waitFor(() =>
      expect(workbook.version.createBranchFromCurrent).toHaveBeenCalledWith('version-panel', {
        expectedAbsent: true,
      }),
    );
    await expectActionResult('Created version-panel', 'success');
  });

  it('announces running and successful action states through a status live region', async () => {
    const commitResult =
      createDeferred<Awaited<ReturnType<VersionHistoryWorkbook['version']['commitCurrent']>>>();
    const workbook = createWorkbook({
      commitCurrent: jest.fn(async () => commitResult.promise),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

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

  it('does not announce commit success until the post-commit history refresh resolves', async () => {
    const commitResult =
      createDeferred<Awaited<ReturnType<VersionHistoryWorkbook['version']['commitCurrent']>>>();
    const refreshedSurface = createDeferred<ReturnType<typeof createSurfaceStatus>>();
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(createSurfaceStatus())
      .mockImplementationOnce(async () => refreshedSurface.promise);
    const workbook = createWorkbook({
      getSurfaceStatus,
      commitCurrent: jest.fn(async () => commitResult.promise),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Checkpoint');
    await user.click(screen.getByTestId('version-history-commit-button'));

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

    await waitFor(() =>
      expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
        'Refreshing version history',
      ),
    );
    expect(screen.getByTestId('version-history-action-result')).not.toHaveTextContent(
      'Committed changes',
    );

    refreshedSurface.resolve(createSurfaceStatus());
    await expectActionResult('Committed changes', 'success');
  });

  it('clears checkout status after the refreshed checkout state loads', async () => {
    const refreshedSurface = createDeferred<ReturnType<typeof createSurfaceStatus>>();
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(createSurfaceStatus())
      .mockImplementationOnce(async () => refreshedSurface.promise);
    const workbook = createWorkbook({ getSurfaceStatus });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await openCurrentBranchMenu(user);
    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/budget')));

    await waitFor(() => expect(workbook.version.checkoutBranch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
        'Refreshing version history',
      ),
    );
    expect(screen.getByTestId('version-history-action-result')).not.toHaveTextContent(
      'Checked out budget',
    );

    refreshedSurface.resolve(
      createSurfaceStatus({
        current: {
          headCommitId: PARENT_COMMIT_ID,
          branchName: 'refs/heads/budget',
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('version-history-current-branch-trigger')).toHaveTextContent(
      'budget',
    );
  });

  it('does not announce branch creation until refreshed refs include the new checkout action', async () => {
    const branchName = 'refs/heads/version-panel';
    const branchResult =
      createDeferred<
        Awaited<ReturnType<VersionHistoryWorkbook['version']['createBranchFromCurrent']>>
      >();
    const refreshedRefs =
      createDeferred<Awaited<ReturnType<VersionHistoryWorkbook['version']['refs']['listRefs']>>>();
    const listRefs = jest
      .fn<VersionHistoryWorkbook['version']['refs']['listRefs']>()
      .mockImplementationOnce(() => createWorkbook().version.refs.listRefs())
      .mockImplementationOnce(async () => refreshedRefs.promise);
    const workbook = createWorkbook({
      createBranchFromCurrent: jest.fn(async () => branchResult.promise),
      refs: { listRefs },
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await openCurrentBranchMenu(user);
    await user.type(screen.getByTestId('version-history-branch-name-input'), 'version-panel');
    await user.click(screen.getByTestId('version-history-create-branch-button'));

    branchResult.resolve({
      ok: true,
      value: {
        name: branchName,
        commitId: HEAD_COMMIT_ID,
        revision: { kind: 'counter', value: '3' },
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
        'Refreshing version history',
      ),
    );
    expect(screen.queryByTestId(checkoutBranchTestId(branchName))).not.toBeInTheDocument();

    refreshedRefs.resolve({
      ok: true,
      value: {
        items: [
          {
            name: 'refs/heads/main',
            commitId: HEAD_COMMIT_ID,
            revision: REF_REVISION,
          },
          {
            name: branchName,
            commitId: HEAD_COMMIT_ID,
            revision: { kind: 'counter', value: '3' },
          },
        ],
        limit: 2,
      },
    });
    await expectActionResult('Created version-panel', 'success');
    expect(await screen.findByTestId(checkoutBranchTestId(branchName))).toBeEnabled();
  });

  it('keeps checkout controls disabled while branch creation is in flight', async () => {
    const branchName = 'refs/heads/action-busy';
    const branchResult =
      createDeferred<
        Awaited<ReturnType<VersionHistoryWorkbook['version']['createBranchFromCurrent']>>
      >();
    const workbook = createWorkbook({
      createBranchFromCurrent: jest.fn(() => branchResult.promise),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await openCurrentBranchMenu(user);
    await user.type(screen.getByTestId('version-history-branch-name-input'), 'action-busy');
    await user.click(screen.getByTestId('version-history-create-branch-button'));

    await waitFor(() => expect(workbook.version.createBranchFromCurrent).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
      'Creating branch',
    );

    const runningReason = 'Wait for the current version action to finish.';
    expectDisabledButtonReason(
      screen.getByTestId(checkoutBranchTestId('refs/heads/budget')),
      runningReason,
    );

    branchResult.resolve({
      ok: true,
      value: {
        name: branchName,
        commitId: HEAD_COMMIT_ID,
        revision: { kind: 'counter', value: '3' },
      },
    });
    await expectActionResult('Created action-busy', 'success');
  });

  it('refreshes commit availability when workbook edits dirty an open panel', async () => {
    let hasUncommittedLocalChanges = false;
    let surfaceReadCount = 0;
    const refreshHandlers = new Map<string, Array<(event: unknown) => void>>();
    const getSurfaceStatus = jest.fn(async () => {
      surfaceReadCount += 1;
      return createSurfaceStatus({
        dirty: {
          statusRevision: `dirty:${surfaceReadCount}`,
          checkoutPreflightToken: `token:${surfaceReadCount}`,
          hasUncommittedLocalChanges,
          commitEligibleChanges: hasUncommittedLocalChanges,
        },
      });
    });
    const workbook: VersionHistoryWorkbook = {
      ...createWorkbook({ getSurfaceStatus }),
      on: jest.fn((event: string, handler: (event: unknown) => void) => {
        const handlers = refreshHandlers.get(event) ?? [];
        handlers.push(handler);
        refreshHandlers.set(event, handlers);
        return jest.fn();
      }) as VersionHistoryWorkbook['on'],
    };
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Branch edit');
    const commitButton = screen.getByTestId('version-history-commit-button');
    expectDisabledButtonReason(commitButton, 'Make a workbook change before committing.');

    hasUncommittedLocalChanges = true;
    act(() => {
      for (const handler of refreshHandlers.get('workbook:version-dirty-status-changed') ?? []) {
        handler({
          type: 'workbook:version-dirty-status-changed',
          hasUncommittedLocalChanges: true,
          previousHasUncommittedLocalChanges: false,
          statusRevision: 2,
        });
      }
    });

    await waitFor(() => expect(getSurfaceStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(commitButton).toBeEnabled());
  });

  it('keeps commit disabled when a post-commit refresh returns the same dirty snapshot', async () => {
    const staleDirtySurface = createSurfaceStatus({
      dirty: {
        statusRevision: 'dirty:1',
        checkoutPreflightToken: 'token:1',
        hasUncommittedLocalChanges: true,
        commitEligibleChanges: true,
      },
    });
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(staleDirtySurface)
      .mockResolvedValueOnce(staleDirtySurface);
    const workbook = createWorkbook({ getSurfaceStatus });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    const commitInput = screen.getByTestId('version-history-commit-message-input');
    const commitButton = screen.getByTestId('version-history-commit-button');

    await user.type(commitInput, 'Checkpoint');
    await user.click(commitButton);

    await waitFor(() => expect(workbook.version.commitCurrent).toHaveBeenCalledTimes(1));
    await expectActionResult('Committed changes', 'success');

    await user.type(commitInput, 'Second checkpoint');
    expectDisabledButtonReason(commitButton, 'Version status is refreshing.');
    await user.click(commitButton);
    expect(workbook.version.commitCurrent).toHaveBeenCalledTimes(1);
  });

  it('keeps commit disabled when a post-checkout refresh returns the same dirty snapshot', async () => {
    const staleDirtySurface = createSurfaceStatus({
      dirty: {
        statusRevision: 'dirty:checkout-1',
        checkoutPreflightToken: 'token:checkout-1',
        hasUncommittedLocalChanges: true,
        commitEligibleChanges: true,
        checkoutSafe: true,
      },
    });
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(staleDirtySurface)
      .mockResolvedValueOnce(staleDirtySurface);
    const workbook = createWorkbook({ getSurfaceStatus });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    const commitButton = screen.getByTestId('version-history-commit-button');

    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Checkpoint');
    expect(commitButton).toBeEnabled();

    await openCurrentBranchMenu(user);
    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/budget')));

    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument(),
    );
    expectDisabledButtonReason(commitButton, 'Version status is refreshing.');
    await user.click(commitButton);
    expect(workbook.version.commitCurrent).not.toHaveBeenCalled();
  });

  it('calls commit, createBranch, checkout, and parent diff through workbook.version', async () => {
    const workbook = createWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    await user.type(
      screen.getByTestId('version-history-commit-message-input'),
      'Snapshot before review',
    );
    await user.click(screen.getByTestId('version-history-commit-button'));
    await waitFor(() =>
      expect(workbook.version.commitCurrent).toHaveBeenCalledWith({
        message: 'Snapshot before review',
      }),
    );
    await expectActionResult('Committed changes', 'success');
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId(commitMenuButtonTestId(PARENT_COMMIT_ID)));
    await user.click(screen.getByTestId(createBranchFromCommitTestId(PARENT_COMMIT_ID)));
    await user.type(
      screen.getByTestId(commitBranchNameInputTestId(PARENT_COMMIT_ID)),
      'version-panel',
    );
    await user.click(screen.getByTestId(createBranchFromCommitSubmitTestId(PARENT_COMMIT_ID)));
    await waitFor(() =>
      expect(workbook.version.refs.createBranch).toHaveBeenCalledWith({
        name: 'refs/heads/version-panel',
        targetCommitId: PARENT_COMMIT_ID,
        expectedAbsent: true,
      }),
    );
    await expectActionResult('Created version-panel', 'success');
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(3));

    fireEvent.contextMenu(screen.getByTestId(commitRowTestId(PARENT_COMMIT_ID)), {
      clientX: 42,
      clientY: 96,
    });
    await user.click(screen.getByTestId(checkoutCommitTestId(PARENT_COMMIT_ID)));
    await waitFor(() =>
      expect(workbook.version.checkoutCommit).toHaveBeenCalledWith(PARENT_COMMIT_ID, {
        includeDiagnostics: true,
      }),
    );
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument(),
    );

    await openCurrentBranchMenu(user);
    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/budget')));
    await waitFor(() =>
      expect(workbook.version.checkoutBranch).toHaveBeenCalledWith('budget', {
        includeDiagnostics: true,
      }),
    );
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(5));
    await waitFor(() =>
      expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    await waitFor(() =>
      expect(workbook.version.diffOverview).toHaveBeenCalledWith(PARENT_COMMIT_ID, HEAD_COMMIT_ID, {
        groupLimit: 50,
        includeDiagnostics: true,
      }),
    );
    const diffViewer = await screen.findByTestId('version-history-diff-viewer');
    expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument();
    expect(diffViewer).toHaveAttribute('data-state', 'changes');
    expect(diffViewer).toHaveTextContent('Changes');
    expect(screen.queryByTestId('version-history-diff-overview')).not.toBeInTheDocument();
    expect(screen.getByTestId('version-history-diff-total-count')).toHaveTextContent('1 change');
    expect(screen.queryByTestId('version-history-diff-group-list')).not.toBeInTheDocument();
    const inlineDetail = await screen.findByTestId('version-history-diff-inline-detail');
    expect(inlineDetail).toHaveTextContent('Sheet1!A1');
    expect(inlineDetail).not.toHaveTextContent('sheet-1!A1');
    expect(diffViewer).not.toHaveTextContent('cells value');
    const diffStatus = within(diffViewer).getByRole('status');
    expect(diffStatus).toHaveAttribute('aria-live', 'polite');
    expect(diffStatus).toHaveAttribute('aria-atomic', 'true');
    expect(diffStatus).toHaveTextContent(
      `Diff base ${shortCommitId(PARENT_COMMIT_ID)} target ${shortCommitId(
        HEAD_COMMIT_ID,
      )}. 1 change.`,
    );
    await waitFor(() =>
      expect(workbook.version.diffGroupDetail).toHaveBeenCalledWith(
        PARENT_COMMIT_ID,
        HEAD_COMMIT_ID,
        {
          groupId: DIFF_GROUP_ID,
          pageSize: 200,
          includeDiagnostics: true,
        },
      ),
    );
    expect(diffViewer).toHaveTextContent('Blank');
    expect(diffViewer).toHaveTextContent('42');
  });

  it('toggles the active parent diff closed from the same commit Diff button', async () => {
    const workbook = createWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    expect(await screen.findByTestId('version-history-parent-diff')).toBeInTheDocument();
    await waitFor(() => expect(workbook.version.diffGroupDetail).toHaveBeenCalledTimes(1));

    const activeDiffButton = screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID));
    await waitFor(() => expect(activeDiffButton).toBeEnabled());
    expect(activeDiffButton).toHaveAccessibleName(
      `Hide diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
    );
    expect(activeDiffButton).toHaveTextContent('Hide');

    await user.click(activeDiffButton);

    await waitFor(() =>
      expect(screen.queryByTestId('version-history-parent-diff')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('version-history-diff-viewer')).not.toBeInTheDocument();
    expect(workbook.version.diffOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID))).toHaveAccessibleName(
      `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
    );
  });

  it('applies sheet, domain, and operation filters through the public diff overview APIs', async () => {
    const workbook = createWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    await screen.findByTestId('version-history-diff-viewer');

    expect(screen.queryByTestId('version-history-diff-filters')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('version-history-diff-filter-button'));
    expect(await screen.findByTestId('version-history-diff-filter-menu')).toBeInTheDocument();
    expect(screen.getByTestId('version-history-diff-filter-address')).toBeDisabled();
    expect(screen.getByTestId('version-history-diff-filter-address')).toHaveAccessibleDescription(
      'Address filters require a historical range index.',
    );
    expect(screen.getByTestId('version-history-diff-filter-search')).toBeDisabled();
    expect(screen.getByTestId('version-history-diff-filter-search')).toHaveAccessibleDescription(
      'Formula and text search requires a redaction-aware search index.',
    );

    fireEvent.change(screen.getByTestId('version-history-diff-filter-domain'), {
      target: { value: 'cells' },
    });
    await waitFor(() => expect(workbook.version.diffOverview).toHaveBeenCalledTimes(2));
    expect(workbook.version.diffOverview).toHaveBeenLastCalledWith(
      PARENT_COMMIT_ID,
      HEAD_COMMIT_ID,
      {
        groupLimit: 50,
        includeDiagnostics: true,
        filters: { domains: ['cells'] },
      },
    );

    fireEvent.change(screen.getByTestId('version-history-diff-filter-sheet'), {
      target: { value: 'sheet-1' },
    });
    await waitFor(() => expect(workbook.version.diffOverview).toHaveBeenCalledTimes(3));
    expect(workbook.version.diffOverview).toHaveBeenLastCalledWith(
      PARENT_COMMIT_ID,
      HEAD_COMMIT_ID,
      {
        groupLimit: 50,
        includeDiagnostics: true,
        filters: { sheetIds: ['sheet-1'], domains: ['cells'] },
      },
    );

    fireEvent.change(screen.getByTestId('version-history-diff-filter-operation'), {
      target: { value: 'changed' },
    });
    await waitFor(() => expect(workbook.version.diffOverview).toHaveBeenCalledTimes(4));
    expect(workbook.version.diffOverview).toHaveBeenLastCalledWith(
      PARENT_COMMIT_ID,
      HEAD_COMMIT_ID,
      {
        groupLimit: 50,
        includeDiagnostics: true,
        filters: {
          sheetIds: ['sheet-1'],
          domains: ['cells'],
          operations: ['changed'],
        },
      },
    );

    await waitFor(() =>
      expect(workbook.version.diffGroupDetail).toHaveBeenCalledWith(
        PARENT_COMMIT_ID,
        HEAD_COMMIT_ID,
        {
          groupId: DIFF_GROUP_ID,
          pageSize: 200,
          includeDiagnostics: true,
          filters: {
            sheetIds: ['sheet-1'],
            domains: ['cells'],
            operations: ['changed'],
          },
        },
      ),
    );
  });

  it.each(parentDiffPreviewCases)(
    'renders a distinct %s parent diff preview state',
    async (_, overview, state, title, label) => {
      const workbook = createWorkbook({
        diffOverview: jest.fn(async () => ({ ok: true, value: overview })),
      });

      const { user } = renderVersionHistoryPanel({ workbook });

      await screen.findByText('Calculated forecast');
      await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
      const diffViewer = await screen.findByTestId('version-history-diff-viewer');
      expect(diffViewer).toHaveAttribute('data-state', state);
      expect(diffViewer).toHaveTextContent(title);
      expect(within(diffViewer).getByRole('status')).toHaveTextContent(label);
      expect(diffViewer).not.toHaveTextContent('No semantic changes');
    },
  );

  it('surfaces commit, branch, checkout, and parent diff errors in the action result region', async () => {
    const workbook = createWorkbook({
      commitCurrent: jest.fn(async () =>
        failedInvalidState('Commit rejected by version provider.'),
      ),
      createBranchFromCurrent: jest.fn(async () =>
        failedInvalidBranchName(
          'refs/heads/provider-rejected',
          'Branch rejected by version provider.',
        ),
      ),
      checkoutBranch: jest.fn(async () =>
        failedInvalidState('Checkout rejected by version provider.'),
      ),
      diffOverview: jest.fn(async () =>
        failedNotFound('version diff', 'Diff target is unavailable.'),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    await user.type(screen.getByTestId('version-history-commit-message-input'), 'Rejected commit');
    await user.click(screen.getByTestId('version-history-commit-button'));
    await expectActionResult('Commit rejected by version provider.', 'error');

    await openCurrentBranchMenu(user);
    await user.type(screen.getByTestId('version-history-branch-name-input'), 'provider-rejected');
    await user.click(screen.getByTestId('version-history-create-branch-button'));
    await expectActionResult('Branch rejected by version provider.', 'error');

    await openCurrentBranchMenu(user);
    await user.click(screen.getByTestId(checkoutBranchTestId('refs/heads/budget')));
    await expectActionResult('Checkout rejected by version provider.', 'error');

    await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
    await expectActionResult('Diff target is unavailable.', 'error');
  });
});
