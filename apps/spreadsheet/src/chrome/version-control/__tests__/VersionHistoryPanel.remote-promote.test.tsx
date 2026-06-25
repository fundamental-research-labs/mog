import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, screen, waitFor } from '@testing-library/react';
import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  createDeferred,
  expectActionResult,
  expectDisabledButtonReason,
  renderVersionHistoryPanel,
  type VersionHistoryWorkbook,
} from './VersionHistoryPanel.test-utils';
import {
  PENDING_REMOTE_BACKLOG_MESSAGE,
  PENDING_REMOTE_SEGMENT_ID,
  PROMOTED_COMMIT_ID,
  createRemotePromotionSurfaceStatus,
  createRemotePromotionWorkbook,
  disabledCapabilityState,
  pendingProviderWritesDiagnostic,
  successfulRemotePromotionResult,
} from './VersionHistoryPanel.remote-promote.test-utils';

describe('VersionHistoryPanelContent pending remote promotion', () => {
  it('shows pending remote backlog status and promotes it through workbook.version', async () => {
    const pendingProviderWrites = pendingProviderWritesDiagnostic(PENDING_REMOTE_BACKLOG_MESSAGE, {
      pendingRemoteSegmentCount: 1,
    });
    const workbook = createRemotePromotionWorkbook({
      surface: createRemotePromotionSurfaceStatus({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [pendingProviderWrites],
          diagnostics: [pendingProviderWrites],
        },
      }),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

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

  it('shows remote promote disabled reason from the surface capability', async () => {
    const reason = 'Host policy denies version:remotePromote.';
    const workbook = createRemotePromotionWorkbook({
      surface: createRemotePromotionSurfaceStatus({
        capabilityOverrides: {
          'version:remotePromote': disabledCapabilityState(reason, 'hostCapability', false),
        },
      }),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');

    const promoteButton = screen.getByRole('button', { name: 'Promote remote' });
    expectDisabledButtonReason(promoteButton, reason);
    expect(screen.getByTestId('version-history-remote-promote-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(
      screen.getByTestId('version-history-capability-version-remotePromote'),
    ).toHaveAccessibleName(`Remote promote unavailable: ${reason}`);

    await user.click(promoteButton);
    expect(workbook.version.promotePendingRemote).not.toHaveBeenCalled();
  });

  it('fails closed while refreshing capability status after remote promotion', async () => {
    const pendingProviderWrites = pendingProviderWritesDiagnostic(PENDING_REMOTE_BACKLOG_MESSAGE, {
      pendingRemoteSegmentCount: 1,
    });
    const refreshedReason = 'Remote promotion is disabled until the provider reconnects.';
    const refreshedSurface = createDeferred<VersionSurfaceStatus>();
    const getSurfaceStatus = jest
      .fn<VersionHistoryWorkbook['version']['getSurfaceStatus']>()
      .mockResolvedValueOnce(
        createRemotePromotionSurfaceStatus({
          dirty: {
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [pendingProviderWrites],
            diagnostics: [pendingProviderWrites],
          },
        }),
      )
      .mockImplementationOnce(() => refreshedSurface.promise);
    const workbook = createRemotePromotionWorkbook({ getSurfaceStatus });
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByRole('button', { name: 'Promote remote' }));

    await waitFor(() =>
      expect(workbook.version.promotePendingRemote).toHaveBeenCalledWith({
        includeDiagnostics: true,
      }),
    );
    await waitFor(() => expect(getSurfaceStatus).toHaveBeenCalledTimes(2));
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Promote remote' }),
      'Wait for the current version action to finish.',
    );

    await act(async () => {
      refreshedSurface.resolve(
        createRemotePromotionSurfaceStatus({
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
    const pendingProviderWrites = pendingProviderWritesDiagnostic(PENDING_REMOTE_BACKLOG_MESSAGE, {
      pendingRemoteSegmentCount: 1,
    });
    const promotion =
      createDeferred<
        Awaited<ReturnType<VersionHistoryWorkbook['version']['promotePendingRemote']>>
      >();
    const workbook = createRemotePromotionWorkbook({
      surface: createRemotePromotionSurfaceStatus({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [pendingProviderWrites],
          diagnostics: [pendingProviderWrites],
        },
      }),
      promotePendingRemote: jest.fn(() => promotion.promise),
    });
    const { user } = renderVersionHistoryPanel({ workbook });

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
      promotion.resolve(
        successfulRemotePromotionResult({
          promotedSegmentIds: [PENDING_REMOTE_SEGMENT_ID],
          commitIds: [PROMOTED_COMMIT_ID],
        }),
      );
      await promotion.promise;
    });
    await expectActionResult('Promoted 1 pending remote segment into 1 commit', 'success');
  });

  it('surfaces failed pending remote promotion diagnostics in the action result region', async () => {
    const workbook = createRemotePromotionWorkbook({
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
    const { user } = renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.click(screen.getByTestId('version-history-promote-remote-button'));

    await expectActionResult(
      'Pending remote promotion is blocked by a failed sync batch.',
      'error',
    );
  });
});
