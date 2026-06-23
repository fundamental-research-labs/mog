import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffOptions,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  ObjectDigest,
  VersionPageToken,
  VersionRecordRevision,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store';
import type { VersionDependencyRef } from './object-digest';
import { VersionObjectStoreError, type VersionObjectStore } from './object-store';
import {
  VersionStoreProviderError,
  type VersionStoreDiagnostic,
  type VersionGraphStore,
  type VersionStoreProvider,
} from './provider';
import type { WorkbookCommit, WorkbookCommitCompletenessDiagnostic } from './commit-store';
import { namespaceForRegistry } from './registry';
import { projectReviewAccessDiffValue } from './review-access-projection';

const VERSION_DIFF_DEFAULT_PAGE_SIZE = 50;
const VERSION_DIFF_MAX_PAGE_SIZE = 500;
const VERSION_DIFF_PAGE_TOKEN_PREFIX = 'vc04diff';
const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

type NormalizedDiffCommitish =
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: typeof VERSION_GRAPH_HEAD_REF | typeof VERSION_GRAPH_MAIN_REF;
    };

type DiffServiceDiagnostic = PublicVersionStoreDiagnostic & {
  readonly code: string;
  readonly issueCode: string;
  readonly operation: 'diff';
  readonly selector?: 'base' | 'target';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

type DiffServiceSuccessResult = Extract<WorkbookDiffPage, { readonly status: 'success' }> & {
  readonly diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[];
};

type DiffServiceDegradedResult = Extract<WorkbookDiffPage, { readonly status: 'degraded' }> & {
  readonly diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[];
};

type DiffServiceResult = DiffServiceSuccessResult | DiffServiceDegradedResult;

export type WorkbookVersionDiffMetadataPage =
  | (DiffServiceSuccessResult & {
      readonly baseCommitId: WorkbookCommitId;
      readonly targetCommitId: WorkbookCommitId;
      readonly changeSetDigest: ObjectDigest;
    })
  | DiffServiceDegradedResult;

type VersionObjectRecordReader = Pick<VersionObjectStore, 'getObjectRecord'>;

type ParsedDiffOptions = {
  readonly pageSize: number;
  readonly pageToken?: VersionPageToken | string;
};

type ParsedPageToken =
  | {
      readonly ok: true;
      readonly offset: number;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DiffServiceDiagnostic[];
    };

export type WorkbookVersionDiffServiceOptions = {
  readonly provider: VersionStoreProvider;
};

export class WorkbookVersionDiffService {
  private readonly provider: VersionStoreProvider;

  constructor(options: WorkbookVersionDiffServiceOptions) {
    this.provider = options.provider;
  }

  async diff(
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options: VersionDiffOptions = {},
  ): Promise<DiffServiceResult> {
    const result = await this.diffWithMetadata(base, target, options);
    if (result.status === 'degraded') return result;
    return {
      status: 'success',
      items: result.items,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
      readRevision: result.readRevision,
      order: result.order,
      diagnostics: result.diagnostics,
    };
  }

  async diffWithMetadata(
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options: VersionDiffOptions = {},
  ): Promise<WorkbookVersionDiffMetadataPage> {
    const parsedOptions = parseDiffOptions(options);
    if (parsedOptions.diagnostics.length > 0) {
      return degradedDiffPage(parsedOptions.diagnostics);
    }

    const opened = await this.openVisibleGraph();
    if (!opened.ok) return degradedDiffPage(opened.diagnostics);

    const resolvedBase = await resolveCommitish(opened.graph, base);
    if (!resolvedBase.ok) return degradedDiffPage(resolvedBase.diagnostics);
    const resolvedTarget = await resolveCommitish(opened.graph, target);
    if (!resolvedTarget.ok) return degradedDiffPage(resolvedTarget.diagnostics);

    const pageToken = parsePageToken(
      parsedOptions.options.pageToken,
      resolvedBase.commitId,
      resolvedTarget.commitId,
    );
    if (!pageToken.ok) return degradedDiffPage(pageToken.diagnostics);

    const closure = await opened.graph.readCommitClosure(resolvedTarget.commitId);
    if (closure.status !== 'success') {
      return degradedDiffPage(graphDiagnostics(closure.diagnostics));
    }

    const targetCommit = closure.commits.find((commit) => commit.id === resolvedTarget.commitId);
    if (!targetCommit) {
      return degradedDiffPage([
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'Target commit is absent from its readable commit closure.',
          {
            details: { selector: 'target' },
          },
        ),
      ]);
    }

    if (
      targetCommit.payload.parentCommitIds.length !== 1 ||
      targetCommit.payload.parentCommitIds[0] !== resolvedBase.commitId
    ) {
      return degradedDiffPage([
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'This semantic diff slice supports only direct parent-child commit diffs.',
          {
            details: {
              parentCount: targetCommit.payload.parentCommitIds.length,
              parentMatchesBase: targetCommit.payload.parentCommitIds[0] === resolvedBase.commitId,
            },
          },
        ),
      ]);
    }

    const completenessDiagnostics = diffCompletenessDiagnostics(
      closure.commits,
      resolvedBase.commitId,
      resolvedTarget.commitId,
    );
    if (completenessDiagnostics.length > 0) {
      return degradedDiffPage(completenessDiagnostics);
    }

    const semanticRecord = await readSemanticChangeSet(
      opened.objectStore,
      targetCommit.payload.semanticChangeSetDigest,
    );
    if (!semanticRecord.ok) return degradedDiffPage(semanticRecord.diagnostics);

    const entries = mapSemanticChangeSet(semanticRecord.payload);
    if (!entries.ok) return degradedDiffPage(entries.diagnostics);

    const offset = pageToken.offset;
    const pageItems = entries.items.slice(offset, offset + parsedOptions.options.pageSize);
    const nextOffset = offset + pageItems.length;
    const nextPageToken =
      nextOffset < entries.items.length
        ? pageTokenFor(resolvedBase.commitId, resolvedTarget.commitId, nextOffset)
        : undefined;

    return {
      status: 'success',
      items: pageItems,
      ...(nextPageToken ? { nextPageToken } : {}),
      readRevision: resolvedTarget.readRevision,
      order: 'semantic-change-order',
      diagnostics: [],
      baseCommitId: resolvedBase.commitId,
      targetCommitId: resolvedTarget.commitId,
      changeSetDigest: targetCommit.payload.semanticChangeSetDigest,
    };
  }

  private async openVisibleGraph(): Promise<
    | {
        readonly ok: true;
        readonly graph: VersionGraphStore;
        readonly objectStore: VersionObjectRecordReader;
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly (VersionStoreDiagnostic | DiffServiceDiagnostic)[];
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return { ok: false, diagnostics: registryRead.diagnostics };
      }

      const graph = await this.provider.openGraph(
        namespaceForRegistry(registryRead.registry),
        this.provider.accessContext,
      );
      const objectStore = objectStoreFromGraph(graph);
      if (!objectStore) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              'VERSION_UNMATERIALIZABLE_COMMIT',
              'The visible version graph does not expose object reads for semantic diff.',
            ),
          ],
        };
      }
      return { ok: true, graph, objectStore };
    } catch (error) {
      if (error instanceof VersionStoreProviderError) {
        return { ok: false, diagnostics: error.diagnostics };
      }
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_PROVIDER_ERROR',
            'Version store provider failed before returning graph state.',
            {
              recoverability: 'retry',
            },
          ),
        ],
      };
    }
  }
}

export function createWorkbookVersionDiffService(
  options: WorkbookVersionDiffServiceOptions,
): WorkbookVersionDiffService {
  return new WorkbookVersionDiffService(options);
}

function objectStoreFromGraph(graph: VersionGraphStore): VersionObjectRecordReader | null {
  if (typeof graph.getObjectRecord === 'function') return graph;

  const candidate = (graph as { readonly objectStore?: unknown }).objectStore;
  if (!candidate || typeof candidate !== 'object') return null;
  const maybe = candidate as Partial<VersionObjectStore>;
  return typeof maybe.getObjectRecord === 'function'
    ? (candidate as VersionObjectRecordReader)
    : null;
}

async function resolveCommitish(
  graph: VersionGraphStore,
  selector: NormalizedDiffCommitish,
): Promise<
  | {
      readonly ok: true;
      readonly commitId: WorkbookCommitId;
      readonly readRevision: VersionRecordRevision;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DiffServiceDiagnostic[];
    }
> {
  if (selector.kind === 'commit') {
    const head = await graph.readHead();
    if (head.status !== 'success') {
      return { ok: false, diagnostics: graphDiagnostics(head.diagnostics) };
    }
    return { ok: true, commitId: selector.id, readRevision: head.main.revision };
  }

  const ref = await graph.readRef(selector.name);
  if (ref.status !== 'success') {
    return { ok: false, diagnostics: graphDiagnostics(ref.diagnostics) };
  }
  if (ref.ref.name === VERSION_GRAPH_HEAD_REF) {
    const head = await graph.readHead();
    if (head.status !== 'success') {
      return { ok: false, diagnostics: graphDiagnostics(head.diagnostics) };
    }
    return { ok: true, commitId: head.head.id, readRevision: head.main.revision };
  }
  return { ok: true, commitId: ref.ref.commitId, readRevision: ref.ref.revision };
}

function parseDiffOptions(options: VersionDiffOptions): {
  readonly options: ParsedDiffOptions;
  readonly diagnostics: readonly DiffServiceDiagnostic[];
} {
  const pageSize = options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > VERSION_DIFF_MAX_PAGE_SIZE) {
    return {
      options: { pageSize: VERSION_DIFF_DEFAULT_PAGE_SIZE },
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'diff pageSize must be an integer from 1 through 500.',
          {
            details: {
              min: 1,
              max: VERSION_DIFF_MAX_PAGE_SIZE,
              receivedPageSize: Number.isFinite(pageSize) ? pageSize : String(pageSize),
            },
          },
        ),
      ],
    };
  }
  return {
    options: {
      pageSize,
      ...(options.pageToken === undefined ? {} : { pageToken: options.pageToken }),
    },
    diagnostics: [],
  };
}

function parsePageToken(
  token: VersionPageToken | string | undefined,
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
): ParsedPageToken {
  if (token === undefined) return { ok: true, offset: 0 };

  const parts = token.split(':');
  const offsetValue = parts.at(-1);
  const targetDigest = parts.at(-2);
  const targetPrefix = parts.at(-4);
  const baseDigest = parts.at(-5);
  const basePrefix = parts.at(-7);
  if (
    parts.length !== 8 ||
    parts[0] !== VERSION_DIFF_PAGE_TOKEN_PREFIX ||
    basePrefix !== 'commit' ||
    parts.at(-6) !== 'sha256' ||
    targetPrefix !== 'commit' ||
    parts.at(-3) !== 'sha256' ||
    `${basePrefix}:sha256:${baseDigest}` !== baseCommitId ||
    `${targetPrefix}:sha256:${targetDigest}` !== targetCommitId ||
    offsetValue === undefined
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken does not match this diff request.'),
      ],
    };
  }

  const offset = Number(offsetValue);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken carries an invalid page offset.'),
      ],
    };
  }
  return { ok: true, offset };
}

function diffCompletenessDiagnostics(
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

function completenessDiagnostic(
  selector: 'base' | 'target',
  source: WorkbookCommitCompletenessDiagnostic,
): DiffServiceDiagnostic {
  const category = completenessCategory(source);
  return diagnostic(
    source.code,
    completenessSafeMessage(category),
    {
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
    },
  );
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

async function readSemanticChangeSet(
  objectStore: VersionObjectRecordReader,
  digest: VersionDependencyRef['digest'],
): Promise<
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] }
> {
  try {
    const record = await objectStore.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest,
    });
    return { ok: true, payload: record.preimage.payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_UNMATERIALIZABLE_COMMIT'
            : 'VERSION_PROVIDER_ERROR',
          'Target commit semantic change-set object could not be read.',
          {
            recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry',
          },
        ),
      ],
    };
  }
}

function mapSemanticChangeSet(
  payload: unknown,
):
  | { readonly ok: true; readonly items: readonly VersionDiffEntry[] }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] } {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const changes = Array.isArray(payload.changes) ? payload.changes : null;
  const reviewChanges =
    Array.isArray(payload.reviewChanges) && payload.reviewChanges.length > 0
      ? payload.reviewChanges
      : changes;
  if (!reviewChanges) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const entries: VersionDiffEntry[] = [];
  for (let index = 0; index < reviewChanges.length; index++) {
    const entry = mapSemanticChange(reviewChanges[index]);
    if (!entry) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Semantic change record is not supported by this diff slice.',
            {
              details: { itemIndex: index },
            },
          ),
        ],
      };
    }
    entries.push(entry);
  }

  return { ok: true, items: entries };
}

function mapSemanticChange(value: unknown): VersionDiffEntry | null {
  if (!isRecord(value)) return null;

  const structural = mapStructuralMetadata(value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;

  return {
    structural,
    before,
    after,
    ...(display ? { display } : {}),
  };
}

function mapReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  return reviewValue === undefined ? mapDiffValue(value) : reviewValue;
}

function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): VersionDiffStructuralMetadata | null {
  const structural = mapRedactedValue(value.structural);
  if (structural) return structural;
  const source = isRecord(value.structural) ? value.structural : value;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    typeof source.entityId !== 'string' ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: source.changeId,
    domain: source.domain,
    entityId: source.entityId,
    propertyPath: [...source.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

function pageTokenFor(
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
  offset: number,
): VersionPageToken {
  return `${VERSION_DIFF_PAGE_TOKEN_PREFIX}:${baseCommitId}:${targetCommitId}:${offset}` as VersionPageToken;
}

function graphDiagnostics(
  diagnostics: readonly { readonly code?: string; readonly message?: string }[],
): readonly DiffServiceDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'VERSION_UNMATERIALIZABLE_COMMIT',
        'Version graph did not return a readable commit.',
      ),
    ];
  }
  return diagnostics.map((item) =>
    diagnostic(item.code ?? 'VERSION_PROVIDER_ERROR', item.message ?? 'Version graph read failed.'),
  );
}

function diagnostic(
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

function degradedDiffPage(
  diagnostics: readonly (PublicVersionStoreDiagnostic | VersionStoreDiagnostic)[],
): DiffServiceDegradedResult {
  return {
    status: 'degraded',
    items: [],
    order: 'semantic-change-order',
    diagnostics,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
