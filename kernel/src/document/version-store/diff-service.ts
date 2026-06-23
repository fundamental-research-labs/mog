import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffOptions,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  ObjectDigest,
  VersionRecordRevision,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';

import {
  degradedDiffPage,
  diagnostic,
  diffCompletenessDiagnostics,
  graphDiagnostics,
  type DiffServiceDegradedResult,
  type DiffServiceDiagnostic,
} from './diff-service-diagnostics';
import {
  mapEntriesWithOrderKeys,
  pageStartOffset,
  type MappedSemanticDiffEntry,
} from './diff-service-order-key';
import {
  internalPageTokenForOffset,
  internalPageTokenForOrderKey,
  parseDiffOptions,
  parsePageToken,
  publicPageTokenFor,
} from './diff-service-pagination';
import {
  objectStoreFromGraph,
  readSemanticChangeSet,
  type VersionObjectRecordReader,
} from './diff-service-object-diagnostics';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store';
import {
  VersionStoreProviderError,
  type VersionStoreDiagnostic,
  type VersionGraphStore,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';
import { projectReviewAccessDiffValue } from './review-access-projection';

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

type DiffServiceSuccessResult = Extract<WorkbookDiffPage, { readonly status: 'success' }> & {
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

    const resolvedBase = await resolveCommitish(opened.graph, base, 'base');
    if (!resolvedBase.ok) return degradedDiffPage(resolvedBase.diagnostics);
    const resolvedTarget = await resolveCommitish(opened.graph, target, 'target');
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

async function resolveCommitish(
  graph: VersionGraphStore,
  selector: NormalizedDiffCommitish,
  selectorName: 'base' | 'target',
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
    const closure = await graph.readCommitClosure(selector.id);
    if (closure.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(closure.diagnostics, { selector: selectorName }),
      };
    }

    const head = await graph.readHead();
    if (head.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(head.diagnostics, { selector: selectorName }),
      };
    }
    return { ok: true, commitId: selector.id, readRevision: head.main.revision };
  }

  const ref = await graph.readRef(selector.name);
  if (ref.status !== 'success') {
    return {
      ok: false,
      diagnostics: graphDiagnostics(ref.diagnostics, { selector: selectorName }),
    };
  }
  if (ref.ref.name === VERSION_GRAPH_HEAD_REF) {
    const head = await graph.readHead();
    if (head.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(head.diagnostics, { selector: selectorName }),
      };
    }
    return { ok: true, commitId: head.head.id, readRevision: head.main.revision };
  }
  return { ok: true, commitId: ref.ref.commitId, readRevision: ref.ref.revision };
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

  return {
    ok: true,
    items: mapEntriesWithOrderKeys(entries),
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
