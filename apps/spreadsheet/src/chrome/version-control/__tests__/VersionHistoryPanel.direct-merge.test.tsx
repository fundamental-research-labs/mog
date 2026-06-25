import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import type {
  VersionCapabilityState,
  VersionRef,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { versionPanelActionExpectsActiveWorkbookReadback } from '../version-history-panel-action-run';
import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  MERGE_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  appliedMergeResult,
  branchTargetTestId,
  checkoutBranchTestId,
  cleanMergeResult,
  conflictedMergeResult,
  createDeferred,
  createSurfaceStatus,
  createWorkbook,
  expectActionResult,
  expectDisabledButtonReason,
  failedInvalidState,
  mergeResolutionFor,
  mergeApplyButtonTestId,
  mergePreviewButtonTestId,
  mergeSourceRefSelectTestId,
  renderVersionHistoryPanel,
  sameCellMergeConflict,
  shortCommitId,
  type DirectMergeVersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';

const CURRENT_REF = 'refs/heads/main';
const INCOMING_REF = 'refs/heads/scenario/budget';
const REVIEW_REF = 'refs/heads/review/revenue';
const PRIVATE_COMMIT_ID = `commit:sha256:${'e'.repeat(64)}`;
const REVIEW_COMMIT_ID = `commit:sha256:${'f'.repeat(64)}`;
const MERGE_REF_REVISION = { kind: 'counter' as const, value: '5' };
const SOURCE_RESOLUTION_RADIO_NAME = 'cells.values value: Source - theirs';

describe('VersionHistoryPanelContent direct merge controls', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('classifies direct merge apply as an active workbook readback action', () => {
    expect(versionPanelActionExpectsActiveWorkbookReadback({ id: 1, kind: 'merge-apply' })).toBe(
      true,
    );
    expect(versionPanelActionExpectsActiveWorkbookReadback({ id: 2, kind: 'commit' })).toBe(false);
  });

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

  it('keeps direct merge apply disabled when checkout is unavailable', async () => {
    const checkoutReason = 'Checkout denied before merge materialization.';
    const workbook = createDirectMergeWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          capabilityOverrides: {
            'version:checkout': disabledCapability(checkoutReason),
          },
        }),
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    const previewButton = screen.getByTestId(mergePreviewButtonTestId());
    const applyButton = screen.getByTestId(mergeApplyButtonTestId());

    await waitFor(() => expect(previewButton).toBeEnabled());
    expectDisabledButtonReason(applyButton, checkoutReason);

    await user.click(previewButton);
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));
    expectDisabledButtonReason(applyButton, checkoutReason);

    await user.click(applyButton);
    expect(workbook.version.applyMerge).not.toHaveBeenCalled();
    expect(workbook.version.checkout).not.toHaveBeenCalled();
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

  it('applies a clean direct merge through applyMerge materialization and refreshed readback', async () => {
    const getSurfaceStatus = jest
      .fn<DirectMergeVersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(createSurfaceStatus())
      .mockResolvedValue(
        createSurfaceStatus({
          current: {
            headCommitId: MERGE_COMMIT_ID,
            branchName: CURRENT_REF,
            detached: false,
            stale: false,
          },
        }),
      );
    const workbook = createDirectMergeWorkbook({
      getSurfaceStatus,
      getHead: jest
        .fn<DirectMergeVersionHistoryWorkbook['version']['getHead']>()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            id: HEAD_COMMIT_ID,
            refName: CURRENT_REF,
            refRevision: REF_REVISION,
          },
        })
        .mockResolvedValue({
          ok: true,
          value: {
            id: MERGE_COMMIT_ID,
            refName: CURRENT_REF,
            refRevision: MERGE_REF_REVISION,
          },
        }),
      listCommits: jest
        .fn<DirectMergeVersionHistoryWorkbook['version']['listCommits']>()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: directMergeCommits(),
            limit: 20,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: directMergeCommits(),
            limit: 100,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: directMergeCommits(),
            limit: 100,
          },
        })
        .mockResolvedValue({
          ok: true,
          value: {
            items: directMergeCommitsAfterApply(),
            limit: 20,
          },
        }),
      listRefs: jest
        .fn<DirectMergeVersionHistoryWorkbook['version']['listRefs']>()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: directMergeRefs(),
            limit: 2,
          },
        })
        .mockResolvedValue({
          ok: true,
          value: {
            items: directMergeRefsAfterApply(),
            limit: 2,
          },
        }),
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: cleanMergeResult(input.base, input.ours, input.theirs),
      })),
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
        materializeActiveCheckout: true,
        expectedTargetHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: REF_REVISION,
        },
      }),
    );
    await expectActionResult(`Merge applied at ${shortCommitId(MERGE_COMMIT_ID)}`, 'success');
    await waitFor(() => {
      expect(getSurfaceStatus).toHaveBeenCalledTimes(2);
      expect(workbook.version.getHead).toHaveBeenCalledTimes(2);
      expect(workbook.version.listCommits).toHaveBeenCalledTimes(4);
      expect(workbook.version.listRefs).toHaveBeenCalledTimes(2);
    });
    expect(firstInvocationOrder(workbook.version.applyMerge)).toBeLessThan(
      firstInvocationOrder(getSurfaceStatus, 1),
    );
    expect(firstInvocationOrder(workbook.version.applyMerge)).toBeLessThan(
      firstInvocationOrder(workbook.version.getHead, 1),
    );
    expect(firstInvocationOrder(workbook.version.applyMerge)).toBeLessThan(
      firstInvocationOrder(workbook.version.listCommits, 3),
    );
    expect(firstInvocationOrder(workbook.version.applyMerge)).toBeLessThan(
      firstInvocationOrder(workbook.version.listRefs, 1),
    );

    const statusSummary = screen.getByRole('region', { name: 'Version status' });
    expect(statusSummary).toHaveTextContent('main');
    expect(statusSummary).not.toHaveTextContent(CURRENT_REF);
    expect(statusSummary).toHaveTextContent(shortCommitId(MERGE_COMMIT_ID));
    expect(screen.getByTestId('version-merge-target-head')).toHaveTextContent(
      shortCommitId(MERGE_COMMIT_ID),
    );
    expect(screen.getByText('Merge budget scenario')).toBeVisible();
    expect(screen.getByTestId(branchTargetTestId(MERGE_COMMIT_ID))).toBeChecked();
    expect(screen.getByTestId('version-history-branch-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      MERGE_COMMIT_ID,
    );

    const mainBranchRow = screen.getByTestId(checkoutBranchTestId(CURRENT_REF)).closest('li');
    if (!mainBranchRow) throw new Error('Missing refreshed main branch row');
    expect(mainBranchRow).toHaveTextContent(shortCommitId(MERGE_COMMIT_ID));
    expect(workbook.version.checkout).not.toHaveBeenCalled();
  });

  it('refreshes the merge target ref revision immediately before apply', async () => {
    const freshRevision = { kind: 'counter' as const, value: 'fresh-7' };
    const freshSymbolicRevision = { kind: 'counter' as const, value: 'head-fresh-7' };
    const workbook = createDirectMergeWorkbook({
      readRef: jest.fn<DirectMergeVersionHistoryWorkbook['version']['readRef']>(async (name) => {
        if (name === 'HEAD') {
          return {
            ok: true,
            value: {
              status: 'success',
              ref: {
                name: 'HEAD',
                target: CURRENT_REF,
                revision: freshSymbolicRevision,
              },
              diagnostics: [],
            },
          };
        }
        return {
          ok: true,
          value: {
            status: 'success',
            ref: {
              name: CURRENT_REF,
              commitId: HEAD_COMMIT_ID,
              revision: freshRevision,
            },
            diagnostics: [],
          },
        };
      }),
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: cleanMergeResult(input.base, input.ours, input.theirs),
      })),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled());
    await user.click(screen.getByTestId(mergeApplyButtonTestId()));

    await waitFor(() => expect(workbook.version.applyMerge).toHaveBeenCalledTimes(1));
    expect(workbook.version.readRef).toHaveBeenCalledWith(CURRENT_REF);
    expect(workbook.version.readRef).toHaveBeenCalledWith('HEAD');
    expect(firstInvocationOrder(workbook.version.merge)).toBeLessThan(
      firstInvocationOrder(workbook.version.applyMerge),
    );
    expect(firstInvocationOrder(workbook.version.readRef)).toBeLessThan(
      firstInvocationOrder(workbook.version.applyMerge),
    );
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[1]).toEqual(
      expect.objectContaining({
        targetRef: CURRENT_REF,
        materializeActiveCheckout: true,
        expectedTargetHead: {
          commitId: HEAD_COMMIT_ID,
          revision: freshRevision,
          symbolicHeadRevision: freshSymbolicRevision,
        },
      }),
    );
  });

  it('keeps merge apply pending until the post-apply history refresh completes', async () => {
    const refreshedSurface = createDeferred<ReturnType<typeof createSurfaceStatus>>();
    const getSurfaceStatus = jest
      .fn<DirectMergeVersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(createSurfaceStatus())
      .mockImplementationOnce(async () => refreshedSurface.promise);
    const workbook = createDirectMergeWorkbook({ getSurfaceStatus });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));

    const applyButton = screen.getByTestId(mergeApplyButtonTestId());
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);

    await waitFor(() => expect(workbook.version.applyMerge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[1]).toEqual(
      expect.objectContaining({
        mode: 'apply',
        targetRef: CURRENT_REF,
        materializeActiveCheckout: true,
        expectedTargetHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: REF_REVISION,
        },
      }),
    );
    expect(workbook.version.checkout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
        'Refreshing version history',
      ),
    );
    expect(screen.getByTestId('version-history-action-result')).not.toHaveTextContent(
      'Merge applied',
    );
    expect(getSurfaceStatus).toHaveBeenCalledTimes(2);

    refreshedSurface.resolve(createSurfaceStatus());
    await expectActionResult(`Merge applied at ${shortCommitId(MERGE_COMMIT_ID)}`, 'success');
  });

  it('requires a fresh public preview after changing the source ref before applying', async () => {
    const workbook = createDirectMergeWorkbook({
      listCommits: jest.fn(async () => ({
        ok: true,
        value: {
          items: directMergeCommitsWithReviewBranch(),
          limit: 20,
        },
      })),
      listRefs: jest.fn(async () => ({
        ok: true,
        value: {
          items: directMergeRefsWithReviewBranch(),
          limit: 3,
        },
      })),
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: cleanMergeResult(input.base, input.ours, input.theirs),
      })),
      applyMerge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['applyMerge']>(
        async (input) => {
          const mergeInput = directMergeInput(input);
          return {
            ok: true,
            value: appliedMergeResult(mergeInput.base, mergeInput.ours, mergeInput.theirs),
          };
        },
      ),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    const sourceSelect = screen.getByTestId(mergeSourceRefSelectTestId());
    expect(sourceSelect).toHaveValue(INCOMING_REF);

    await user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.merge)[0]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: LATEST_COMMIT_ID,
    });
    await waitFor(() => expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled());

    await user.selectOptions(sourceSelect, REVIEW_REF);
    await waitFor(() =>
      expectDisabledButtonReason(
        screen.getByTestId(mergeApplyButtonTestId()),
        'Preview a merge first.',
      ),
    );
    expect(screen.queryByTestId('version-merge-preview-status')).not.toBeInTheDocument();

    await user.click(screen.getByTestId(mergeApplyButtonTestId()));
    expect(workbook.version.applyMerge).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(2));
    expect(firstCallArgs(workbook.version.merge)[1]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: REVIEW_COMMIT_ID,
    });

    await waitFor(() => expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled());
    await user.click(screen.getByTestId(mergeApplyButtonTestId()));

    await waitFor(() => expect(workbook.version.applyMerge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: REVIEW_COMMIT_ID,
    });
    await expectActionResult(`Merge applied at ${shortCommitId(MERGE_COMMIT_ID)}`, 'success');
  });

  it('does not apply a conflicted direct merge preview without resolutions', async () => {
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: conflictedMergeResult(input.base, input.ours, input.theirs),
      })),
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

  it('applies a conflicted direct merge after selecting a resolution', async () => {
    const conflict = sameCellMergeConflict();
    const expectedResolution = mergeResolutionFor(conflict, 'acceptTheirs');
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: conflictedMergeResult(input.base, input.ours, input.theirs, conflict),
      })),
      checkout: jest.fn<DirectMergeVersionHistoryWorkbook['version']['checkout']>(async () => ({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          plan: {
            strategy: 'fullSnapshot',
            target: {
              kind: 'ref',
              refName: CURRENT_REF,
              commitId: MERGE_COMMIT_ID,
              refRevision: { kind: 'counter', value: '5' },
            },
            commitId: MERGE_COMMIT_ID,
            parentCommitIds: [HEAD_COMMIT_ID, LATEST_COMMIT_ID],
            requiredDependencies: [],
            requiredDependencyCount: 0,
          },
          diagnostics: [],
          mutationGuarantee: 'workbook-state-materialized',
        },
      })),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await user.click(screen.getByTestId(mergePreviewButtonTestId()));

    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));

    const applyButton = screen.getByTestId(mergeApplyButtonTestId());
    await waitFor(() =>
      expectDisabledButtonReason(applyButton, 'Select a resolution for each conflict.'),
    );
    await user.click(applyButton);
    expect(workbook.version.applyMerge).not.toHaveBeenCalled();

    expect(
      screen.getByRole('region', { name: '1 merge conflict requiring resolution' }),
    ).toContainElement(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME }));

    await user.click(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME }));
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);

    await waitFor(() => expect(workbook.version.applyMerge).toHaveBeenCalledTimes(1));
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: LATEST_COMMIT_ID,
      resolutions: [expectedResolution],
    });
    expect(firstCallArgs(workbook.version.applyMerge)[0]?.[1]).toEqual(
      expect.objectContaining({
        mode: 'apply',
        includeDiagnostics: true,
        targetRef: CURRENT_REF,
        materializeActiveCheckout: true,
        expectedTargetHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: REF_REVISION,
        },
      }),
    );
    expect(workbook.version.checkout).not.toHaveBeenCalled();
  });

  it('restores a conflicted direct merge preview and selected resolution after remount', async () => {
    const conflict = sameCellMergeConflict();
    const workbook = createDirectMergeWorkbook({
      merge: jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
        ok: true,
        value: conflictedMergeResult(input.base, input.ours, input.theirs, conflict),
      })),
    });
    const firstRender = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await firstRender.user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(1));
    await firstRender.user.click(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME }));
    await waitFor(() => expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled());

    firstRender.unmount();
    renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await waitFor(() => expect(workbook.version.merge).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('version-merge-preview-status')).toHaveAttribute(
        'data-status',
        'conflicted',
      );
    });
    expect(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME })).toBeChecked();
    expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled();
  });

  it('restores a merge draft after materialized checkout marker recovery', async () => {
    const conflict = sameCellMergeConflict();
    const merge = jest.fn<DirectMergeVersionHistoryWorkbook['version']['merge']>(async (input) => ({
      ok: true,
      value: conflictedMergeResult(input.base, input.ours, input.theirs, conflict),
    }));
    const firstRender = renderVersionHistoryPanel({
      workbook: createDirectMergeWorkbook({ merge }),
    });

    await screen.findByText('Calculated forecast');
    await firstRender.user.click(screen.getByTestId(mergePreviewButtonTestId()));
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    await firstRender.user.click(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME }));
    await waitFor(() => expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled());

    firstRender.unmount();
    renderVersionHistoryPanel({
      workbook: createDirectMergeWorkbook({
        getSurfaceStatus: jest.fn(async () =>
          createSurfaceStatus({
            current: {
              headCommitId: HEAD_COMMIT_ID,
              checkedOutCommitId: HEAD_COMMIT_ID,
              branchName: 'main',
              refHeadAtMaterialization: HEAD_COMMIT_ID,
              currentRefHeadId: HEAD_COMMIT_ID,
              detached: false,
              stale: false,
            },
          }),
        ),
        getHead: jest.fn<DirectMergeVersionHistoryWorkbook['version']['getHead']>(async () =>
          failedInvalidState('head unavailable after active checkout restore'),
        ),
        merge,
      }),
    });

    await screen.findByText('Calculated forecast');
    expect(screen.getByTestId(mergeSourceRefSelectTestId())).toHaveValue(INCOMING_REF);
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(2));
    expect(firstCallArgs(merge)[1]?.[0]).toEqual({
      base: PARENT_COMMIT_ID,
      ours: HEAD_COMMIT_ID,
      theirs: LATEST_COMMIT_ID,
    });
    expect(firstCallArgs(merge)[1]?.[1]).toEqual(
      expect.objectContaining({
        targetRef: CURRENT_REF,
      }),
    );
    expect(screen.getByRole('radio', { name: SOURCE_RESOLUTION_RADIO_NAME })).toBeChecked();
    expect(screen.getByTestId(mergeApplyButtonTestId())).toBeEnabled();
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

function directMergeCommitsAfterApply(): readonly WorkbookCommitSummary[] {
  return [
    {
      id: MERGE_COMMIT_ID,
      parents: [HEAD_COMMIT_ID, LATEST_COMMIT_ID],
      createdAt: '2026-06-22T10:15:00.000Z',
      author: { redacted: false, displayName: 'Planning agent' },
      annotation: { title: { kind: 'text', value: 'Merge budget scenario' } },
    },
    ...directMergeCommits(),
  ];
}

function directMergeRefsAfterApply(): readonly VersionRef[] {
  return [
    {
      name: CURRENT_REF,
      commitId: MERGE_COMMIT_ID,
      revision: MERGE_REF_REVISION,
    },
    {
      name: INCOMING_REF,
      commitId: LATEST_COMMIT_ID,
      revision: { kind: 'counter', value: '2' },
    },
  ];
}

function directMergeCommitsWithReviewBranch(): readonly WorkbookCommitSummary[] {
  return [
    ...directMergeCommits(),
    {
      id: REVIEW_COMMIT_ID,
      parents: [PARENT_COMMIT_ID],
      createdAt: '2026-06-22T10:13:00.000Z',
      author: { redacted: false, displayName: 'Review agent' },
      annotation: { title: { kind: 'text', value: 'Revenue review' } },
    },
  ];
}

function directMergeRefsWithReviewBranch(): readonly VersionRef[] {
  return [
    ...directMergeRefs(),
    {
      name: REVIEW_REF,
      commitId: REVIEW_COMMIT_ID,
      revision: { kind: 'counter', value: '3' },
    },
  ];
}

function directMergeInput(
  input: Parameters<DirectMergeVersionHistoryWorkbook['version']['applyMerge']>[0],
) {
  if ('base' in input) return input;

  return {
    base: PARENT_COMMIT_ID,
    ours: HEAD_COMMIT_ID,
    theirs: REVIEW_COMMIT_ID,
  };
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

function firstInvocationOrder<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  index = 0,
): number {
  const order = (
    fn as unknown as { readonly mock: { readonly invocationCallOrder: readonly number[] } }
  ).mock.invocationCallOrder[index];
  if (order === undefined) throw new Error('Expected mock to have at least one invocation');
  return order;
}
