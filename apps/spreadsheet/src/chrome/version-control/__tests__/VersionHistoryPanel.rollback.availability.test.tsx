import '@testing-library/jest-dom';

import { screen } from '@testing-library/react';

import {
  HEAD_COMMIT_ID,
  LATEST_COMMIT_ID,
  createRollbackSurfaceStatus,
  createRollbackWorkbook,
  disabledCapabilityState,
  expectDisabledButtonReason,
  renderRollbackPanel,
} from './VersionHistoryPanel.rollback.test-utils';

describe('VersionHistoryPanelContent rollback availability', () => {
  it('exposes stable rollback controls and the default disabled reason', async () => {
    renderRollbackPanel();

    await screen.findByText('Calculated forecast');

    expect(screen.getByTestId('version-history-rollback-reason-input')).toHaveAccessibleName(
      'Rollback reason',
    );
    expect(screen.getByTestId('version-history-rollback-target-summary')).toHaveAttribute(
      'data-version-commit-id',
      HEAD_COMMIT_ID,
    );
    expect(screen.getByTestId('version-history-stage-rollback-button')).toBeDisabled();
    expect(screen.getByTestId('version-history-stage-rollback-button')).toHaveAccessibleDescription(
      'Authored revert is reserved until an upstream revert contract exists.',
    );
    expect(screen.getByTestId('version-history-capability-version-revert')).toHaveAccessibleName(
      'Revert unavailable: Authored revert is reserved until an upstream revert contract exists.',
    );
  });

  it('shows access-denied rollback staging reason from the capability surface', async () => {
    const reason = 'Host policy denies version:revert.';
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({
        capabilityOverrides: {
          'version:revert': disabledCapabilityState(reason, 'hostCapability', false),
        },
      }),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');

    const rollbackButton = screen.getByRole('button', { name: 'Stage rollback' });
    expectDisabledButtonReason(rollbackButton, reason);

    await user.click(rollbackButton);
    expect(workbook.version.revert).not.toHaveBeenCalled();
  });

  it('shows emergency-disabled rollback staging reason and does not call revert', async () => {
    const reason = 'Emergency rollback disable is active for this workbook.';
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({
        capabilityOverrides: {
          'version:revert': disabledCapabilityState(reason, 'featureGate', false),
        },
      }),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');

    const rollbackButton = screen.getByRole('button', { name: 'Stage rollback' });
    expectDisabledButtonReason(rollbackButton, reason);

    await user.click(rollbackButton);
    expect(workbook.version.revert).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'provider writes are pending',
      surface: createRollbackSurfaceStatus({
        revertEnabled: true,
        dirty: { pendingProviderWrites: true },
      }),
      checkoutReason: 'Wait for provider writes to settle before checking out.',
      rollbackReason: 'Wait for provider writes to settle before staging rollback.',
    },
    {
      label: 'access is denied',
      surface: createRollbackSurfaceStatus({
        capabilityOverrides: {
          'version:checkout': disabledCapabilityState(
            'Host policy denies destructive version actions.',
            'hostCapability',
            false,
          ),
          'version:revert': disabledCapabilityState(
            'Host policy denies destructive version actions.',
            'hostCapability',
            false,
          ),
        },
      }),
      checkoutReason: 'Host policy denies destructive version actions.',
      rollbackReason: 'Host policy denies destructive version actions.',
    },
    {
      label: 'versioning is disabled',
      surface: createRollbackSurfaceStatus({ featureGateEnabled: false, revertEnabled: true }),
      checkoutReason: 'Versioning is disabled for this workbook.',
      rollbackReason: 'Versioning is disabled for this workbook.',
    },
  ])(
    'disables checkout and rollback with explicit status text when $label',
    async ({ surface, checkoutReason, rollbackReason }) => {
      const workbook = createRollbackWorkbook({ surface });
      const { user } = renderRollbackPanel({ workbook });

      await screen.findByText('Calculated forecast');
      await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');

      const checkoutButton = screen.getByRole('button', { name: 'Checkout main' });
      const rollbackButton = screen.getByRole('button', { name: 'Stage rollback' });
      expectDisabledButtonReason(checkoutButton, checkoutReason);
      expectDisabledButtonReason(rollbackButton, rollbackReason);

      await user.click(checkoutButton);
      await user.click(rollbackButton);
      expect(workbook.version.checkout).not.toHaveBeenCalled();
      expect(workbook.version.revert).not.toHaveBeenCalled();
    },
  );

  it('disables checkout and rollback staging when the current checkout session is stale', async () => {
    const workbook = createRollbackWorkbook({
      surface: createRollbackSurfaceStatus({
        revertEnabled: true,
        current: {
          checkedOutCommitId: HEAD_COMMIT_ID,
          refHeadAtMaterialization: HEAD_COMMIT_ID,
          currentRefHeadId: LATEST_COMMIT_ID,
          stale: true,
          staleReason: 'refMoved',
        },
      }),
    });
    const { user } = renderRollbackPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');

    const checkoutButton = screen.getByRole('button', { name: 'Checkout main' });
    const rollbackButton = screen.getByRole('button', { name: 'Stage rollback' });
    expectDisabledButtonReason(
      checkoutButton,
      'main is stale because the branch head moved. Checkout is blocked until the active checkout session is refreshed.',
    );
    expectDisabledButtonReason(
      rollbackButton,
      'main is stale because the branch head moved. Refresh before staging rollback.',
    );
    await user.click(checkoutButton);
    await user.click(rollbackButton);
    expect(workbook.version.checkout).not.toHaveBeenCalled();
    expect(workbook.version.revert).not.toHaveBeenCalled();
  });
});
