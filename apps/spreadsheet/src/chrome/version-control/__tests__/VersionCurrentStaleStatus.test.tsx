import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import type {
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionCurrentStaleStatus } from '../VersionCurrentStaleStatus';

const HEAD_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const LATEST_COMMIT_ID = `commit:sha256:${'e'.repeat(64)}` as WorkbookCommitId;
const RAW_PROVIDER_REF = 'refs/provider-internal/principal:user-42/main';
const RAW_PRINCIPAL_ID = 'principal:user-42@example.test';

describe('VersionCurrentStaleStatus', () => {
  it('projects stale checkout through public labels without raw ref or commit payloads', () => {
    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          current: {
            branchName: RAW_PROVIDER_REF,
            checkedOutCommitId: HEAD_COMMIT_ID,
            refHeadAtMaterialization: HEAD_COMMIT_ID,
            currentRefHeadId: LATEST_COMMIT_ID,
            stale: true,
            staleReason: 'refMoved',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-status-code',
      'version.surfaceStatus.currentStale.refMoved',
    );
    expect(staleStatus).not.toHaveAttribute('data-checked-out-commit-id');
    expect(staleStatus).not.toHaveAttribute('data-latest-commit-id');
    expect(staleStatus).toHaveTextContent(
      'Current checkout is stale because the branch head moved.',
    );
    expect(staleStatus).not.toHaveTextContent(RAW_PROVIDER_REF);
    expect(staleStatus).not.toHaveTextContent(HEAD_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent(LATEST_COMMIT_ID);
    expect(staleStatus).not.toHaveTextContent('aaaaaaaaaaaa');
    expect(staleStatus).not.toHaveTextContent('eeeeeeeeeeee');
  });

  it('projects pending remote promotion through stable public status copy', () => {
    const pendingRemotePromotion = pendingProviderWritesDiagnostic({
      message: `Remote promotion for ${RAW_PROVIDER_REF} by ${RAW_PRINCIPAL_ID} is pending.`,
      data: {
        pendingRemoteSegmentCount: 1,
        providerRef: RAW_PROVIDER_REF,
        principalId: RAW_PRINCIPAL_ID,
      },
    });

    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          current: {
            stale: true,
            staleReason: 'activeSessionBehind',
          },
          dirty: {
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [pendingRemotePromotion],
            diagnostics: [pendingRemotePromotion],
          },
        })}
      />,
    );

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
    expect(staleStatus).not.toHaveTextContent('version.surfaceStatus.pendingRemotePromotion');
    expect(staleStatus).not.toHaveTextContent(RAW_PROVIDER_REF);
    expect(staleStatus).not.toHaveTextContent(RAW_PRINCIPAL_ID);
  });

  it('keeps validated public branch labels visible in stale checkout copy', () => {
    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          current: {
            branchName: 'refs/heads/scenario/budget',
            stale: true,
            staleReason: 'refMoved',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveTextContent(
      'Checkout from scenario/budget is stale because the branch head moved.',
    );
    expect(staleStatus).not.toHaveTextContent('refs/heads/scenario/budget');
  });

  it('keeps detached checkout copy detached even if a stale surface carries branch metadata', () => {
    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          current: {
            branchName: 'refs/heads/scenario/restored',
            detached: true,
            stale: true,
            staleReason: 'unknown',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveTextContent(
      'Detached checkout is stale because the current head could not be verified.',
    );
    expect(staleStatus).not.toHaveTextContent('scenario/restored');
    expect(staleStatus).not.toHaveTextContent('refs/heads/scenario/restored');
  });

  it('projects unknown provider state without rendering diagnostic payloads', () => {
    const providerReadFailed: VersionDiagnostic = {
      code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
      severity: 'warning',
      message: `Provider ${RAW_PROVIDER_REF} for ${RAW_PRINCIPAL_ID} could not be read.`,
      data: {
        providerRef: RAW_PROVIDER_REF,
        principalId: RAW_PRINCIPAL_ID,
      },
    };

    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          dirty: {
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [providerReadFailed],
            diagnostics: [providerReadFailed],
          },
          current: {
            stale: true,
            staleReason: 'unknown',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-status-code',
      'version.surfaceStatus.currentStale.unverifiedHead',
    );
    expect(staleStatus).toHaveAttribute(
      'data-reconciliation-code',
      'version.surfaceStatus.pendingProviderWritesUnknown',
    );
    expect(staleStatus).toHaveTextContent(
      'Provider write state is unknown; refresh after provider status settles.',
    );
    expect(staleStatus).not.toHaveTextContent('Remote reconciliation is pending.');
    expect(staleStatus).not.toHaveTextContent(providerReadFailed.message);
    expect(staleStatus).not.toHaveTextContent(RAW_PROVIDER_REF);
    expect(staleStatus).not.toHaveTextContent(RAW_PRINCIPAL_ID);
  });

  it('projects missing dirty status as a public refresh requirement', () => {
    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          current: {
            stale: true,
            staleReason: 'unknown',
          },
          dirty: {
            source: undefined as never,
            checkoutPreflightToken: '',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-reconciliation-code',
      'version.surfaceStatus.dirtyStatusUnavailable',
    );
    expect(staleStatus).toHaveTextContent(
      'Dirty status is unavailable; refresh version status before continuing.',
    );
    expect(staleStatus).not.toHaveTextContent('VC-05');
  });

  it('projects non-promotion provider writes as settling state', () => {
    const providerWrites = pendingProviderWritesDiagnostic({
      message: `Provider ${RAW_PROVIDER_REF} writes are in flight for ${RAW_PRINCIPAL_ID}.`,
      data: {
        remoteSyncApplyActiveCount: 1,
        providerRef: RAW_PROVIDER_REF,
        principalId: RAW_PRINCIPAL_ID,
      },
    });

    render(
      <VersionCurrentStaleStatus
        surface={createSurfaceStatus({
          dirty: {
            pendingProviderWrites: true,
            checkoutSafe: false,
            unsafeReasons: [providerWrites],
            diagnostics: [providerWrites],
          },
          current: {
            stale: true,
            staleReason: 'unknown',
          },
        })}
      />,
    );

    const staleStatus = screen.getByTestId('version-history-current-stale-status');
    expect(staleStatus).toHaveAttribute(
      'data-reconciliation-code',
      'version.surfaceStatus.pendingProviderWrites',
    );
    expect(staleStatus).toHaveTextContent('Provider writes are still settling.');
    expect(staleStatus).not.toHaveTextContent(providerWrites.message);
    expect(staleStatus).not.toHaveTextContent(RAW_PROVIDER_REF);
    expect(staleStatus).not.toHaveTextContent(RAW_PRINCIPAL_ID);
  });

  it('does not render when current checkout is not stale', () => {
    render(<VersionCurrentStaleStatus surface={createSurfaceStatus()} />);

    expect(screen.queryByTestId('version-history-current-stale-status')).not.toBeInTheDocument();
  });
});

function createSurfaceStatus({
  current = {},
  dirty = {},
}: {
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirty?: Partial<VersionSurfaceStatus['dirty']>;
} = {}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled: true,
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
    capabilities: {} as VersionSurfaceStatus['capabilities'],
    diagnostics: [],
  };
}

function pendingProviderWritesDiagnostic({
  message,
  data,
}: {
  readonly message: string;
  readonly data: VersionDiagnostic['data'];
}): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.pendingProviderWrites',
    severity: 'warning',
    message,
    data,
  };
}
