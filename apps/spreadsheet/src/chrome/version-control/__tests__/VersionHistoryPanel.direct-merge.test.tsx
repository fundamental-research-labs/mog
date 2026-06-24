import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import type {
  VersionCapabilityState,
  VersionRef,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  cleanMergeResult,
  conflictedMergeResult,
  createSurfaceStatus,
  createWorkbook,
  expectDisabledButtonReason,
  failedInvalidState,
  mergeApplyButtonTestId,
  mergePreviewButtonTestId,
  mergeSourceRefSelectTestId,
  renderVersionHistoryPanel,
  type DirectMergeVersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

const CURRENT_REF = 'refs/heads/main';
const INCOMING_REF = 'refs/heads/scenario/budget';
const PRIVATE_COMMIT_ID = `commit:sha256:${'e'.repeat(64)}`;

describe('VersionHistoryPanelContent direct merge controls', () => {
  it('keeps direct merge controls disabled when merge capabilities are unavailable', async () => {
    const previewReason =
      'Merge preview denied for principal [principal] on [version ref] at [commit].';
    const applyReason =
      'Merge apply denied for principal [principal] on [version ref] at [commit].';
    const workbook = createDirectMergeWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          capabilityOverrides: {
            'version:mergePreview': disabledCapability(
              `Merge preview denied for principal principal-secret on refs/heads/private at ${PRIVATE_COMMIT_ID}.`,
            ),
            'version:mergeApply': disabledCapability(
              `Merge apply denied for principal principal-secret on refs/heads/private at ${PRIVATE_COMMIT_ID}.`,
            ),
          },
        }),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    const previewButton = screen.getByTestId(mergePreviewButtonTestId());
    const applyButton = screen.getByTestId(mergeApplyButtonTestId());

    expectDisabledButtonReason(previewButton, previewReason);
    expectDisabledButtonReason(applyButton, applyReason);

    await user.click(previewButton);
    await user.click(applyButton);

    expect(workbook.version.merge).not.toHaveBeenCalled();
    expect(workbook.version.applyMerge).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel-version-history')).not.toHaveTextContent('principal-secret');
    expect(screen.getByTestId('panel-version-history')).not.toHaveTextContent('refs/heads/private');
    expect(screen.getByTestId('panel-version-history')).not.toHaveTextContent(PRIVATE_COMMIT_ID);
  });

  it('previews a direct merge with selected base, current ref head, and incoming ref head', async () => {
    const workbook = createDirectMergeWorkbook();
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));

    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.merge)[0]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: LATEST_COMMIT_ID,
    });
    expect(workbook.version.applyMerge).not.toHaveBeenCalled();
  });

  it('applies a clean direct merge through workbook.version.applyMerge', async () => {
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(
        async (input) => ({
          ok: true,
          value: cleanMergeResult(input.base, input.ours, input.theirs),
        }),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));

    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));

    const applyButton = screen.getByTestId(mergeApplyButtonTestId());
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);

    await waitFor(() => expect(workbook.version.applyMerge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: LATEST_COMMIT_ID,
    });
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[1]).toEqual(
      expect.objectContaining({
        targetRef: CURRENT_REF,
        expectedTargetHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
        },
      }),
    );
  });

  it('does not apply a conflicted direct merge preview without resolutions', async () => {
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(
        async (input) => ({
          ok: true,
          value: conflictedMergeResult(input.base, input.ours, input.theirs),
        }),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));

    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));

    const applyButton = screen.getByTestId(mergeApplyButtonTestId());
    await waitFor(() => expect(applyButton).toBeDisabled());
    await user.click(applyButton);

    expect(workbook.version.applyMerge).not.toHaveBeenCalled();
  });

  it('sanitizes direct merge status messages', async () => {
    const reason = `Merge preview failed for principal principal-secret on refs/heads/private at ${PRIVATE_COMMIT_ID}. token=raw-token`;
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async () =>
        failedInvalidState(reason),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));

    await waitFor(() => {
      expect(screen.getByTestId('version-history-action-result')).toHaveAttribute(
        'data-status',
        'error',
      );
    });
    const result = screen.getByTestId('version-history-action-result');

    expect(result).toHaveTextContent('principal [principal]');
    expect(result).toHaveTextContent('[version ref]');
    expect(result).toHaveTextContent('[commit]');
    expect(result).toHaveTextContent('token [secret]');
    expect(result).not.toHaveTextContent('principal-secret');
    expect(result).not.toHaveTextContent('refs/heads/private');
    expect(result).not.toHaveTextContent(PRIVATE_COMMIT_ID);
    expect(result).not.toHaveTextContent('raw-token');
  });
});

function createDirectMergeWorkbook(
  overrides: Partial<DirectMergeVersionHistoryWorkbook['version']> = {},
): DirectMergeVersionHistoryWorkbook {
  return createWorkbook({
    listCommits: jest.fn(async () => ({
      ok: true,
      value: {
        items: directMergeCommits(),
        limit: 20,
      },
    })),
    listRefs: jest.fn(async () => ({
      ok: true,
      value: {
        items: directMergeRefs(),
        limit: 2,
      },
    })),
    ...overrides,
  });
}

function directMergeCommits(): readonly WorkbookCommitSummary[] {
  return [
    {
      id: HEAD_COMMIT_ID,
      parents: [PARENT_COMMIT_ID],
      createdAt: '2026-06-22T10:10:00.000Z',
      author: { redacted: false, displayName: 'Reviewer' },
      annotation: { title: { kind: 'text', value: 'Calculated forecast' } },
    },
    {
      id: LATEST_COMMIT_ID,
      parents: [PARENT_COMMIT_ID],
      createdAt: '2026-06-22T10:12:00.000Z',
      author: { redacted: false, displayName: 'Planning agent' },
      annotation: { title: { kind: 'text', value: 'Budget scenario' } },
    },
    {
      id: PARENT_COMMIT_ID,
      parents: [],
      createdAt: '2026-06-22T10:00:00.000Z',
      author: { redacted: false, displayName: 'Reviewer' },
      annotation: { title: { kind: 'text', value: 'Initial import' } },
    },
  ];
}

function directMergeRefs(): readonly VersionRef[] {
  return [
    {
      name: CURRENT_REF,
      commitId: HEAD_COMMIT_ID,
      revision: REF_REVISION,
    },
    {
      name: INCOMING_REF,
      commitId: LATEST_COMMIT_ID,
      revision: { kind: 'counter', value: '2' },
    },
  ];
}

function disabledCapability(reason: string): VersionCapabilityState {
  return {
    enabled: false,
    dependency: 'VC-05',
    reason,
    retryable: false,
  };
}

function firstCallArgs<Args extends unknown[]>(fn: (...args: Args) => unknown): Args[] {
  return (fn as unknown as { readonly mock: { readonly calls: Args[] } }).mock.calls;
}
