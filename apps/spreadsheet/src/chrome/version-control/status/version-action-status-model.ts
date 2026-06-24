import type {
  JsonValue,
  VersionDiagnostic,
  VersionPromotePendingRemoteResult,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import { sanitizeVersionStatusText } from '../availability/version-action-availability';
import type {
  VersionPanelDiagnostic,
  VersionRemotePromotionStatus,
} from './version-action-status-types';

export const VERSION_ACTION_UNAVAILABLE = 'Version action is unavailable.';

export function getRemotePromotionStatus(
  surface: VersionSurfaceStatus | undefined,
): VersionRemotePromotionStatus {
  if (!surface) {
    return {
      state: 'unavailable',
      label: 'Unavailable',
      detail: 'Version surface status is unavailable.',
    };
  }

  const remotePromoteState = surface.capabilities['version:remotePromote'];
  if (remotePromoteState?.enabled === false) {
    return {
      state: 'unavailable',
      label: 'Unavailable',
      detail: sanitizeVersionStatusText(
        remotePromoteState.reason,
        'Remote promotion is unavailable.',
      ),
    };
  }

  const providerWriteDiagnostic = firstPendingProviderWritesDiagnostic(surface);
  const counts = providerWriteDiagnostic ? pendingRemoteCounts(providerWriteDiagnostic.data) : {};
  const detail = sanitizeVersionStatusText(
    providerWriteDiagnostic?.message,
    'Provider writes are pending.',
  );

  if ((counts.pendingRemotePromotionActiveCount ?? 0) > 0) {
    return {
      state: 'running',
      label: 'Running',
      detail: detail ?? 'Pending remote promotion is already running.',
    };
  }

  if (
    (counts.pendingRemoteSegmentCount ?? 0) > 0 ||
    (counts.pendingRemotePromotionQueuedCount ?? 0) > 0
  ) {
    const pendingSegmentCount = counts.pendingRemoteSegmentCount ?? 0;
    const queuedCount = counts.pendingRemotePromotionQueuedCount ?? 0;
    return {
      state: 'pending',
      label: 'Pending',
      detail:
        detail ??
        formatPendingRemoteDetail({
          pendingRemoteSegmentCount: pendingSegmentCount,
          pendingRemotePromotionQueuedCount: queuedCount,
        }),
    };
  }

  if (surface.dirty.pendingProviderWrites) {
    return {
      state: 'pending',
      label: 'Pending',
      detail: detail ?? 'Provider writes are pending.',
    };
  }

  return {
    state: 'ready',
    label: 'Ready',
  };
}

export function remotePromotionActionMessage(result: VersionPromotePendingRemoteResult): string {
  const promoted = result.promotedSegmentIds.length;
  const skipped = result.skipped.length;
  if (result.status === 'partial') {
    return `Promoted ${formatCount(promoted, 'pending remote segment')}; skipped ${skipped}`;
  }
  if (promoted === 0) return 'No pending remote changes to promote';
  return `Promoted ${formatCount(promoted, 'pending remote segment')} into ${formatCount(
    result.commitIds.length,
    'commit',
  )}`;
}

export function diagnosticFromRemotePromotionResult(
  code: string,
  result: VersionPromotePendingRemoteResult,
): VersionPanelDiagnostic {
  const candidate = firstRemotePromotionDiagnosticCandidate(code, result);
  if (candidate) return sanitizeVersionPanelDiagnostic(candidate.diagnostic);
  return sanitizeVersionPanelDiagnostic({
    code,
    severity: 'warning',
    message: remotePromotionFallbackMessage(result.status),
  });
}

export function sanitizeVersionPanelDiagnostic(
  diagnostic: VersionPanelDiagnostic,
): VersionPanelDiagnostic {
  return {
    ...diagnostic,
    message:
      sanitizeVersionStatusText(diagnostic.message, fallbackDiagnosticMessage(diagnostic)) ??
      fallbackDiagnosticMessage(diagnostic),
  };
}

export function remotePromotionStatusFallbackDetail(
  state: VersionRemotePromotionStatus['state'],
): string {
  if (state === 'running') return 'Pending remote promotion is already running.';
  if (state === 'pending') return 'Provider writes are pending.';
  if (state === 'unavailable') return 'Remote promotion is unavailable.';
  return '';
}

type RemotePromotionDiagnosticCandidate = {
  readonly diagnostic: VersionPanelDiagnostic;
  readonly categoryRank: number;
  readonly severityRank: number;
  readonly codeRank: string;
  readonly index: number;
};

function firstRemotePromotionDiagnosticCandidate(
  code: string,
  result: VersionPromotePendingRemoteResult,
): RemotePromotionDiagnosticCandidate | undefined {
  const candidates: RemotePromotionDiagnosticCandidate[] = [];
  result.diagnostics.forEach((diagnostic, index) => {
    if (diagnostic.message.trim().length === 0) return;
    candidates.push(
      remotePromotionDiagnosticCandidate(
        {
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.message,
        },
        diagnostic.reason,
        index,
      ),
    );
  });
  const skippedOffset = result.diagnostics.length;
  result.skipped.forEach((skipped, index) => {
    if (skipped.message.trim().length === 0) return;
    candidates.push(
      remotePromotionDiagnosticCandidate(
        {
          code,
          severity: 'warning',
          message: skipped.message,
        },
        skipped.reason,
        skippedOffset + index,
      ),
    );
  });
  return candidates.sort(compareRemotePromotionDiagnosticCandidates)[0];
}

function remotePromotionDiagnosticCandidate(
  diagnostic: VersionPanelDiagnostic,
  reason: string | undefined,
  index: number,
): RemotePromotionDiagnosticCandidate {
  return {
    diagnostic,
    categoryRank: diagnosticCategoryRank(diagnostic, reason),
    severityRank: severityRank(diagnostic.severity),
    codeRank: diagnostic.code,
    index,
  };
}

function compareRemotePromotionDiagnosticCandidates(
  left: RemotePromotionDiagnosticCandidate,
  right: RemotePromotionDiagnosticCandidate,
): number {
  return (
    left.categoryRank - right.categoryRank ||
    left.severityRank - right.severityRank ||
    left.codeRank.localeCompare(right.codeRank) ||
    left.index - right.index
  );
}

function diagnosticCategoryRank(
  diagnostic: VersionPanelDiagnostic,
  reason: string | undefined,
): number {
  const normalized = `${diagnostic.code} ${reason ?? ''} ${diagnostic.message}`.toLowerCase();
  if (normalized.includes('blocked') || normalized.includes('terminal')) return 0;
  if (
    normalized.includes('failed') ||
    normalized.includes('failure') ||
    normalized.includes('error')
  ) {
    return 1;
  }
  if (normalized.includes('degraded')) return 2;
  return 3;
}

function severityRank(severity: VersionPanelDiagnostic['severity']): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function fallbackDiagnosticMessage(diagnostic: VersionPanelDiagnostic): string {
  if (diagnosticCategoryRank(diagnostic, undefined) === 0) {
    return 'Version action is blocked.';
  }
  if (diagnostic.severity === 'error') return 'Version action failed.';
  return VERSION_ACTION_UNAVAILABLE;
}

function remotePromotionFallbackMessage(
  status: VersionPromotePendingRemoteResult['status'],
): string {
  if (status === 'failed') return 'Pending remote promotion failed.';
  if (status === 'partial')
    return 'Pending remote promotion completed with skipped backlog entries.';
  return 'Pending remote promotion did not promote any backlog entries.';
}

function firstPendingProviderWritesDiagnostic(
  surface: VersionSurfaceStatus,
): VersionDiagnostic | undefined {
  return [...surface.dirty.unsafeReasons, ...surface.dirty.diagnostics].find(
    (diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites',
  );
}

function pendingRemoteCounts(data: Readonly<Record<string, JsonValue>> | undefined): {
  readonly pendingRemoteSegmentCount?: number;
  readonly pendingRemotePromotionActiveCount?: number;
  readonly pendingRemotePromotionQueuedCount?: number;
} {
  if (!data) return {};
  return {
    pendingRemoteSegmentCount: numberValue(data['pendingRemoteSegmentCount']),
    pendingRemotePromotionActiveCount: numberValue(data['pendingRemotePromotionActiveCount']),
    pendingRemotePromotionQueuedCount: numberValue(data['pendingRemotePromotionQueuedCount']),
  };
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatPendingRemoteDetail({
  pendingRemoteSegmentCount,
  pendingRemotePromotionQueuedCount,
}: {
  readonly pendingRemoteSegmentCount: number;
  readonly pendingRemotePromotionQueuedCount: number;
}): string {
  const parts: string[] = [];
  if (pendingRemoteSegmentCount > 0) {
    parts.push(
      `${pendingRemoteSegmentCount} pending remote ${pendingRemoteSegmentCount === 1 ? 'segment' : 'segments'}`,
    );
  }
  if (pendingRemotePromotionQueuedCount > 0) {
    parts.push(
      `${pendingRemotePromotionQueuedCount} queued ${pendingRemotePromotionQueuedCount === 1 ? 'promotion' : 'promotions'}`,
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'Pending remote promotion is queued.';
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}
