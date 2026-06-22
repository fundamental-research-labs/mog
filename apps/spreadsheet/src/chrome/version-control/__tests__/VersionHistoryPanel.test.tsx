import '@testing-library/jest-dom';

import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VersionCapability, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import { VersionHistoryPanelContent, type VersionHistoryWorkbook } from '../VersionHistoryPanel';

const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as const;
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
    expect(screen.getAllByText('aaaaaaaaaaaa')).toHaveLength(2);
    expect(screen.getByText('authoring')).toBeInTheDocument();
    expect(workbook.version.getSurfaceStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getStatus).toHaveBeenCalledTimes(1);
    expect(workbook.version.getHead).toHaveBeenCalledTimes(1);
    expect(workbook.version.listCommits).toHaveBeenCalledWith({
      pageSize: 20,
      includeDiagnostics: true,
    });

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
        id: COMMIT_ID,
        refName: 'refs/heads/main',
        refRevision: { kind: 'counter', value: '1' },
      },
    })),
    listCommits: jest.fn(async () => ({
      ok: true,
      value: {
        items: [
          {
            id: COMMIT_ID,
            parents: [],
            createdAt: '2026-06-22T10:00:00.000Z',
            author: { redacted: false, displayName: 'Reviewer' },
            annotation: { title: { kind: 'text', value: 'Initial import' } },
          },
        ],
        limit: 20,
      },
    })),
    ...overrides,
  };
  return { version } as unknown as VersionHistoryWorkbook;
}

function createSurfaceStatus(): VersionSurfaceStatus {
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
      headCommitId: COMMIT_ID,
      branchName: 'refs/heads/main',
      detached: false,
      stale: false,
    },
    dirty: {
      statusRevision: '1',
      checkoutPreflightToken: 'token-1',
      hasUncommittedLocalChanges: false,
      commitEligibleChanges: false,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
    },
    capabilities: Object.fromEntries(
      ALL_CAPABILITIES.map((capability) => [
        capability,
        capability === 'version:revert'
          ? {
              enabled: false,
              dependency: 'upstreamRevertContract',
              reason: 'Revert is not available.',
              retryable: false,
            }
          : { enabled: true },
      ]),
    ) as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}
