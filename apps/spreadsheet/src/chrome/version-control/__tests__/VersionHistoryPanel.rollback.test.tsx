import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, screen, waitFor } from '@testing-library/react';
import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  PARENT_COMMIT_ID,
  REF_REVISION,
  branchTargetTestId,
  createDeferred,
  createRollbackSurfaceStatus,
  createRollbackWorkbook,
  expectActionResult,
  expectDisabledButtonReason,
  failedStaleHead,
  rejectedRollbackDryRun,
  renderRollbackPanel,
  shortCommitId,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.rollback.test-utils';

describe('VersionHistoryPanelContent rollback staging', () => {
  it('stages rollback dry-run for the selected commit through workbook.version.revert', async () => {
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({ revertEnabled: true }),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId(branchTargetTestId(PARENT_COMMIT_ID)));
    expect(screen.getByTestId('version-history-rollback-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      PARENT_COMMIT_ID,
    );

    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await waitFor(() =>
      expect(workbook.version.revert).toHaveBeenCalledWith(
        {
          target: { kind: 'commit', commitId: PARENT_COMMIT_ID },
          targetRef: 'refs/heads/main',
          expectedTargetHead: {
            commitId: HEAD_COMMIT_ID,
            revision: REF_REVISION,
          },
          reason: 'Undo imported change',
        },
        { dryRun: true, includeDiagnostics: true },
      ),
    );
    await expectActionResult(`Rollback staged for ${shortCommitId(PARENT_COMMIT_ID)}`, 'success');
  });

  it('fails closed while refreshing stale surface status after rollback staging', async () => {
    const refreshedSurface = createDeferred<VersionSurfaceStatus>();
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(createRollbackSurfaceStatus({ revertEnabled: true }))
      .mockImplementationOnce(() => refreshedSurface.promise);
    const workbook = createRollbackWorkbook({ getSurfaceStatus });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await waitFor(() => expect(workbook.version.revert).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('version-history-action-result')).toHaveTextContent(
        'Refreshing version history',
      ),
    );
    expect(screen.getByTestId('version-history-action-result')).not.toHaveTextContent(
      `Rollback staged for ${shortCommitId(HEAD_COMMIT_ID)}`,
    );
    await waitFor(() => expect(getSurfaceStatus).toHaveBeenCalledTimes(2));
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      'Wait for the current version action to finish.',
    );

    await act(async () => {
      refreshedSurface.resolve(
        createRollbackSurfaceStatus({
          revertEnabled: true,
          current: {
            checkedOutCommitId: HEAD_COMMIT_ID,
            refHeadAtMaterialization: HEAD_COMMIT_ID,
            currentRefHeadId: LATEST_COMMIT_ID,
            stale: true,
            staleReason: 'refMoved',
          },
        }),
      );
      await refreshedSurface.promise;
    });

    await waitFor(() =>
      expect(screen.getByTestId('version-history-current-stale-status')).toBeVisible(),
    );
    await expectActionResult(`Rollback staged for ${shortCommitId(HEAD_COMMIT_ID)}`, 'success');
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      'main is stale because the branch head moved. Refresh before staging rollback.',
    );
  });

  it('surfaces stale-head rollback errors with expected and actual heads', async () => {
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({ revertEnabled: true }),
      revert: jest.fn(async () => failedStaleHead(HEAD_COMMIT_ID, LATEST_COMMIT_ID)),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await expectActionResult(
      `Version head changed before the request completed. Expected ${shortCommitId(
        HEAD_COMMIT_ID,
      )}, now ${shortCommitId(LATEST_COMMIT_ID)}. Refresh version history before retrying.`,
      'error',
    );
  });

  it('surfaces rejected rollback dry-run diagnostics from the result payload', async () => {
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({ revertEnabled: true }),
      revert: jest.fn(async () =>
        rejectedRollbackDryRun('Rollback is blocked while the target ref is stale.'),
      ),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await expectActionResult('Rollback is blocked while the target ref is stale.', 'error');
  });
});
