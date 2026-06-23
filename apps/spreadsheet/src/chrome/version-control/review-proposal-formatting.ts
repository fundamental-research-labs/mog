import type { AgentProposalSummary, VersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  CapabilityState,
  ReviewProposalAccessProjectionDiagnostic,
  ReviewProposalAccessProjectionState,
  SummaryRowDataAttributes,
} from './review-proposal-types';

export function capabilityFallbackMessage(label: string): string {
  return label === 'Merge apply' ? 'Merge apply is unavailable.' : `${label} are unavailable.`;
}

export function firstDiagnosticMessage(
  diagnostics: readonly VersionDiagnostic[],
): string | undefined {
  return diagnostics[0]?.message;
}

export function accessDiagnosticData(
  diagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): Pick<
  SummaryRowDataAttributes,
  | 'accessProjection'
  | 'accessDiagnosticCode'
  | 'accessDiagnosticSeverity'
  | 'hiddenChangeCount'
  | 'redactedChangeCount'
  | 'omittedDomainCount'
> {
  if (!diagnostic) return {};
  return {
    accessProjection: diagnostic.state,
    accessDiagnosticCode: diagnostic.code,
    accessDiagnosticSeverity: diagnostic.severity,
    hiddenChangeCount: countDataAttribute(diagnostic.hiddenChangeCount),
    redactedChangeCount: countDataAttribute(diagnostic.redactedChangeCount),
    omittedDomainCount: countDataAttribute(diagnostic.omittedDomainCount),
  };
}

export function accessDiffBlockedReason(
  kind: 'review' | 'proposal',
  accessDiagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): string | undefined {
  if (
    !accessDiagnostic ||
    (accessDiagnostic.state !== 'denied' && accessDiagnostic.state !== 'unavailable')
  ) {
    return undefined;
  }
  return sanitizeVersionStatusText(
    accessDiagnostic.message,
    accessProjectionFallbackMessage(kind, accessDiagnostic.state),
  );
}

export function proposalAcceptAvailable(
  proposal: AgentProposalSummary,
  acceptState: CapabilityState | undefined,
  proposalSurfaceAvailable: boolean,
  accessDiagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): boolean {
  return (
    proposalSurfaceAvailable &&
    acceptState?.enabled === true &&
    (!accessDiagnostic || accessDiagnostic.state === 'visible') &&
    Boolean(proposal.proposalCommitId) &&
    proposal.status === 'ready_for_review'
  );
}

export function accessProjectionStateLabel(
  kind: 'review' | 'proposal',
  state: ReviewProposalAccessProjectionState,
): string {
  if (state === 'denied') return 'Diff denied';
  if (state === 'partial') return 'Diff partially hidden';
  if (state === 'stale') return kind === 'review' ? 'Review stale' : 'Proposal stale';
  if (state === 'unavailable')
    return kind === 'review' ? 'Review unavailable' : 'Proposal unavailable';
  return 'Diff visible';
}

export function accessProjectionFactText(
  diagnostic: ReviewProposalAccessProjectionDiagnostic,
): string | undefined {
  const facts = [
    countLabel('Hidden', diagnostic.hiddenChangeCount),
    countLabel('Redacted', diagnostic.redactedChangeCount),
    countLabel('Domains', diagnostic.omittedDomainCount),
  ].filter((fact): fact is string => Boolean(fact));
  if (diagnostic.domains && diagnostic.domains.length > 0) {
    const domains = diagnostic.domains
      .map((domain) => sanitizeVersionStatusText(domain, '[redacted]'))
      .filter((domain): domain is string => Boolean(domain));
    if (domains.length > 0) facts.push(`Scope ${domains.join(', ')}`);
  }
  return facts.length > 0 ? facts.join(' · ') : undefined;
}

export function accessProjectionFallbackMessage(
  kind: 'review' | 'proposal',
  state: ReviewProposalAccessProjectionState,
): string {
  if (state === 'denied') {
    return kind === 'review'
      ? 'Review details are not available for the current caller.'
      : 'Proposal details are not available for the current caller.';
  }
  if (state === 'stale') {
    return kind === 'review'
      ? 'Review is stale; create a new review before applying changes.'
      : 'Proposal is stale. Review remains read-only until a new proposal or merge is created.';
  }
  if (state === 'unavailable') {
    return kind === 'review'
      ? 'Review details are temporarily unavailable.'
      : 'Proposal details are temporarily unavailable.';
  }
  return kind === 'review'
    ? 'Review diff is partially hidden.'
    : 'Proposal diff is partially hidden.';
}

export function shouldDescribeAccessDiagnostic(
  diagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): boolean {
  return Boolean(diagnostic && diagnostic.state !== 'visible');
}

function countLabel(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value}`;
}

export function countDataAttribute(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export function accessDiagnosticDomId(kind: 'review' | 'proposal', id: string): string {
  return `version-${kind}-${safeRecordDomId(id)}-access-diagnostic`;
}

function safeRecordDomId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

const REDACTED_VERSION_REF = '[version ref]';
const REDACTED_PRINCIPAL = '[principal]';
const REDACTED_COMMIT = '[commit]';
const REDACTED_PENDING_REMOTE_SEGMENT = '[pending remote segment]';
const REDACTED_SYNC_BATCH = '[sync batch]';

export function sanitizeVersionStatusText(
  value: string | undefined,
  fallback: string,
): string | undefined {
  const message = value?.trim() ?? '';
  if (message.length === 0) return undefined;
  const redacted = redactSensitiveVersionDiagnosticText(message).replace(/\s+/g, ' ').trim();
  return redacted.length > 0 ? redacted : fallback;
}

export function sanitizeDiagnosticDataText(value: string | undefined): string | undefined {
  return sanitizeVersionStatusText(value, 'redacted');
}

function redactSensitiveVersionDiagnosticText(message: string): string {
  return message
    .replace(
      /["']?\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b["']?\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal\b\s+(?:"[^"]*"|'[^']*'|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|principal:[^\s,;)}]+|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(/\brefs\/[^\s"'`<>),;]+/g, REDACTED_VERSION_REF)
    .replace(/\bcommit:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_COMMIT)
    .replace(/\bpending-remote-segment:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_PENDING_REMOTE_SEGMENT)
    .replace(/\bsync-batch-status:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_SYNC_BATCH);
}

export function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

export function displayRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}
