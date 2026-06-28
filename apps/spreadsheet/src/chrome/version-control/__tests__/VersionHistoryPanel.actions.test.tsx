import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import {
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
  diffDiagnostic,
  diffEntry,
  expectActionResult,
  expectDisabledButtonReason,
  failedInvalidBranchName,
  failedInvalidState,
  failedNotFound,
  openCurrentBranchMenu,
  parentDiffButtonTestId,
  renderVersionHistoryPanel,
  semanticDiffPage,
  shortCommitId,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

type ParentDiffPreviewCase = readonly [
  label: string,
  page: VersionSemanticDiffPage,
  state: string,
  title: string,
  statusLabel: string,
];

const parentDiffPreviewCases: readonly ParentDiffPreviewCase[] = [
  ['empty', semanticDiffPage([]), 'empty', 'Diff returned no entries', 'Empty preview'],
  [
    'unsupported',
    semanticDiffPage([
      diffEntry({ diagnostics: [diffDiagnostic('unsupportedDomain', 'unsupported')] }),
    ]),
    'unsupported',
    'Unsupported semantic state',
    'Unsupported state',
  ],
  [
    'stale',
    semanticDiffPage([
      diffEntry({ diagnostics: [diffDiagnostic('VERSION_REF_CONFLICT', 'retry')] }),
    ]),
    'stale',
    'Stale diff reference',
    'Stale reference',
  ],
  [
    'conflict-only',
    semanticDiffPage([diffEntry({ changeId: 'merge-conflict:sha256:1' })]),
    'conflict-only',
    'Conflicts only',
    'Conflicts only',
  ],
  [
    'redacted',
    semanticDiffPage([
      {
        structural: { kind: 'redacted', reason: 'permission-denied' },
        before: { kind: 'redacted', reason: 'redaction-policy' },
        after: { kind: 'redacted', reason: 'historical-acl-unavailable' },
        diagnostics: [diffDiagnostic('VERSION_PERMISSION_DENIED', 'unsupported')],
      },
    ]),
    'redacted',
    'Restricted diff entries',
    'Restricted entries',
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
      createDeferred<Awaited<ReturnType<VersionHistoryWorkbook['version']['graph']['listRefs']>>>();
    const listRefs = jest
      .fn<VersionHistoryWorkbook['version']['graph']['listRefs']>()
      .mockImplementationOnce(() => createWorkbook().version.graph.listRefs())
      .mockImplementationOnce(async () => refreshedRefs.promise);
    const workbook = createWorkbook({
      createBranchFromCurrent: jest.fn(async () => branchResult.promise),
      graph: {
        listRefs,
      },
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

    await waitFor(() =>
      expect(workbook.version.createBranchFromCurrent).toHaveBeenCalledTimes(1),
    );
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
      expect(workbook.version.graph.createBranch).toHaveBeenCalledWith({
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
      expect(workbook.version.graph.diff).toHaveBeenCalledWith(PARENT_COMMIT_ID, HEAD_COMMIT_ID, {
        pageSize: 50,
        includeDiagnostics: true,
      }),
    );
    const diffViewer = await screen.findByTestId('version-history-diff-viewer');
    expect(screen.queryByTestId('version-history-action-result')).not.toBeInTheDocument();
    expect(diffViewer).toHaveAttribute('data-state', 'changes');
    expect(diffViewer).toHaveTextContent('Changes');
    expect(diffViewer).toHaveTextContent('sheet-1!A1');
    expect(diffViewer).not.toHaveTextContent('cells value');
    expect(diffViewer).toHaveTextContent('Blank');
    expect(diffViewer).toHaveTextContent('42');
    const diffStatus = within(diffViewer).getByRole('status');
    expect(diffStatus).toHaveAttribute('aria-live', 'polite');
    expect(diffStatus).toHaveAttribute('aria-atomic', 'true');
    expect(diffStatus).toHaveTextContent(
      `Diff base ${shortCommitId(PARENT_COMMIT_ID)} target ${shortCommitId(
        HEAD_COMMIT_ID,
      )} State Changes. Change count 1`,
    );
  });

  it.each(parentDiffPreviewCases)(
    'renders a distinct %s parent diff preview state',
    async (_, page, state, title, label) => {
      const workbook = createWorkbook({
        graph: { diff: jest.fn(async () => ({ ok: true, value: page })) },
      });

      const { user } = renderVersionHistoryPanel({ workbook });

      await screen.findByText('Calculated forecast');
      await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
      const diffViewer = await screen.findByTestId('version-history-diff-viewer');
      expect(diffViewer).toHaveAttribute('data-state', state);
      expect(diffViewer).toHaveTextContent(title);
      expect(within(diffViewer).getByRole('status')).toHaveTextContent(`State ${label}`);
      if (state === 'redacted') {
        expect(diffViewer).toHaveTextContent('Redacted change');
      }
      expect(diffViewer).not.toHaveTextContent('No semantic changes');
    },
  );

  it('surfaces commit, branch, checkout, and parent diff errors in the action result region', async () => {
    const workbook = createWorkbook({
      commitCurrent: jest.fn(async () => failedInvalidState('Commit rejected by version provider.')),
      createBranchFromCurrent: jest.fn(async () =>
        failedInvalidBranchName(
          'refs/heads/provider-rejected',
          'Branch rejected by version provider.',
        ),
      ),
      checkoutBranch: jest.fn(async () => failedInvalidState('Checkout rejected by version provider.')),
      graph: {
        diff: jest.fn(async () => failedNotFound('version diff', 'Diff target is unavailable.')),
      },
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
