import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import type {
  VersionDiagnostic,
  VersionPromotePendingRemoteResult,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  ActionStatus,
  VersionActions,
  diagnosticFromRemotePromotionResult,
  getRemotePromotionStatus,
} from '../VersionActionStatus';

const RAW_REF = 'refs/provider-internal/sync/private-main';
const RAW_PRINCIPAL = 'principalId=alice@example.com';
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const SEGMENT_ID = `pending-remote-segment:sha256:${'b'.repeat(64)}` as const;

describe('VersionActionStatus', () => {
  it('redacts sensitive diagnostic payloads before rendering action errors', () => {
    render(
      <ActionStatus
        actionState={{
          status: 'error',
          diagnostic: {
            code: 'VERSION_CHECKOUT_PROVIDER_ERROR',
            severity: 'error',
            message: `Checkout blocked for ${RAW_REF} ${RAW_PRINCIPAL} {"principalTag":"finance-admin"} at ${COMMIT_ID}.`,
          },
        }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Checkout blocked');
    expect(alert).toHaveTextContent('[version ref]');
    expect(alert).toHaveTextContent('principal [principal]');
    expect(alert).toHaveTextContent('[commit]');
    expect(alert).not.toHaveTextContent(RAW_REF);
    expect(alert).not.toHaveTextContent('alice@example.com');
    expect(alert).not.toHaveTextContent('finance-admin');
    expect(alert).not.toHaveTextContent(COMMIT_ID);
  });

  it('prioritizes blocked remote promotion diagnostics before failed and degraded diagnostics', () => {
    const diagnostic = diagnosticFromRemotePromotionResult(
      'VERSION_UI_REMOTE_PROMOTE_REJECTED',
      promotionResult({
        diagnostics: [
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
            severity: 'error',
            reason: 'completion-failed',
            message: `Promotion failed while reading ${RAW_REF} for ${RAW_PRINCIPAL}.`,
          },
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_DEGRADED',
            severity: 'warning',
            message: 'Pending remote promotion degraded while reading provider metadata.',
          },
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
            severity: 'warning',
            reason: 'batch-status-terminal',
            message: `Pending remote promotion blocked on ${RAW_REF} for ${RAW_PRINCIPAL}.`,
          },
        ],
      }),
    );

    expect(diagnostic.code).toBe('VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED');
    expect(diagnostic.message).toContain('Pending remote promotion blocked');
    expect(diagnostic.message).toContain('[version ref]');
    expect(diagnostic.message).toContain('principal [principal]');
    expect(diagnostic.message).not.toContain(RAW_REF);
    expect(diagnostic.message).not.toContain('alice@example.com');
  });

  it('allows blocked skipped entries to outrank lower-priority diagnostics', () => {
    const diagnostic = diagnosticFromRemotePromotionResult(
      'VERSION_UI_REMOTE_PROMOTE_REJECTED',
      promotionResult({
        diagnostics: [
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_DEGRADED',
            severity: 'warning',
            message: 'Pending remote promotion degraded while reading provider metadata.',
          },
        ],
        skipped: [
          {
            segmentId: SEGMENT_ID,
            reason: 'batch-status-terminal',
            message: `Skipped blocked sync batch ${RAW_REF} principalTag=private-reviewer.`,
          },
        ],
      }),
    );

    expect(diagnostic.code).toBe('VERSION_UI_REMOTE_PROMOTE_REJECTED');
    expect(diagnostic.message).toContain('Skipped blocked sync batch');
    expect(diagnostic.message).not.toContain(RAW_REF);
    expect(diagnostic.message).not.toContain('private-reviewer');
  });

  it('redacts pending remote backlog details derived from surface diagnostics', () => {
    const status = getRemotePromotionStatus(
      surfaceStatus(
        diagnostic(`Remote writes are pending for ${RAW_REF} ${RAW_PRINCIPAL}.`, {
          pendingRemoteSegmentCount: 1,
        }),
      ),
    );

    expect(status.state).toBe('pending');
    expect(status.detail).toContain('[version ref]');
    expect(status.detail).toContain('principal [principal]');
    expect(status.detail).not.toContain(RAW_REF);
    expect(status.detail).not.toContain('alice@example.com');
  });

  it('redacts disabled reasons and remote backlog detail while rendering version actions', () => {
    render(
      <VersionActions
        commitMessage=""
        branchName=""
        rollbackReason=""
        actionState={{ status: 'idle' }}
        commitEnabled={false}
        branchEnabled
        rollbackEnabled
        remotePromoteEnabled={false}
        commitDisabledReason={`Commit blocked for ${RAW_REF} ${RAW_PRINCIPAL}.`}
        remotePromoteDisabledReason={`Remote promotion blocked for ${RAW_REF} principalTag=sync-admin.`}
        remotePromotionStatus={{
          state: 'pending',
          label: 'Pending',
          detail: `Backlog is pending for ${RAW_REF} ${RAW_PRINCIPAL}.`,
        }}
        onCommitMessageChange={noop}
        onBranchNameChange={noop}
        onRollbackReasonChange={noop}
        onCommit={noop}
        onCreateBranch={noop}
        onStageRollback={noop}
        onPromotePendingRemote={noop}
      />,
    );

    const actions = screen.getByRole('region', { name: 'Version actions' });
    expect(actions).toHaveTextContent('[version ref]');
    expect(actions).toHaveTextContent('principal [principal]');
    expect(actions).not.toHaveTextContent(RAW_REF);
    expect(actions).not.toHaveTextContent('alice@example.com');
    expect(actions).not.toHaveTextContent('sync-admin');
    expect(screen.getByRole('button', { name: 'Commit' })).toHaveAccessibleDescription(
      /Commit blocked/,
    );
    expect(screen.getByRole('button', { name: 'Promote remote' })).toHaveAccessibleDescription(
      /Remote promotion blocked/,
    );
  });
});

function promotionResult(
  overrides: Partial<VersionPromotePendingRemoteResult>,
): VersionPromotePendingRemoteResult {
  return {
    status: 'failed',
    promotedSegmentIds: [],
    commitIds: [],
    skipped: [],
    diagnostics: [],
    ...overrides,
  };
}

function diagnostic(message: string, data: VersionDiagnostic['data']): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.pendingProviderWrites',
    severity: 'warning',
    message,
    data,
  };
}

function surfaceStatus(pendingDiagnostic: VersionDiagnostic): VersionSurfaceStatus {
  return {
    capabilities: { 'version:remotePromote': { enabled: true } },
    dirty: {
      pendingProviderWrites: true,
      unsafeReasons: [pendingDiagnostic],
      diagnostics: [pendingDiagnostic],
    },
  } as unknown as VersionSurfaceStatus;
}

function noop(): void {}
