import type {
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommit, WorkbookCommitCompletenessDiagnostic } from './commit-store';
import type { VersionStoreDiagnostic } from './provider';

export type DiffServiceDiagnostic = PublicVersionStoreDiagnostic & {
  readonly code: string;
  readonly issueCode: string;
  readonly operation: 'diff';
  readonly selector?: 'base' | 'target';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type DiffServiceDegradedResult = Extract<
  WorkbookDiffPage,
  { readonly status: 'degraded' }
> & {
  readonly diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[];
};

export function diffCompletenessDiagnostics(
  commits: readonly WorkbookCommit[],
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
): readonly DiffServiceDiagnostic[] {
  const diagnostics: DiffServiceDiagnostic[] = [];
  for (const commit of commits) {
    const selector =
      commit.id === targetCommitId ? 'target' : commit.id === baseCommitId ? 'base' : null;
    if (!selector) continue;

    for (const source of commit.payload.completenessDiagnostics) {
      diagnostics.push(completenessDiagnostic(selector, source));
    }
  }
  return diagnostics;
}

export function graphDiagnostics(
  diagnostics: readonly { readonly code?: string; readonly message?: string }[],
  options: { readonly selector?: 'base' | 'target' } = {},
): readonly DiffServiceDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'VERSION_UNMATERIALIZABLE_COMMIT',
        'Version graph did not return a readable commit.',
        options,
      ),
    ];
  }
  return diagnostics.map((item) =>
    diagnostic(
      item.code ?? 'VERSION_PROVIDER_ERROR',
      item.message ?? 'Version graph read failed.',
      options,
    ),
  );
}

export function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: PublicVersionStoreDiagnostic['severity'];
    readonly recoverability?: PublicVersionStoreDiagnostic['recoverability'];
    readonly selector?: 'base' | 'target';
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): DiffServiceDiagnostic {
  return {
    code: issueCode,
    issueCode,
    severity: options.severity ?? (issueCode === 'VERSION_PROVIDER_ERROR' ? 'fatal' : 'error'),
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId:
      `version.diff.${issueCode}` as PublicVersionStoreDiagnostic['messageTemplateId'],
    safeMessage,
    redacted: true,
    operation: 'diff',
    ...(options.selector ? { selector: options.selector } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

export function degradedDiffPage(
  diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[],
): DiffServiceDegradedResult {
  return {
    status: 'degraded',
    items: [],
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics,
  };
}

function completenessDiagnostic(
  selector: 'base' | 'target',
  source: WorkbookCommitCompletenessDiagnostic,
): DiffServiceDiagnostic {
  const category = completenessCategory(source);
  return diagnostic(source.code, completenessSafeMessage(category), {
    severity: source.severity,
    recoverability: completenessRecoverability(category),
    selector,
    details: {
      category,
      completenessCode: source.code,
      completenessSeverity: source.severity,
      ...(source.path ? { path: source.path } : {}),
      ...sanitizeCompletenessDetails(source.details),
    },
  });
}

function completenessCategory(
  source: WorkbookCommitCompletenessDiagnostic,
): 'unsupported' | 'opaque' | 'stale' | 'subset-hidden' | 'incomplete' {
  const token = `${source.code} ${source.path ?? ''} ${source.message}`.toLowerCase();
  if (token.includes('opaque')) return 'opaque';
  if (token.includes('stale')) return 'stale';
  if (token.includes('visibility') || token.includes('hidden')) return 'subset-hidden';
  if (token.includes('unsupported')) return 'unsupported';
  return 'incomplete';
}

function completenessSafeMessage(category: ReturnType<typeof completenessCategory>): string {
  switch (category) {
    case 'unsupported':
      return 'The requested version diff includes unsupported semantic state.';
    case 'opaque':
      return 'The requested version diff includes opaque semantic state.';
    case 'stale':
      return 'The requested version diff includes stale semantic state evidence.';
    case 'subset-hidden':
      return 'The requested version diff includes subset-hidden semantic state.';
    case 'incomplete':
      return 'The requested version diff is incomplete for one endpoint commit.';
  }
}

function completenessRecoverability(
  category: ReturnType<typeof completenessCategory>,
): PublicVersionStoreDiagnostic['recoverability'] {
  return category === 'stale' ? 'retry' : 'unsupported';
}

function sanitizeCompletenessDetails(
  details: WorkbookCommitCompletenessDiagnostic['details'],
): Readonly<Record<string, string | number | boolean | null>> {
  if (!details) return {};
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isPayloadPrimitive(value)) payload[key] = value;
  }
  return payload;
}

function recoverabilityForIssue(issueCode: string): PublicVersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_PROVIDER_ERROR':
      return 'retry';
    case 'derivedImpactStale':
    case 'staleDiffCursor':
      return 'retry';
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
    case 'unsupportedDomain':
    case 'unsupportedFormat':
    case 'externalReferenceUnsupported':
    case 'opaqueDomain':
    case 'opaqueDomainDigestUnavailable':
    case 'opaqueFormatPointer':
    case 'indexKeyedVisibility':
    case 'indexKeyedRowVisibility':
    case 'indexKeyedColumnVisibility':
    case 'inconsistentVisibilityCache':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
