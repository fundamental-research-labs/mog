import type {
  AgentProposalSummary,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import type {
  ReviewProposalAccessProjectionDiagnostic,
  ReviewProposalAccessProjectionDiagnostics,
} from './ReviewProposalSurface';

export function reviewProposalAccessDiagnosticsFromSummaries({
  reviews,
  proposals,
}: {
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
}): ReviewProposalAccessProjectionDiagnostics | undefined {
  const reviewDiagnostics: Record<string, ReviewProposalAccessProjectionDiagnostic> = {};
  for (const review of reviews) {
    const diagnostic = reviewAccessDiagnosticFromSummary(review);
    if (diagnostic) reviewDiagnostics[review.id] = diagnostic;
  }

  const proposalDiagnostics: Record<string, ReviewProposalAccessProjectionDiagnostic> = {};
  for (const proposal of proposals) {
    const diagnostic = proposalAccessDiagnosticFromSummary(proposal);
    if (diagnostic) proposalDiagnostics[proposal.id] = diagnostic;
  }

  return Object.keys(reviewDiagnostics).length > 0 || Object.keys(proposalDiagnostics).length > 0
    ? { reviews: reviewDiagnostics, proposals: proposalDiagnostics }
    : undefined;
}

type AccessDiagnosticKind =
  | 'access-denied'
  | 'provider-unavailable'
  | 'review-not-found'
  | 'proposal-not-found';

type DiagnosticLike = {
  readonly code: string;
  readonly data?: unknown;
  readonly payload?: unknown;
  readonly details?: unknown;
  readonly reason?: unknown;
  readonly target?: unknown;
};

function reviewAccessDiagnosticFromSummary(
  review: WorkbookVersionReviewRecordSummary,
): ReviewProposalAccessProjectionDiagnostic | undefined {
  const providerDiagnostic = providerAccessDiagnosticFromSummary('review', review);
  if (providerDiagnostic) return providerDiagnostic;
  return review.status === 'stale' ? staleReviewAccessDiagnostic() : undefined;
}

function proposalAccessDiagnosticFromSummary(
  proposal: AgentProposalSummary,
): ReviewProposalAccessProjectionDiagnostic | undefined {
  const providerDiagnostic = providerAccessDiagnosticFromSummary('proposal', proposal);
  if (providerDiagnostic) return providerDiagnostic;
  return proposal.status === 'stale' ? staleProposalAccessDiagnostic() : undefined;
}

function providerAccessDiagnosticFromSummary(
  kind: 'review' | 'proposal',
  summary: unknown,
): ReviewProposalAccessProjectionDiagnostic | undefined {
  for (const diagnostic of summaryDiagnostics(summary)) {
    const diagnosticKind = classifyProviderDiagnostic(kind, diagnostic);
    if (diagnosticKind) return accessDiagnosticForKind(kind, diagnosticKind);
  }
  return undefined;
}

function accessDiagnosticForKind(
  kind: 'review' | 'proposal',
  diagnosticKind: AccessDiagnosticKind,
): ReviewProposalAccessProjectionDiagnostic {
  if (diagnosticKind === 'access-denied') {
    return kind === 'review'
      ? {
          state: 'denied',
          code: 'VERSION_REVIEW_ACCESS_DENIED',
          severity: 'error',
          reason: 'access-denied',
          message: 'Review details are not available for the current caller.',
        }
      : {
          state: 'denied',
          code: 'VERSION_PROPOSAL_ACCESS_DENIED',
          severity: 'error',
          reason: 'access-denied',
          message: 'Proposal details are not available for the current caller.',
        };
  }

  if (diagnosticKind === 'review-not-found') {
    return {
      state: 'denied',
      code: 'VERSION_REVIEW_NOT_FOUND',
      severity: 'warning',
      reason: 'review-not-found',
      message: 'Review details are not available because the review could not be found.',
    };
  }

  if (diagnosticKind === 'provider-unavailable') {
    return kind === 'review'
      ? {
          state: 'unavailable',
          code: 'VERSION_REVIEW_PROVIDER_UNAVAILABLE',
          severity: 'warning',
          reason: 'provider-unavailable',
          message: 'Review details are temporarily unavailable.',
        }
      : {
          state: 'unavailable',
          code: 'VERSION_PROPOSAL_PROVIDER_UNAVAILABLE',
          severity: 'warning',
          reason: 'provider-unavailable',
          message: 'Proposal details are temporarily unavailable.',
        };
  }

  return {
    state: 'denied',
    code: 'VERSION_PROPOSAL_NOT_FOUND',
    severity: 'warning',
    reason: 'proposal-not-found',
    message: 'Proposal details are not available because the proposal could not be found.',
  };
}

function staleReviewAccessDiagnostic(): ReviewProposalAccessProjectionDiagnostic {
  return {
    state: 'stale',
    code: 'VERSION_REVIEW_STALE',
    severity: 'warning',
    reason: 'stale',
    message: 'Review is stale; create a new review before applying changes.',
  };
}

function staleProposalAccessDiagnostic(): ReviewProposalAccessProjectionDiagnostic {
  return {
    state: 'stale',
    code: 'VERSION_PROPOSAL_STALE',
    severity: 'warning',
    reason: 'stale',
    message:
      'Proposal is stale because the target branch moved. Review remains read-only until a new proposal or merge is created.',
  };
}

function summaryDiagnostics(summary: unknown): readonly DiagnosticLike[] {
  if (!isRecord(summary) || !Array.isArray(summary.diagnostics)) return [];

  const diagnostics: DiagnosticLike[] = [];
  for (const diagnostic of summary.diagnostics) {
    if (!isRecord(diagnostic)) continue;
    const code = diagnosticCode(diagnostic);
    if (!code) continue;
    diagnostics.push({
      code,
      data: diagnostic.data,
      payload: diagnostic.payload,
      details: diagnostic.details,
      reason: diagnostic.reason,
      target: diagnostic.target,
    });
  }
  return diagnostics;
}

function diagnosticCode(diagnostic: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof diagnostic.code === 'string') return diagnostic.code;
  if (typeof diagnostic.issueCode === 'string') return diagnostic.issueCode;
  return undefined;
}

function classifyProviderDiagnostic(
  kind: 'review' | 'proposal',
  diagnostic: DiagnosticLike,
): AccessDiagnosticKind | undefined {
  const tokens = diagnosticTokens(diagnostic);
  const notFound = tokens.some(isNotFoundToken);
  if (kind === 'review' && notFound && tokens.some(isReviewToken)) return 'review-not-found';
  if (kind === 'proposal' && notFound && tokens.some(isProposalToken)) {
    return 'proposal-not-found';
  }
  if (tokens.some(isAccessDeniedToken)) return 'access-denied';
  if (tokens.some(isProviderUnavailableToken)) return 'provider-unavailable';
  return undefined;
}

function diagnosticTokens(diagnostic: DiagnosticLike): readonly string[] {
  const tokens: string[] = [diagnostic.code];
  collectTokenValue(diagnostic.reason, tokens);
  collectTokenValue(diagnostic.target, tokens);
  collectTokenValue(diagnostic.data, tokens);
  collectTokenValue(diagnostic.payload, tokens);
  collectTokenValue(diagnostic.details, tokens);
  return tokens.map(normalizeDiagnosticToken).filter((token) => token.length > 0);
}

function collectTokenValue(value: unknown, tokens: string[], key?: string): void {
  if (typeof value === 'string') {
    if (!key || isDiagnosticTokenKey(key)) tokens.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTokenValue(item, tokens);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    collectTokenValue(child, tokens, childKey);
  }
}

function isDiagnosticTokenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'code' ||
    normalized === 'issuecode' ||
    normalized === 'kind' ||
    normalized === 'reason' ||
    normalized === 'status' ||
    normalized === 'target'
  );
}

function normalizeDiagnosticToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s.:/]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isNotFoundToken(token: string): boolean {
  return token === 'not-found' || token.includes('not-found') || token.includes('notfound');
}

function isReviewToken(token: string): boolean {
  return token.includes('review');
}

function isProposalToken(token: string): boolean {
  return token.includes('proposal');
}

function isAccessDeniedToken(token: string): boolean {
  return (
    token.includes('access-denied') ||
    token.includes('authorization-denied') ||
    token.includes('capability-denied') ||
    token.includes('permission-denied') ||
    token.includes('provider-denial') ||
    token.includes('provider-denied') ||
    token.includes('not-authorized') ||
    token.includes('unauthorized') ||
    token.includes('forbidden')
  );
}

function isProviderUnavailableToken(token: string): boolean {
  return (
    token.includes('unavailable') &&
    (token.includes('provider') ||
      token.includes('service') ||
      token.includes('method') ||
      token.includes('store') ||
      token.includes('workspace') ||
      token.includes('review') ||
      token.includes('proposal'))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
