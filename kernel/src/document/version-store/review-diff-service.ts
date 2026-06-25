import type {
  VersionDiagnostic,
  VersionDiffDisplay,
  VersionDiffEntry,
  VersionDiffValue,
  VersionGetReviewDiffInput,
  PageCursor,
  VersionResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookVersionReviewDiffChange,
  WorkbookVersionReviewDiffChangeKind,
  WorkbookVersionReviewDiffPage,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionDiffService, type WorkbookVersionDiffMetadataPage } from './diff-service';
import type { VersionStoreProvider } from './provider';

const DEFAULT_REVIEW_DIFF_LIMIT = 50;

export interface WorkbookVersionReviewDiffService {
  getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>>;
}

export function createWorkbookVersionReviewDiffService(options: {
  readonly provider: VersionStoreProvider;
}): WorkbookVersionReviewDiffService {
  return new ProviderBackedWorkbookVersionReviewDiffService(options);
}

class ProviderBackedWorkbookVersionReviewDiffService implements WorkbookVersionReviewDiffService {
  private readonly provider: VersionStoreProvider;
  private readonly diffService: WorkbookVersionDiffService;

  constructor(options: { readonly provider: VersionStoreProvider }) {
    this.provider = options.provider;
    this.diffService = new WorkbookVersionDiffService({ provider: options.provider });
  }

  async getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    if (!input.baseCommitId || !input.headCommitId) {
      return invalidState(
        'missing_review_diff_commits',
        'Review diff projection requires resolved baseCommitId and headCommitId.',
      );
    }

    const upstream = await this.diffService.diffWithMetadata(
      { kind: 'commit', id: input.baseCommitId },
      { kind: 'commit', id: input.headCommitId },
      {
        pageSize: input.limit ?? DEFAULT_REVIEW_DIFF_LIMIT,
        ...(input.cursor ? { pageToken: input.cursor } : {}),
        ...(input.includeDerivedImpact === undefined
          ? {}
          : { includeDerivedImpact: input.includeDerivedImpact }),
      },
    );
    if (upstream.status === 'degraded') {
      return targetUnavailable('getReviewDiff', upstream.diagnostics);
    }

    return ok(projectReviewDiffPage(input, upstream, this.provider.documentScope.documentId));
  }
}

function projectReviewDiffPage(
  input: VersionGetReviewDiffInput,
  upstream: Extract<WorkbookVersionDiffMetadataPage, { readonly status: 'success' }>,
  documentId: string,
): WorkbookVersionReviewDiffPage {
  const projected = upstream.items.map((entry) =>
    projectReviewDiffChange(entry, upstream, documentId),
  );
  const changes = projected.filter(
    (change): change is WorkbookVersionReviewDiffChange => change !== null,
  );
  const redactedChanges = projected.length - changes.length;
  const diagnostics = input.includeDerivedImpact
    ? [
        diagnostic(
          'VERSION_REVIEW_DERIVED_IMPACT_UNAVAILABLE',
          'info',
          'Derived-impact review diff projection is not available for this semantic diff page.',
        ),
      ]
    : [];

  return {
    schemaVersion: 1,
    source: 'semantic-diff',
    baseCommitId: upstream.baseCommitId,
    headCommitId: upstream.targetCommitId,
    changeSetDigest: upstream.changeSetDigest,
    ...(input.reviewId ? { reviewId: input.reviewId } : {}),
    changes,
    ...(input.includeDerivedImpact ? { derivedImpact: [] } : {}),
    summary: {
      authoredChanges: changes.length,
      derivedChanges: 0,
      redactedChanges,
      ...(upstream.nextPageToken ? {} : { totalChanges: changes.length + redactedChanges }),
    },
    ...(upstream.nextPageToken
      ? { nextCursor: upstream.nextPageToken as unknown as PageCursor }
      : {}),
    limit: input.limit ?? DEFAULT_REVIEW_DIFF_LIMIT,
    diagnostics,
    upstreamDiff: upstreamDiffPage(upstream, input.limit ?? DEFAULT_REVIEW_DIFF_LIMIT),
  };
}

function upstreamDiffPage(
  upstream: Extract<WorkbookVersionDiffMetadataPage, { readonly status: 'success' }>,
  limit: number,
): VersionSemanticDiffPage {
  return {
    items: upstream.items,
    ...(upstream.nextPageToken
      ? { nextCursor: upstream.nextPageToken as unknown as PageCursor }
      : {}),
    limit,
    readRevision: upstream.readRevision,
    order: upstream.order,
  };
}

function projectReviewDiffChange(
  entry: VersionDiffEntry,
  upstream: Extract<WorkbookVersionDiffMetadataPage, { readonly status: 'success' }>,
  documentId: string,
): WorkbookVersionReviewDiffChange | null {
  const structural = entry.structural;
  if (structural.kind !== 'metadata') return null;
  const propertyPath = [...structural.propertyPath];
  const displayRef = displayRefFrom(entry.display);
  const entityId = structural.entityId;

  return {
    target: {
      kind: 'semanticChange',
      changeSetDigest: upstream.changeSetDigest,
      changeId: structural.changeId,
      entityKind: structural.domain,
      entityId,
      propertyPath,
      derived: false,
    },
    owner: structural.domain,
    entity: {
      kind: structural.domain,
      workbookId: documentId,
      ...(sheetIdFromEntityId(entityId) ? { sheetId: sheetIdFromEntityId(entityId) } : {}),
      id: entityId,
      ...(displayRef ? { displayRef } : {}),
    },
    propertyPath,
    kind: changeKind(entry.before, entry.after, propertyPath),
    before: entry.before,
    after: entry.after,
    derived: false,
    diagnostics: mapVersionDiagnostics(entry.diagnostics ?? []),
  };
}

function changeKind(
  before: VersionDiffValue,
  after: VersionDiffValue,
  propertyPath: readonly string[],
): WorkbookVersionReviewDiffChangeKind {
  if (propertyPath.length === 1 && propertyPath[0] === 'order') return 'reorder';
  if (isEmptyDiffValue(before) && !isEmptyDiffValue(after)) return 'create';
  if (!isEmptyDiffValue(before) && isEmptyDiffValue(after)) return 'delete';
  return 'update';
}

function isEmptyDiffValue(value: VersionDiffValue): boolean {
  return (
    value.kind === 'value' &&
    (value.value === null ||
      (typeof value.value === 'object' &&
        value.value !== null &&
        !Array.isArray(value.value) &&
        value.value.kind === 'blank'))
  );
}

function displayRefFrom(display: VersionDiffDisplay | undefined): string | undefined {
  const address = displayValue(display?.address);
  if (address) return address;
  return displayValue(display?.entityLabel);
}

function displayValue(
  value: VersionDiffDisplay[keyof VersionDiffDisplay] | undefined,
): string | undefined {
  return value?.kind === 'value' ? value.value : undefined;
}

function sheetIdFromEntityId(entityId: string): string | undefined {
  const separator = entityId.indexOf('!');
  return separator > 0 ? entityId.slice(0, separator) : undefined;
}

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function invalidState<T>(state: string, reason: string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'invalid_state',
      state,
      allowed: ['resolved_review_diff_commits'],
      reason,
    },
  };
}

function targetUnavailable<T>(
  operation: string,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: mapVersionDiagnostics(diagnostics),
    },
  };
}

function mapVersionDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(
      item.issueCode,
      item.severity === 'fatal' ? 'error' : item.severity,
      item.safeMessage,
      item.payload,
    ),
  );
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return data === undefined ? { code, severity, message } : { code, severity, message, data };
}
