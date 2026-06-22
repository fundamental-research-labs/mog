import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  VersionCapability,
  VersionRecordRevision,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const PARENT_COMMIT_ID = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;
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
];

describe('VersionHistoryPanelContent', () => {
  it('loads version status, head, and recent commits, then refreshes through wb.version', async () => {
    const workbook = createWorkbook();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    expect(await screen.findByText('Initial import')).toBeInTheDocument();
    expect(screen.getByText('Calculated forecast')).toBeInTheDocument();
    expect(screen.getByText('scenario/budget')).toBeInTheDocument();
    expect(screen.getByText('authoring')).toBeInTheDocument();
    expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getHead).toHaveBeenCalledTimes(1);
    expect(workbook.version.listCommits).toHaveBeenCalledWith({
      pageSize: 20,
      includeDiagnostics: true,
    });
    expect(workbook.version.listRefs).toHaveBeenCalledWith({ includeDiagnostics: true });
    expect(
      screen.getByRole('button', {
        name: `Diff ${shortCommitId(PARENT_COMMIT_ID)} against parent`,
      }),
    ).toBeDisabled();

    await user.click(screen.getByTestId('panel-version-history-refresh'));
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));
  });

  it('shows partial version diagnostics without dropping available commit history', async () => {
    const workbook = createWorkbook({
      getHead: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getHead',
          diagnostics: [
            {
              code: 'VERSION_GRAPH_UNINITIALIZED',
              severity: 'warning',
              message: 'Graph not initialized.',
            },
          ],
        },
      })),
    });

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    expect(await screen.findByText('Initial import')).toBeInTheDocument();
    expect(screen.getByText('Graph not initialized.')).toBeInTheDocument();
  });

  it('calls the close handler from the panel close affordance', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={createWorkbook()} onClose={onClose} />);

    await screen.findByText('Initial import');
    await user.click(screen.getByTestId('panel-version-history-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps commit, branch, checkout, and diff controls disabled when capabilities are unavailable', async () => {
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          disabledCapabilities: [
            'version:commit',
            'version:branch',
            'version:checkout',
            'version:diff',
          ],
        }),
      ),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');
    await user.type(screen.getByLabelText('Branch name'), 'refs/heads/review');

    const commitButton = screen.getByRole('button', { name: /^Commit$/ });
    const branchButton = screen.getByRole('button', { name: 'Create branch' });
    const checkoutButton = screen.getByRole('button', { name: 'Checkout scenario/budget' });
    const diffButton = screen.getByRole('button', {
      name: `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
    });

    expect(commitButton).toBeDisabled();
    expect(commitButton).toHaveAccessibleDescription('version:commit is not available.');
    expect(screen.getByText('version:commit is not available.')).toBeVisible();
    expect(branchButton).toBeDisabled();
    expect(branchButton).toHaveAccessibleDescription('version:branch is not available.');
    expect(screen.getByText('version:branch is not available.')).toBeVisible();
    expect(checkoutButton).toBeDisabled();
    expect(checkoutButton).toHaveAccessibleDescription('version:checkout is not available.');
    expect(screen.getByText('version:checkout is not available.')).toBeVisible();
    expect(diffButton).toBeDisabled();
    expect(diffButton).toHaveAccessibleDescription('version:diff is not available.');
    expect(screen.getByText('version:diff is not available.')).toBeVisible();
  });

  it('shows dirty checkout, stale commit, and parentless diff disabled reasons', async () => {
    const checkoutUnsafeReason = {
      code: 'version.surfaceStatus.dirtyWorkingState',
      severity: 'warning' as const,
      message: 'Workbook has uncommitted local changes; checkout would discard them.',
    };
    const workbook = createWorkbook({
      getSurfaceStatus: jest.fn(async () =>
        createSurfaceStatus({
          current: { stale: true, staleReason: 'refMoved' },
          dirty: {
            hasUncommittedLocalChanges: true,
            checkoutSafe: false,
            unsafeReasons: [checkoutUnsafeReason],
            diagnostics: [checkoutUnsafeReason],
          },
        }),
      ),
    });
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');
    await user.type(screen.getByLabelText('Commit message'), 'Checkpoint');

    const commitButton = screen.getByRole('button', { name: /^Commit$/ });
    const checkoutButton = screen.getByRole('button', { name: 'Checkout scenario/budget' });
    const rootDiffButton = screen.getByRole('button', {
      name: `Diff ${shortCommitId(PARENT_COMMIT_ID)} against parent`,
    });

    expect(commitButton).toBeDisabled();
    expect(commitButton).toHaveAccessibleDescription(
      'main is stale because the branch head moved. Refresh before committing.',
    );
    expect(
      screen.getByText('main is stale because the branch head moved. Refresh before committing.'),
    ).toBeVisible();
    expect(checkoutButton).toBeDisabled();
    expect(checkoutButton).toHaveAccessibleDescription(checkoutUnsafeReason.message);
    expect(screen.getByText(checkoutUnsafeReason.message)).toBeVisible();
    expect(rootDiffButton).toBeDisabled();
    expect(rootDiffButton).toHaveAccessibleDescription('Root commits do not have a parent diff.');
    expect(screen.getByText('Root commits do not have a parent diff.')).toBeVisible();
  });

  it('calls commit, createBranch, checkout, and parent diff through workbook.version', async () => {
    const workbook = createWorkbook();
    const user = userEvent.setup();

    render(<VersionHistoryPanelContent workbook={workbook} onClose={jest.fn()} />);

    await screen.findByText('Calculated forecast');

    await user.type(screen.getByLabelText('Commit message'), 'Snapshot before review');
    await user.click(screen.getByRole('button', { name: /^Commit$/ }));
    await waitFor(() =>
      expect(workbook.version.commit).toHaveBeenCalledWith({
        message: 'Snapshot before review',
        expectedHead: {
          commitId: HEAD_COMMIT_ID,
          revision: REF_REVISION,
        },
      }),
    );
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(2));

    await user.click(
      screen.getByLabelText(`Use ${shortCommitId(PARENT_COMMIT_ID)} as branch target`),
    );
    await user.type(screen.getByLabelText('Branch name'), 'refs/heads/review');
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
    await waitFor(() =>
      expect(workbook.version.createBranch).toHaveBeenCalledWith({
        name: 'refs/heads/review',
        targetCommitId: PARENT_COMMIT_ID,
        expectedAbsent: true,
      }),
    );
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(3));

    await user.click(screen.getByRole('button', { name: 'Checkout scenario/budget' }));
    await waitFor(() =>
      expect(workbook.version.checkout).toHaveBeenCalledWith(
        {
          kind: 'ref',
          name: 'refs/heads/scenario/budget',
        },
        { includeDiagnostics: true },
      ),
    );
    await waitFor(() => expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(4));

    await user.click(
      screen.getByRole('button', {
        name: `Diff ${shortCommitId(HEAD_COMMIT_ID)} against parent`,
      }),
    );
    await waitFor(() =>
      expect(workbook.version.diff).toHaveBeenCalledWith(PARENT_COMMIT_ID, HEAD_COMMIT_ID, {
        pageSize: 50,
        includeDiagnostics: true,
      }),
    );
    expect(await screen.findByTestId('version-history-parent-diff')).toHaveTextContent(
      'cells value',
    );
  });
});

function createWorkbook(
  overrides: Partial<VersionHistoryWorkbook['version']> = {},
): VersionHistoryWorkbook {
  const version = {
    getSurfaceStatus: jest.fn(async () => createSurfaceStatus()),
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
          {
            id: HEAD_COMMIT_ID,
            parents: [PARENT_COMMIT_ID],
            createdAt: '2026-06-22T10:10:00.000Z',
            author: { redacted: false, displayName: 'Reviewer' },
            annotation: { title: { kind: 'text', value: 'Calculated forecast' } },
          },
          {
            id: PARENT_COMMIT_ID,
            parents: [],
            createdAt: '2026-06-22T10:00:00.000Z',
            author: { redacted: false, displayName: 'Reviewer' },
            annotation: { title: { kind: 'text', value: 'Initial import' } },
          },
        ],
        limit: 20,
      },
    })),
    listRefs: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          {
            name: 'refs/heads/main',
            commitId: HEAD_COMMIT_ID,
            revision: REF_REVISION,
          },
          {
            name: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            revision: { kind: 'counter', value: '2' },
          },
        ],
        limit: 2,
      },
    })),
    commit: jest.fn(async () => ({
      ok: true,
      value: {
        id: HEAD_COMMIT_ID,
        parents: [PARENT_COMMIT_ID],
        createdAt: '2026-06-22T10:15:00.000Z',
        author: { redacted: false, displayName: 'Reviewer' },
        annotation: { title: { kind: 'text', value: 'Snapshot before review' } },
      },
    })),
    createBranch: jest.fn(
      async (options: Parameters<VersionHistoryWorkbook['version']['createBranch']>[0]) => ({
        ok: true,
        value: {
          name: options.name,
          commitId: options.targetCommitId,
          revision: { kind: 'counter', value: '3' },
        },
      }),
    ),
    checkout: jest.fn(async () => ({
      ok: true,
      value: {
        status: 'success',
        materialization: 'planned',
        plan: {
          strategy: 'fullSnapshot',
          target: {
            kind: 'ref',
            refName: 'refs/heads/scenario/budget',
            commitId: PARENT_COMMIT_ID,
            refRevision: { kind: 'counter', value: '2' },
          },
          commitId: PARENT_COMMIT_ID,
          parentCommitIds: [],
          requiredDependencies: [],
          requiredDependencyCount: 0,
        },
        diagnostics: [],
        mutationGuarantee: 'no-workbook-mutation',
      },
    })),
    diff: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          {
            structural: {
              kind: 'metadata',
              changeId: 'change-1',
              domain: 'cells',
              entityId: 'sheet-1!A1',
              propertyPath: ['value'],
            },
            before: { kind: 'value', value: { kind: 'blank' } },
            after: { kind: 'value', value: '42' },
          },
        ],
        limit: 50,
        readRevision: { kind: 'counter', value: '4' },
        order: 'semantic-change-order',
      },
    })),
    ...overrides,
  };
  return { version } as unknown as VersionHistoryWorkbook;
}

function createSurfaceStatus({
  disabledCapabilities = [],
  current = {},
  dirty = {},
}: {
  readonly disabledCapabilities?: readonly VersionCapability[];
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
} = {}): VersionSurfaceStatus {
  const disabled = new Set<VersionCapability>(['version:revert', ...disabledCapabilities]);

  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled: true,
    storage: {
      ready: true,
      backend: 'memory',
      diagnostics: [],
    },
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
      ALL_CAPABILITIES.map((capability) => [
        capability,
        disabled.has(capability)
          ? {
              enabled: false,
              dependency: capability === 'version:revert' ? 'upstreamRevertContract' : 'VC-05',
              reason: `${capability} is not available.`,
              retryable: false,
            }
          : { enabled: true },
      ]),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

function shortCommitId(id: string): string {
  return id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12);
}
