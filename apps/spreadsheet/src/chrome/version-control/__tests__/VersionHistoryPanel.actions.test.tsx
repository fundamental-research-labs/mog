import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  branchTargetTestId,
  checkoutBranchTestId,
  createDeferred,
  createWorkbook,
  diffDiagnostic,
  diffEntry,
  expectActionResult,
  expectDisabledButtonReason,
  failedInvalidBranchName,
  failedInvalidState,
  failedNotFound,
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
];

describe('VersionHistoryPanelContent action flows', () => {
  it('validates branch names client-side against public refs and existing branches', async () => {
    const workbook = createWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

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

  it.each(parentDiffPreviewCases)(
    'renders a distinct %s parent diff preview state',
    async (_, page, state, title, label) => {
      const workbook = createWorkbook({ diff: jest.fn(async () => ({ ok: true, value: page })) });

      const { user } = renderVersionHistoryPanel({ workbook });

      await screen.findByText('Calculated forecast');
      await user.click(screen.getByTestId(parentDiffButtonTestId(HEAD_COMMIT_ID)));
      const parentDiff = await screen.findByTestId('version-history-parent-diff');
      expect(parentDiff).toHaveAttribute('data-state', state);
      expect(parentDiff).toHaveTextContent(title);
      expect(within(parentDiff).getByRole('status')).toHaveTextContent(`State ${label}`);
      expect(parentDiff).not.toHaveTextContent('No semantic changes');
    },
  );

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
    const { user } = renderVersionHistoryPanel({ workbook });

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
