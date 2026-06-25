import '@testing-library/jest-dom';

import { screen } from '@testing-library/react';

import { HEAD_COMMIT_ID, renderVersionHistoryPanel } from './VersionHistoryPanel.test-utils';
import {
  LATEST_REMOTE_COMMIT_ID,
  createRemotePromotionSurfaceStatus,
  createRemotePromotionWorkbook,
  pendingProviderWritesDiagnostic,
} from './VersionHistoryPanel.remote-promote.test-utils';

describe('VersionHistoryPanelContent remote stale status projection', () => {
  it('projects stale current status through stable redacted codes', async () => {
    const rawProviderRef = 'refs/provider-internal/main';
    const workbook = createRemotePromotionWorkbook({
      surface: createRemotePromotionSurfaceStatus({
        current: {
          branchName: rawProviderRef,
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_REMOTE_COMMIT_ID,
          stale: true,
          staleReason: 'refMoved',
        },
      }),
    });

    renderVersionHistoryPanel({ workbook });

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
    expect(staleStatus).not.toHaveTextContent('version.surfaceStatus.currentStale.refMoved');
    expect(staleStatus).not.toHaveTextContent(rawProviderRef);
    expect(staleStatus).not.toHaveTextContent(HEAD_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent(LATEST_REMOTE_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent('aaaaaaaaaaaa');
    expect(staleStatus).not.toHaveTextContent('eeeeeeeeeeee');

    const statusSummary = screen.getByRole('region', { name: 'Version status' });
    expect(statusSummary).toHaveTextContent('Detached or unavailable');
    expect(statusSummary).not.toHaveTextContent(rawProviderRef);
    expect(statusSummary).not.toHaveTextContent('refs/heads/refs/provider-internal/main');
  });

  it('projects stale pending remote reconciliation through stable redacted codes', async () => {
    const rawProviderRef = 'refs/provider-internal/sync/main';
    const pendingPromotion = pendingProviderWritesDiagnostic('Remote promotion is pending.', {
      pendingRemotePromotionActiveCount: 1,
      providerRef: rawProviderRef,
      providerKind: 'provider-yjs',
    });
    const workbook = createRemotePromotionWorkbook({
      surface: createRemotePromotionSurfaceStatus({
        current: {
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_REMOTE_COMMIT_ID,
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

    renderVersionHistoryPanel({ workbook });

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
    expect(staleStatus).toHaveTextContent('Remote reconciliation is pending.');
    expect(staleStatus).not.toHaveTextContent(
      'version.surfaceStatus.currentStale.activeSessionBehind',
    );
    expect(staleStatus).not.toHaveTextContent('version.surfaceStatus.pendingRemotePromotion');
    expect(staleStatus).not.toHaveTextContent(rawProviderRef);
    expect(staleStatus).not.toHaveTextContent('provider-yjs');
  });
});
