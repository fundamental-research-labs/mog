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
import {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PAGE_ORDER,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
  VERSION_DIFF_RESOURCE_LIMITS,
  isPublicVersionDiffCursor,
} from '@mog-sdk/contracts/versioning';

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

const VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX = 'vc04diff';
const VERSION_DIFF_CURSOR_CACHE_MAX_ENTRIES = 512;
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
      readonly cursor: SemanticDiffPageCursor;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DiffServiceDiagnostic[];
    };

type SemanticDiffPageCursor =
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'orderKey'; readonly orderKey: SemanticDiffOrderKey };

type PublicCursorCacheEntry = {
  readonly internalToken: string;
};

type MappedSemanticDiffEntry = {
  readonly entry: VersionDiffEntry; readonly orderKey: SemanticDiffOrderKey; readonly hasExplicitOrderKey: boolean;
};

type SemanticDiffOrderKey = string;

const PUBLIC_DIFF_CURSOR_CACHE = new Map<string, PublicCursorCacheEntry>();
let publicDiffCursorSequence = 0;

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

    const offset = pageStartOffset(entries.items, pageToken.cursor);
    const pageEntries = entries.items.slice(offset, offset + parsedOptions.options.pageSize);
    const pageItems = pageEntries.map((item) => item.entry);
    const nextOffset = offset + pageEntries.length;
    const shouldUseOrderKeyCursor = entries.items.some((entry) => entry.hasExplicitOrderKey);
    const internalNextPageToken =
      nextOffset < entries.items.length
        ? shouldUseOrderKeyCursor && pageEntries.length > 0
          ? internalPageTokenForOrderKey(
              resolvedBase.commitId,
              resolvedTarget.commitId,
              pageEntries[pageEntries.length - 1]!.orderKey,
            )
          : internalPageTokenForOffset(resolvedBase.commitId, resolvedTarget.commitId, nextOffset)
        : undefined;
    const nextPageToken = internalNextPageToken
      ? publicPageTokenFor(internalNextPageToken)
      : undefined;

    return {
      status: 'success',
      items: pageItems,
      ...(nextPageToken ? { nextPageToken } : {}),
      readRevision: resolvedTarget.readRevision,
      order: VERSION_DIFF_PAGE_ORDER,
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
  const pageSize = options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > VERSION_DIFF_MAX_PAGE_LIMIT) {
    return {
      options: { pageSize: VERSION_DIFF_DEFAULT_PAGE_LIMIT },
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'diff pageSize must be an integer from 1 through 500.',
          {
            details: {
              min: 1,
              max: VERSION_DIFF_MAX_PAGE_LIMIT,
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
  if (token === undefined) return { ok: true, cursor: { kind: 'offset', offset: 0 } };

  const publicCursor = resolvePublicPageToken(token);
  if (!publicCursor.ok) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', publicCursor.safeMessage, {
          recoverability: 'retry',
          details: publicCursor.details,
        }),
      ],
    };
  }

  const parts = publicCursor.internalToken.split(':');
  const cursorValue = parts.at(-1);
  const targetDigest = parts.at(-2);
  const targetPrefix = parts.at(-4);
  const baseDigest = parts.at(-5);
  const basePrefix = parts.at(-7);
  if (
    parts.length !== 8 ||
    (parts[0] !== VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX &&
      parts[0] !== `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k`) ||
    basePrefix !== 'commit' ||
    parts.at(-6) !== 'sha256' ||
    targetPrefix !== 'commit' ||
    parts.at(-3) !== 'sha256' ||
    `${basePrefix}:sha256:${baseDigest}` !== baseCommitId ||
    `${targetPrefix}:sha256:${targetDigest}` !== targetCommitId ||
    cursorValue === undefined
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken does not match this diff request.'),
      ],
    };
  }

  if (parts[0] === `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k`) {
    const orderKey = parseEncodedSemanticDiffOrderKey(cursorValue);
    if (!orderKey) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken carries an invalid order key.'),
        ],
      };
    }
    return { ok: true, cursor: { kind: 'orderKey', orderKey } };
  }

  const offset = Number(cursorValue);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff pageToken carries an invalid page offset.'),
      ],
    };
  }
  return { ok: true, cursor: { kind: 'offset', offset } };
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
  | { readonly ok: true; readonly items: readonly MappedSemanticDiffEntry[] }
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

  const entries: { readonly entry: VersionDiffEntry; readonly source: unknown }[] = [];
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
    entries.push({ entry, source: reviewChanges[index] });
  }

  const uniqueEntries = withUniqueChangeIds(entries);
  const mapped = uniqueEntries.map(({ entry, source }) => {
    const explicitKey = explicitOrderKey(source, entry);
    return {
      entry,
      orderKey: explicitKey ?? fallbackOrderKey(entry),
      hasExplicitOrderKey: explicitKey !== null,
    };
  });
  return {
    ok: true,
    items: mapped.some((entry) => entry.hasExplicitOrderKey)
      ? [...mapped].sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey))
      : mapped,
  };
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

function pageStartOffset(entries: readonly MappedSemanticDiffEntry[], cursor: SemanticDiffPageCursor): number {
  if (cursor.kind === 'offset') return cursor.offset;
  const index = entries.findIndex((entry) => compareOrderKeys(entry.orderKey, cursor.orderKey) > 0);
  return index < 0 ? entries.length : index;
}

function withUniqueChangeIds(entries: readonly { readonly entry: VersionDiffEntry; readonly source: unknown }[]) {
  const counts = new Map<string, number>();
  for (const { entry } of entries) if (entry.structural.kind === 'metadata') {
    counts.set(entry.structural.changeId, (counts.get(entry.structural.changeId) ?? 0) + 1);
  }
  if (![...counts.values()].some((count) => count > 1)) return entries;
  return entries.map(({ entry, source }) => {
    const structural = entry.structural;
    if (structural.kind !== 'metadata' || counts.get(structural.changeId) === 1) return { entry, source };
    const suffix = encodeURIComponent(JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]));
    return { source, entry: { ...entry, structural: { ...structural, changeId: `${structural.changeId}~${suffix}` } } };
  });
}

function explicitOrderKey(source: unknown, entry: VersionDiffEntry): SemanticDiffOrderKey | null {
  const key = isRecord(source) && isRecord(source.pageCursorOrderKey) ? source.pageCursorOrderKey : null;
  const domainOrder = key ? Number(key.domainOrder) : NaN;
  if (entry.structural.kind !== 'metadata' || !Number.isSafeInteger(domainOrder) || typeof key?.hashPropertyPath !== 'string') return null;
  return orderKeyString(
    domainOrder,
    key.hashPropertyPath,
    typeof key.canonicalEventKey === 'string' ? key.canonicalEventKey : undefined,
    typeof key.hashIdentity === 'string' ? key.hashIdentity : undefined,
    typeof key.valueClass === 'string' ? key.valueClass : 'authored',
    entry.structural.changeId,
  );
}

function fallbackOrderKey(entry: VersionDiffEntry): SemanticDiffOrderKey {
  const structural = entry.structural;
  return structural.kind === 'metadata'
    ? orderKeyString(90, structural.propertyPath.join('/'), undefined, structural.entityId, 'authored', structural.changeId)
    : orderKeyString(100, '', undefined, undefined, 'diagnosticOnly', '');
}

function compareOrderKeys(a: SemanticDiffOrderKey, b: SemanticDiffOrderKey): number {
  return a.localeCompare(b);
}

function orderKeyString(domainOrder: number, hashPropertyPath: string, canonicalEventKey: string | undefined, hashIdentity: string | undefined, valueClass: string, changeId: string): string {
  return JSON.stringify([domainOrder.toString().padStart(5, '0'), hashPropertyPath, canonicalEventKey ?? null, hashIdentity ?? null, valueClass, changeId]);
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

function internalPageTokenForOffset(
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
  offset: number,
): VersionPageToken {
  return `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}:${baseCommitId}:${targetCommitId}:${offset}` as VersionPageToken;
}

function internalPageTokenForOrderKey(
  baseCommitId: WorkbookCommitId,
  targetCommitId: WorkbookCommitId,
  orderKey: SemanticDiffOrderKey,
): VersionPageToken {
  return `${VERSION_DIFF_INTERNAL_PAGE_TOKEN_PREFIX}k:${baseCommitId}:${targetCommitId}:${encodeURIComponent(JSON.stringify(orderKey))}` as VersionPageToken;
}

function parseEncodedSemanticDiffOrderKey(value: string): SemanticDiffOrderKey | null {
  try {
    const key = JSON.parse(decodeURIComponent(value));
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

function publicPageTokenFor(internalToken: VersionPageToken): VersionPageToken {
  evictPublicDiffCursorCache();
  const publicToken =
    `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}${nextPublicCursorHandle()}` as VersionPageToken;
  PUBLIC_DIFF_CURSOR_CACHE.set(publicToken, { internalToken });
  return publicToken;
}

function resolvePublicPageToken(token: VersionPageToken | string):
  | {
      readonly ok: true;
      readonly internalToken: string;
    }
  | {
      readonly ok: false;
      readonly safeMessage: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    } {
  if (typeof token !== 'string') {
    return {
      ok: false,
      safeMessage: 'diff pageToken is malformed or unsupported.',
      details: { category: 'malformedCursor' },
    };
  }
  if (token.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH) {
    return {
      ok: false,
      safeMessage: 'diff pageToken exceeds the public cursor size limit.',
      details: {
        category: 'oversizedCursor',
        max: VERSION_DIFF_RESOURCE_LIMITS.maxPublicCursorBytes,
        receivedCursorBytes: token.length,
      },
    };
  }
  if (!isPublicVersionDiffCursor(token)) {
    return {
      ok: false,
      safeMessage: 'diff pageToken uses an unsupported public cursor order or version.',
      details: { category: 'unsupportedCursor' },
    };
  }
  const entry = PUBLIC_DIFF_CURSOR_CACHE.get(token);
  if (!entry) {
    return {
      ok: false,
      safeMessage: 'diff pageToken is stale or no longer available.',
      details: { category: 'staleCursor' },
    };
  }
  return { ok: true, internalToken: entry.internalToken };
}

function nextPublicCursorHandle(): string {
  publicDiffCursorSequence = (publicDiffCursorSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${randomCursorSegment()}.${Date.now().toString(36)}.${publicDiffCursorSequence.toString(36)}`;
}

function randomCursorSegment(): string {
  const bytes = new Uint8Array(16);
  const cryptoLike = (
    globalThis as { readonly crypto?: { getRandomValues?: <T extends Uint8Array>(array: T) => T } }
  ).crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function evictPublicDiffCursorCache(): void {
  while (PUBLIC_DIFF_CURSOR_CACHE.size >= VERSION_DIFF_CURSOR_CACHE_MAX_ENTRIES) {
    const oldest = PUBLIC_DIFF_CURSOR_CACHE.keys().next().value;
    if (!oldest) return;
    PUBLIC_DIFF_CURSOR_CACHE.delete(oldest);
  }
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
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
