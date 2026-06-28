import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';

import {
  createSurfaceStatus,
  createWorkbook,
  diffEntry,
  failedInvalidState,
  renderVersionHistoryPanel,
  workingTreeDiffPage,
} from './VersionHistoryPanel.test-utils';

describe('VersionHistoryPanelContent working-tree diff', () => {
  it('loads and renders a live working-tree diff when the workbook is dirty', async () => {
    const diffWorkingTree = jest.fn(async () => ({
      ok: true as const,
      value: workingTreeDiffPage([diffEntry()]),
    }));
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          dirty: {
            hasUncommittedLocalChanges: true,
            commitEligibleChanges: true,
          },
        }),
      ),
      diffWorkingTree,
    });

    renderVersionHistoryPanel({ workbook });

    const viewer = await screen.findByTestId('version-history-working-tree-diff-viewer');
    expect(diffWorkingTree).toHaveBeenCalledWith({ pageSize: 50, includeDiagnostics: true });
    expect(viewer).toHaveAccessibleName('Working tree diff viewer');
    expect(viewer).toHaveAttribute('data-state', 'changes');
    expect(viewer).toHaveTextContent('Uncommitted changes');
    expect(viewer).toHaveTextContent('working tree');
    expect(within(viewer).getByTestId('version-history-working-tree-diff-change-list')).toHaveTextContent(
      '42',
    );
    expect(within(viewer).queryByRole('button', { name: /stage/i })).not.toBeInTheDocument();
  });

  it('does not call diffWorkingTree for a clean workbook', async () => {
    const diffWorkingTree = jest.fn(async () => ({
      ok: true as const,
      value: workingTreeDiffPage([]),
    }));
    const workbook = createWorkbook({ diffWorkingTree });

    renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    expect(diffWorkingTree).not.toHaveBeenCalled();
    expect(screen.queryByTestId('version-history-working-tree-diff-viewer')).not.toBeInTheDocument();
  });

  it('renders blocked working-tree diagnostics without staging controls', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          dirty: {
            hasUncommittedLocalChanges: true,
            commitEligibleChanges: true,
          },
        }),
      ),
      diffWorkingTree: jest.fn(async () =>
        failedInvalidState('Working-tree diff is blocked until recalculation settles.'),
      ),
    });

    renderVersionHistoryPanel({ workbook });

    const blocked = await screen.findByTestId('version-history-working-tree-diff-blocked');
    await waitFor(() =>
      expect(blocked).toHaveTextContent(
        'Working-tree diff is blocked until recalculation settles.',
      ),
    );
    expect(within(blocked).queryByRole('button', { name: /stage/i })).not.toBeInTheDocument();
  });

  it('suppresses a stale dirty working-tree diagnostic when the fenced surface is clean', async () => {
    const dirtySurface = createSurfaceStatus({
      dirty: {
        statusRevision: 'dirty:before-checkout',
        checkoutPreflightToken: 'token:before-checkout',
        hasUncommittedLocalChanges: true,
        commitEligibleChanges: true,
      },
    });
    const cleanSurface = createSurfaceStatus({
      dirty: {
        statusRevision: 'dirty:after-checkout',
        checkoutPreflightToken: 'token:after-checkout',
        hasUncommittedLocalChanges: false,
        commitEligibleChanges: false,
        checkoutSafe: true,
      },
    });
    const getSurfaceStatus = jest
      .fn()
      .mockResolvedValueOnce(dirtySurface)
      .mockResolvedValueOnce(cleanSurface);
    const diffWorkingTree = jest.fn(async () =>
      failedInvalidState(
        'Working-tree diff has dirty workbook state but no captured mutation basis.',
      ),
    );
    const workbook = createWorkbook({
      getSurfaceStatus,
      diffWorkingTree,
    });

    renderVersionHistoryPanel({ workbook });

    await screen.findByText('Calculated forecast');
    await waitFor(() => expect(getSurfaceStatus).toHaveBeenCalledTimes(2));
    expect(diffWorkingTree).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Uncommitted changes')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('version-history-working-tree-diff-blocked'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'Working-tree diff has dirty workbook state but no captured mutation basis.',
      ),
    ).not.toBeInTheDocument();
  });
});
