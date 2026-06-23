import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  accessProjectionFactText,
  accessProjectionFallbackMessage,
  accessProjectionStateLabel,
  capabilityFallbackMessage,
  countDataAttribute,
  firstDiagnosticMessage,
  sanitizeDiagnosticDataText,
  sanitizeVersionStatusText,
  shortCommitId,
} from './review-proposal-formatting';
import type {
  CapabilityState,
  ReviewProposalAccessProjectionDiagnostic,
  VersionPanelDiagnostic,
} from './review-proposal-types';

export function ReviewProposalDiagnostics({
  surface,
  reviewState,
  proposalState,
  diffState,
  acceptState,
  reviewDiagnostic,
  proposalDiagnostic,
  showAcceptState,
  diffDisabledReason,
  diffDisabledReasonId,
}: {
  readonly surface?: VersionSurfaceStatus;
  readonly reviewState?: CapabilityState;
  readonly proposalState?: CapabilityState;
  readonly diffState?: CapabilityState;
  readonly acceptState?: CapabilityState;
  readonly reviewDiagnostic?: VersionPanelDiagnostic;
  readonly proposalDiagnostic?: VersionPanelDiagnostic;
  readonly showAcceptState: boolean;
  readonly diffDisabledReason?: string;
  readonly diffDisabledReasonId?: string;
}): React.JSX.Element {
  return (
    <>
      <CapabilityStatusRow
        kind="review"
        label="Reviews"
        capability="version:reviewRead"
        state={reviewState}
        diagnostic={reviewDiagnostic}
      />
      <CapabilityStatusRow
        kind="proposal"
        label="Proposals"
        capability="version:proposal"
        state={proposalState}
        diagnostic={proposalDiagnostic}
      />
      {showAcceptState && acceptState && !acceptState.enabled ? (
        <CapabilityStatusRow
          kind="merge-apply"
          label="Merge apply"
          capability="version:mergeApply"
          state={acceptState}
        />
      ) : null}
      {surface ? <DiffPersistenceEvidence surface={surface} diffState={diffState} /> : null}
      <DiffDisabledReason reasonId={diffDisabledReasonId} reason={diffDisabledReason} />
    </>
  );
}

function CapabilityStatusRow({
  kind,
  label,
  capability,
  state,
  diagnostic,
}: {
  readonly kind: 'review' | 'proposal' | 'merge-apply';
  readonly label: string;
  readonly capability: keyof VersionSurfaceStatus['capabilities'];
  readonly state?: CapabilityState;
  readonly diagnostic?: VersionPanelDiagnostic;
}): React.JSX.Element | null {
  if (!state && !diagnostic) return null;

  const enabled = state?.enabled === true && !diagnostic;
  const fallbackMessage = capabilityFallbackMessage(label);
  const message = sanitizeVersionStatusText(
    diagnostic?.message ?? (!state?.enabled ? state?.reason : undefined),
    fallbackMessage,
  );
  const stateLabel = enabled ? 'Available' : 'Unavailable';

  return (
    <div
      className="rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm"
      aria-label={`${label} status`}
      data-testid={`version-${kind}-status-row`}
      data-capability={capability}
      data-state={enabled ? 'available' : 'unavailable'}
      data-diagnostic-code={diagnostic?.code}
      data-diagnostic-severity={diagnostic?.severity}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">{label}</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">{stateLabel}</span>
      </div>
      {message ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid={`version-${kind}-unavailable-reason`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

function DiffPersistenceEvidence({
  surface,
  diffState,
}: {
  readonly surface: VersionSurfaceStatus;
  readonly diffState?: CapabilityState;
}): React.JSX.Element {
  const diffEnabled = diffState?.enabled === true;
  const storageLabel = `${surface.storage.backend} ${
    surface.storage.ready ? 'ready' : 'unavailable'
  }`;
  const storageReason = !surface.storage.ready
    ? sanitizeVersionStatusText(
        firstDiagnosticMessage(surface.storage.diagnostics),
        'Version storage is unavailable.',
      )
    : undefined;
  const diffReason = !diffEnabled
    ? sanitizeVersionStatusText(diffState?.reason, 'Diff service is unavailable.')
    : undefined;

  return (
    <div
      className="rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm"
      aria-label="Diff persistence evidence"
      data-testid="version-review-diff-persistence-evidence"
      data-storage-backend={surface.storage.backend}
      data-storage-ready={String(surface.storage.ready)}
      data-diff-enabled={String(diffEnabled)}
      data-current-head-id={surface.current.headCommitId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">Diff persistence</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">
          {diffEnabled ? 'Diff enabled' : 'Diff unavailable'}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Storage</span>
        <span className="text-ss-text truncate">{storageLabel}</span>
        <span className="text-ss-text-secondary">Head</span>
        <span className="font-mono text-ss-text truncate">
          {surface.current.headCommitId
            ? shortCommitId(surface.current.headCommitId)
            : 'Unavailable'}
        </span>
      </div>
      {storageReason ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid="version-review-diff-persistence-storage-reason"
        >
          {storageReason}
        </div>
      ) : null}
      {diffReason ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid="version-diff-unavailable-reason"
        >
          {diffReason}
        </div>
      ) : null}
    </div>
  );
}

function DiffDisabledReason({
  reasonId,
  reason,
}: {
  readonly reasonId?: string;
  readonly reason?: string;
}): React.JSX.Element | null {
  if (!reasonId || !reason) return null;

  return (
    <div
      id={reasonId}
      className="text-[11px] leading-snug text-ss-text-secondary"
      data-testid={reasonId}
    >
      {reason}
    </div>
  );
}

export function AccessProjectionDiagnosticBlock({
  kind,
  diagnostic,
  diagnosticId,
  messageId,
}: {
  readonly kind: 'review' | 'proposal';
  readonly diagnostic?: ReviewProposalAccessProjectionDiagnostic;
  readonly diagnosticId?: string;
  readonly messageId?: string;
}): React.JSX.Element | null {
  if (!diagnostic || diagnostic.state === 'visible') return null;

  const factText = accessProjectionFactText(diagnostic);
  const message = sanitizeVersionStatusText(
    diagnostic.message,
    accessProjectionFallbackMessage(kind, diagnostic.state),
  );
  const reason = sanitizeDiagnosticDataText(diagnostic.reason);

  return (
    <div
      id={diagnosticId}
      className="mt-1 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 py-1 text-[11px] leading-snug text-ss-text-secondary"
      data-testid={`version-${kind}-record-access-diagnostic`}
      data-access-projection={diagnostic.state}
      data-diagnostic-code={diagnostic.code}
      data-diagnostic-severity={diagnostic.severity}
      data-redaction-reason={reason}
      data-hidden-change-count={countDataAttribute(diagnostic.hiddenChangeCount)}
      data-redacted-change-count={countDataAttribute(diagnostic.redactedChangeCount)}
      data-omitted-domain-count={countDataAttribute(diagnostic.omittedDomainCount)}
    >
      <div className="font-medium text-ss-text">
        {accessProjectionStateLabel(kind, diagnostic.state)}
      </div>
      <div id={messageId}>{message}</div>
      {factText ? <div className="mt-0.5 text-ss-text-tertiary">{factText}</div> : null}
    </div>
  );
}
