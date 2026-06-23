import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionRecordRevision,
  VersionResult,
  VersionSurfaceStatus,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';
import { shortCommitId } from '../version-history-format';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'c'.repeat(64)}` as WorkbookCommitId;
const REF_REVISION: VersionRecordRevision = { kind: 'counter', value: '1' };
const ALL_CAPABILITIES: readonly VersionCapability[] = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
];

describe('VersionHistoryPanelContent rollback staging', () => {
  it('exposes stable rollback controls and the default disabled reason', async () => {
    render(<VersionHistoryPanelContent workbook={createWorkbook()} onClose={jest.fn()} />);

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
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        capabilityOverrides: {
          'version:revert': disabledCapabilityState(reason, 'hostCapability', false),
        },
      }),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');

    const rollbackButton = screen.getByRole('button', { name: 'Stage rollback' });
    expectDisabledButtonReason(rollbackButton, reason);

    await user.click(rollbackButton);
    expect(workbook.version.revert).not.toHaveBeenCalled();
  });

  it('shows emergency-disabled rollback staging reason and does not call revert', async () => {
    const reason = 'Emergency rollback disable is active for this workbook.';
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
        capabilityOverrides: {
          'version:revert': disabledCapabilityState(reason, 'featureGate', false),
        },
      }),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
      surface: createSurfaceStatus({
        revertEnabled: true,
        dirty: { pendingProviderWrites: true },
      }),
      checkoutReason: 'Wait for provider writes to settle before checking out.',
      rollbackReason: 'Wait for provider writes to settle before staging rollback.',
    },
    {
      label: 'access is denied',
      surface: createSurfaceStatus({
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
      surface: createSurfaceStatus({ featureGateEnabled: false, revertEnabled: true }),
      checkoutReason: 'Versioning is disabled for this workbook.',
      rollbackReason: 'Versioning is disabled for this workbook.',
    },
  ])(
    'disables checkout and rollback with explicit status text when $label',
    async ({ surface, checkoutReason, rollbackReason }) => {
      const workbook = createWorkbook({ surface });
      const user = userEvent.setup();

      render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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

  it('stages rollback dry-run for the selected commit through workbook.version.revert', async () => {
    const workbook = createWorkbook({ surface: createSurfaceStatus({ revertEnabled: true }) });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
      .mockResolvedValueOnce(createSurfaceStatus({ revertEnabled: true }))
      .mockImplementationOnce(() => refreshedSurface.promise);
    const workbook = createWorkbook({ getSurfaceStatus });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await expectActionResult(`Rollback staged for ${shortCommitId(HEAD_COMMIT_ID)}`, 'success');
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      'Enter a rollback reason.',
    );

    await user.click(screen.getByRole('button', { name: 'Refresh version history' }));
    await waitFor(() => expect(getSurfaceStatus).toHaveBeenCalledTimes(2));
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      'Version status is refreshing.',
    );

    await act(async () => {
      refreshedSurface.resolve(
        createSurfaceStatus({
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
    expectDisabledButtonReason(
      screen.getByRole('button', { name: 'Stage rollback' }),
      'main is stale because the branch head moved. Refresh before staging rollback.',
    );
  });

  it('surfaces stale-head rollback errors with expected and actual heads', async () => {
    const workbook = createWorkbook({
      surface: createSurfaceStatus({ revertEnabled: true }),
      revert: jest.fn(async () => failedStaleHead(HEAD_COMMIT_ID, LATEST_COMMIT_ID)),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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
    const workbook = createWorkbook({
      surface: createSurfaceStatus({ revertEnabled: true }),
      revert: jest.fn(async () => ({
        ok: true,
        value: {
          schemaVersion: 1,
          status: 'rejected',
          target: { kind: 'commit', commitId: HEAD_COMMIT_ID },
          diagnostics: [
            {
              issueCode: 'VERSION_REVERT_BLOCKED' as VersionStoreDiagnostic['issueCode'],
              severity: 'warning',
              recoverability: 'retry',
              messageTemplateId:
                'version.revert.blocked' as VersionStoreDiagnostic['messageTemplateId'],
              safeMessage: 'Rollback is blocked while the target ref is stale.',
              redacted: true,
              mutationGuarantee: 'ref-not-mutated',
            },
          ],
          mutationGuarantee: 'ref-not-mutated',
        },
      })),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Rollback reason'), 'Undo imported change');
    await user.click(screen.getByRole('button', { name: 'Stage rollback' }));

    await expectActionResult('Rollback is blocked while the target ref is stale.', 'error');
  });

  it('disables checkout and rollback staging when the current checkout session is stale', async () => {
    const workbook = createWorkbook({
      surface: createSurfaceStatus({
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
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

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

function createWorkbook({
  surface = createSurfaceStatus(),
  getSurfaceStatus,
  revert,
}: {
  readonly surface?: VersionSurfaceStatus;
  readonly getSurfaceStatus?: VersionHistoryWorkbook['version']['getSurfaceStatus'];
  readonly revert?: VersionHistoryWorkbook['version']['revert'];
} = {}): VersionHistoryWorkbook {
  const version = {
    getSurfaceStatus: getSurfaceStatus ?? jest.fn(async () => surface),
    getStatus: jest.fn(async () => ({ schemaVersion: 1, rolloutStage: 'headless-local' })),
    getHead: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        refName: 'refs/heads/main',
        refRevision: REF_REVISION,
      },
    })),
    listCommits: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          commit(HEAD_COMMIT_ID, [PARENT_COMMIT_ID], 'Calculated forecast'),
          commit(PARENT_COMMIT_ID, [], 'Initial import'),
        ],
        limit: 20,
      },
    })),
    listRefs: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          { name: 'refs/heads/main', commitId: HEAD_COMMIT_ID, revision: REF_REVISION },
          {
            name: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            revision: { kind: 'counter', value: '2' },
          },
        ],
        limit: 2,
      },
    })),
    listReviews: jest.fn(async () => ({ ok: true, value: { items: [], limit: 5 } })),
    listProposals: jest.fn(async () => ({ ok: true, value: { items: [], limit: 5 } })),
    commit: jest.fn(),
    createBranch: jest.fn(),
    checkout: jest.fn(),
    promotePendingRemote: jest.fn(async () => ({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [],
        diagnostics: [],
      },
    })),
    diff: jest.fn(),
    revert:
      revert ??
      jest.fn(async (input: Parameters<VersionHistoryWorkbook['version']['revert']>[0]) => ({
        ok: true,
        value: {
          schemaVersion: 1,
          status: 'planned',
          target: input.target,
          diagnostics: [],
          mutationGuarantee: 'no-write-attempted',
        },
      })),
  };
  return { version } as unknown as VersionHistoryWorkbook;
}

function createSurfaceStatus({
  revertEnabled = false,
  featureGateEnabled = true,
  current = {},
  dirty = {},
  capabilityOverrides = {},
}: {
  readonly revertEnabled?: boolean;
  readonly featureGateEnabled?: boolean;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
  readonly capabilityOverrides?: Partial<Record<VersionCapability, VersionCapabilityState>>;
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled,
    storage: { ready: true, backend: 'memory', diagnostics: [] },
    current: {
      headCommitId: HEAD_COMMIT_ID,
      branchName: 'refs/heads/main',
      detached: false,
      stale: false,
      ...current,
    },
    dirty: {
      statusRevision: '1',
      checkoutPreflightToken: 'token-1',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: true,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
      ...dirty,
    },
    capabilities: Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => {
        const override = capabilityOverrides[capability];
        if (override) return [capability, override];
        if (capability === 'version:revert' && !revertEnabled) {
          return [
            capability,
            disabledCapabilityState(
              'Authored revert is reserved until an upstream revert contract exists.',
              'upstreamRevertContract',
              false,
            ),
          ];
        }
        return [capability, { enabled: true } satisfies VersionCapabilityState];
      }),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

function commit(id: WorkbookCommitId, parents: WorkbookCommitId[], title: string) {
  return {
    id,
    parents,
    createdAt: '2026-06-22T10:10:00.000Z',
    author: { redacted: false, displayName: 'Reviewer' },
    annotation: { title: { kind: 'text', value: title } },
  };
}

function disabledCapabilityState(
  reason: string,
  dependency: VersionCapabilityDependency,
  retryable: boolean,
): VersionCapabilityState {
  return { enabled: false, dependency, reason, retryable };
}

function failedStaleHead<T = never>(
  expectedHeadId: WorkbookCommitId,
  actualHeadId: WorkbookCommitId,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_head', expectedHeadId, actualHeadId },
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function expectActionResult(message: string, status: 'success' | 'error'): Promise<void> {
  await waitFor(() => {
    const result = screen.getByTestId('version-history-action-result');
    expect(result).toHaveAttribute('data-status', status);
    expect(result).toHaveTextContent(message);
  });
}

function expectDisabledButtonReason(button: HTMLElement, reason: string): void {
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  expect(screen.getAllByText(reason)[0]).toBeVisible();
}

function branchTargetTestId(commitId: string): string {
  return `version-history-branch-target-${safeDomId(commitId)}`;
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
