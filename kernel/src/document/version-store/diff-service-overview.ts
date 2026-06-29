import { toA1 } from '@mog/spreadsheet-utils/a1';
import type {
  ObjectDigest,
  PageCursor,
  VersionDiffFilters,
  VersionDiffGroup,
  VersionDiffGroupDetailOptions,
  VersionDiffGroupId,
  VersionDiffGroupKey,
  VersionDiffOperation,
  VersionDiffOverview,
  VersionDiffOverviewOptions,
  VersionDiffUnsupportedFilter,
  VersionRecordRevision,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PAGE_ORDER,
  VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS,
} from '@mog-sdk/contracts/versioning';

import {
  degradedDiffPage,
  diagnostic,
  type DiffServiceDegradedResult,
} from './diff-service-diagnostics';
import { mapSemanticChangeSet } from './diff-service-semantic-mapping';
import {
  semanticDiffDisplayContextFromPayload,
  sheetIdForCellSemanticChange,
  sheetNameForCellSemanticChange,
  type SemanticDiffDisplayContext,
} from './diff-service-display-context';
import {
  internalGroupDetailPageTokenForOffset,
  internalGroupPageTokenForOffset,
  parseGroupDetailPageToken,
  parseGroupPageToken,
  publicPageTokenFor,
} from './diff-service-pagination';
import { objectDigestFor } from './merge-apply-intent-store';
import { semanticReviewChangesFromPayload } from './semantic-review-projection';

const DIFF_PROJECTION_VERSION = 1;
const DEFAULT_GROUP_LIMIT = 50;
const MAX_GROUP_LIMIT = VERSION_DIFF_MAX_PAGE_LIMIT;
const EXACT_OVERVIEW_SCAN_CHANGE_LIMIT = 250_000;
const GROUP_SAMPLE_LIMIT = 5;
const RAW_PUBLIC_DIFF_DOMAINS = new Set<string>(VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS);

export type DiffSemanticContext = {
  readonly baseCommitId: WorkbookCommitId;
  readonly targetCommitId: WorkbookCommitId;
  readonly changeSetDigest: ObjectDigest;
  readonly readRevision: VersionRecordRevision;
  readonly semanticPayload: unknown;
};

type SemanticChange = {
  readonly raw: unknown;
  readonly sourceIndex: number;
  readonly changeId: string;
  readonly domain: string;
  readonly sheetId?: string;
  readonly operation: Exclude<VersionDiffOperation, 'mixed'>;
  readonly row?: number;
  readonly column?: number;
  readonly display: {
    readonly sheetName?: { readonly kind: 'value'; readonly value: string };
    readonly address?: { readonly kind: 'value'; readonly value: string };
  };
  readonly unsupported: boolean;
  readonly redacted: boolean;
};

type GroupAccumulator = {
  readonly bucketKey: string;
  readonly domain: string;
  readonly sheetId?: string;
  readonly operation: Exclude<VersionDiffOperation, 'mixed'>;
  readonly display: SemanticChange['display'];
  readonly cells: Map<string, SemanticChange>;
  readonly nonCellChanges: SemanticChange[];
  readonly unsupported: boolean;
  readonly redacted: boolean;
};

type BuiltGroup = VersionDiffGroup & {
  readonly match: (change: SemanticChange) => boolean;
  readonly sort: readonly [string, string, string, number, number, string];
};

type DiffServiceSuccessResult = Extract<WorkbookDiffPage, { readonly status: 'success' }> & {
  readonly diagnostics: readonly PublicVersionStoreDiagnostic[];
};

export async function buildDiffOverview(
  context: DiffSemanticContext,
  options: VersionDiffOverviewOptions = {},
): Promise<VersionDiffOverview | DiffServiceDegradedResult> {
  const parsedOptions = parseOverviewOptions(options);
  if (!parsedOptions.ok) return degradedDiffPage(parsedOptions.diagnostics);

  const projectionDigest = await diffProjectionDigest(context, parsedOptions.filters);
  const groupCursor = parseGroupPageToken(parsedOptions.groupPageToken, {
    baseCommitId: context.baseCommitId,
    targetCommitId: context.targetCommitId,
    changeSetDigest: context.changeSetDigest,
    projectionDigest,
  });
  if (!groupCursor.ok) return degradedDiffPage(groupCursor.diagnostics);

  const projection = await buildProjection(context, parsedOptions.filters);
  if (!projection.ok) return degradedDiffPage(projection.diagnostics);

  const groups = projection.groups.slice(
    groupCursor.offset,
    groupCursor.offset + parsedOptions.groupLimit,
  );
  const nextOffset = groupCursor.offset + groups.length;
  const nextPageToken =
    nextOffset < projection.groups.length
      ? publicPageTokenFor(
          internalGroupPageTokenForOffset({
            baseCommitId: context.baseCommitId,
            targetCommitId: context.targetCommitId,
            changeSetDigest: context.changeSetDigest,
            projectionDigest,
            offset: nextOffset,
          }),
        )
      : undefined;

  return {
    baseCommitId: context.baseCommitId,
    targetCommitId: context.targetCommitId,
    readRevision: context.readRevision,
    order: VERSION_DIFF_PAGE_ORDER,
    summary: projection.summary,
    groups: {
      items: groups,
      ...(nextPageToken ? { nextCursor: nextPageToken as PageCursor } : {}),
      limit: parsedOptions.groupLimit,
      totalEstimate: projection.groups.length,
    },
    unsupportedFilters: projection.unsupportedFilters,
    diagnostics: projection.summary.diagnostics,
    resourceLimits: projection.resourceLimits,
  };
}

export async function buildDiffGroupDetail(
  context: DiffSemanticContext,
  options: VersionDiffGroupDetailOptions,
): Promise<DiffServiceSuccessResult | DiffServiceDegradedResult> {
  const parsedOptions = parseGroupDetailOptions(options);
  if (!parsedOptions.ok) return degradedDiffPage(parsedOptions.diagnostics);

  const projectionDigest = await diffProjectionDigest(context, parsedOptions.filters);
  const detailCursor = parseGroupDetailPageToken(parsedOptions.pageToken, {
    baseCommitId: context.baseCommitId,
    targetCommitId: context.targetCommitId,
    changeSetDigest: context.changeSetDigest,
    projectionDigest,
    groupId: parsedOptions.groupId,
  });
  if (!detailCursor.ok) return degradedDiffPage(detailCursor.diagnostics);

  const projection = await buildProjection(context, parsedOptions.filters);
  if (!projection.ok) return degradedDiffPage(projection.diagnostics);
  const group = projection.groups.find((candidate) => candidate.groupId === parsedOptions.groupId);
  if (!group) {
    return degradedDiffPage([
      diagnostic('VERSION_STALE_PAGE_CURSOR', 'diff groupId does not match this diff request.', {
        recoverability: 'retry',
      }),
    ]);
  }

  const rawPage: unknown[] = [];
  let matchedIndex = 0;
  let hasMore = false;
  for (const change of projection.changes) {
    if (!group.match(change)) continue;
    if (matchedIndex >= detailCursor.offset && rawPage.length < parsedOptions.pageSize) {
      rawPage.push(change.raw);
    } else if (rawPage.length >= parsedOptions.pageSize) {
      hasMore = true;
      break;
    }
    matchedIndex++;
  }

  const mapped = mapSemanticChangeSet(
    { schemaVersion: 1, changes: rawPage },
    { displayContext: semanticDiffDisplayContextFromPayload(context.semanticPayload) },
  );
  if (!mapped.ok) return degradedDiffPage(mapped.diagnostics);
  const nextOffset = detailCursor.offset + rawPage.length;
  const nextPageToken =
    hasMore || nextOffset < matchedIndex
      ? publicPageTokenFor(
          internalGroupDetailPageTokenForOffset({
            baseCommitId: context.baseCommitId,
            targetCommitId: context.targetCommitId,
            changeSetDigest: context.changeSetDigest,
            projectionDigest,
            groupId: group.groupId,
            offset: nextOffset,
          }),
        )
      : undefined;

  return {
    status: 'success',
    items: mapped.items.map((item) => item.entry),
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision: context.readRevision,
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics: [],
    resourceLimits: projection.resourceLimits,
  };
}

async function buildProjection(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
): Promise<
  | {
      readonly ok: true;
      readonly changes: readonly SemanticChange[];
      readonly groups: readonly BuiltGroup[];
      readonly summary: VersionDiffOverview['summary'];
      readonly unsupportedFilters: readonly VersionDiffUnsupportedFilter[];
      readonly resourceLimits: VersionDiffOverview['resourceLimits'];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly PublicVersionStoreDiagnostic[];
    }
> {
  const rawChanges = semanticChanges(context.semanticPayload);
  if (!rawChanges) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff overview slice.',
        ),
      ],
    };
  }

  const unsupportedFilters = unsupportedFilterAvailability(filters);
  const displayContext = semanticDiffDisplayContextFromPayload(context.semanticPayload);
  const changes: SemanticChange[] = [];
  const scanLimit = Math.min(rawChanges.length, EXACT_OVERVIEW_SCAN_CHANGE_LIMIT);
  for (let index = 0; index < scanLimit; index++) {
    const change = projectSemanticChange(rawChanges[index], index, displayContext);
    if (!change || !changeMatchesFilters(change, filters)) continue;
    changes.push(change);
  }

  const groups = await buildGroups(context, filters, changes);
  const diagnostics = unsupportedFilters.flatMap((filter) => [...filter.diagnostics]);
  const exact = rawChanges.length <= EXACT_OVERVIEW_SCAN_CHANGE_LIMIT;
  const summaryDiagnostics = diagnostics;
  const resourceLimits: VersionDiffOverview['resourceLimits'] = {
    status: exact ? 'within-budget' : 'truncated',
    limits: [
      {
        kind: 'exactCountScanChanges',
        limit: EXACT_OVERVIEW_SCAN_CHANGE_LIMIT,
        unit: 'changes',
        observed: rawChanges.length,
      },
    ],
    ...(exact ? {} : { exactTotalCountUnavailable: true }),
  };

  return {
    ok: true,
    changes,
    groups,
    summary: {
      ...(exact
        ? { exactTotalChanges: changes.length }
        : { minimumChangeCount: changes.length, exactTotalCountUnavailable: true }),
      countPrecision: exact ? 'exact' : 'lowerBound',
      sheetCount: new Set(changes.map((change) => change.sheetId).filter(Boolean)).size,
      domainCounts: countBy(changes, (change) => change.domain).map(([domain, count]) => ({
        domain,
        ...(exact ? { exactCount: count } : { minimumCount: count }),
        countPrecision: exact ? 'exact' : 'lowerBound',
      })),
      operationCounts: countBy(changes, (change) => change.operation).map(
        ([operation, count]) => ({
          operation,
          ...(exact ? { exactCount: count } : { minimumCount: count }),
          countPrecision: exact ? 'exact' : 'lowerBound',
        }),
      ),
      redactedChangeCount: changes.filter((change) => change.redacted).length,
      unsupportedChangeCount: changes.filter((change) => change.unsupported).length,
      incomplete: !exact || diagnostics.length > 0,
      diagnostics: summaryDiagnostics,
    },
    unsupportedFilters,
    resourceLimits,
  };
}

async function buildGroups(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
  changes: readonly SemanticChange[],
): Promise<readonly BuiltGroup[]> {
  const buckets = new Map<string, GroupAccumulator>();
  for (const change of changes) {
    const bucketKey = [
      change.redacted ? 'redacted' : change.unsupported ? 'unsupported' : 'normal',
      change.sheetId ?? '',
      change.domain,
      change.operation,
    ].join('\u0000');
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        bucketKey,
        domain: change.domain,
        ...(change.sheetId ? { sheetId: change.sheetId } : {}),
        operation: change.operation,
        display: change.display,
        cells: new Map(),
        nonCellChanges: [],
        unsupported: change.unsupported,
        redacted: change.redacted,
      };
      buckets.set(bucketKey, bucket);
    }
    if (change.row !== undefined && change.column !== undefined) {
      bucket.cells.set(`${change.row}:${change.column}:${change.changeId}`, change);
    } else {
      bucket.nonCellChanges.push(change);
    }
  }

  const groups: BuiltGroup[] = [];
  for (const bucket of buckets.values()) {
    groups.push(...(await cellGroupsForBucket(context, filters, bucket)));
    if (bucket.nonCellChanges.length > 0) {
      groups.push(await domainGroupForBucket(context, filters, bucket));
    }
  }
  return groups.sort(compareBuiltGroups);
}

async function cellGroupsForBucket(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
  bucket: GroupAccumulator,
): Promise<readonly BuiltGroup[]> {
  const changes = [...bucket.cells.values()].sort(compareCellChanges);
  if (changes.length === 0) return [];
  const rectangles = compactCellRectangles(changes);
  const groups: BuiltGroup[] = [];
  for (const rectangle of rectangles) {
    const key: VersionDiffGroupKey = {
      kind: 'cellRange',
      sheetId: bucket.sheetId ?? rectangle.sheetId,
      domain: bucket.domain,
      operation: bucket.operation,
      rowStart: rectangle.rowStart,
      rowEnd: rectangle.rowEnd,
      columnStart: rectangle.columnStart,
      columnEnd: rectangle.columnEnd,
    };
    const address = `${toA1(rectangle.rowStart, rectangle.columnStart)}:${toA1(
      rectangle.rowEnd,
      rectangle.columnEnd,
    )}`;
    groups.push(
      await groupFromKey(context, filters, key, {
        kind: bucket.redacted ? 'redacted' : bucket.unsupported ? 'unsupported' : 'cellRange',
        domain: bucket.domain,
        sheetId: key.sheetId,
        sheetName: bucket.display.sheetName,
        address: { kind: 'value', value: address },
        operation: bucket.operation,
        count: rectangle.changes.length,
        sampleChangeIds: rectangle.changes
          .slice(0, GROUP_SAMPLE_LIMIT)
          .map((change) => change.changeId),
        diagnostics: [],
        match: (change) =>
          change.sheetId === key.sheetId &&
          change.domain === key.domain &&
          change.operation === key.operation &&
          change.row !== undefined &&
          change.column !== undefined &&
          change.row >= key.rowStart &&
          change.row <= key.rowEnd &&
          change.column >= key.columnStart &&
          change.column <= key.columnEnd,
        sort: [
          key.sheetId,
          key.domain,
          key.operation,
          key.rowStart,
          key.columnStart,
          address,
        ],
      }),
    );
  }
  return groups;
}

async function domainGroupForBucket(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
  bucket: GroupAccumulator,
): Promise<BuiltGroup> {
  const kind = bucket.redacted ? 'redacted' : bucket.unsupported ? 'unsupported' : 'domain';
  const key: VersionDiffGroupKey = {
    kind,
    ...(bucket.sheetId ? { sheetId: bucket.sheetId } : {}),
    domain: bucket.domain,
    operation: bucket.operation,
    keyDigest: await objectDigestFor('mog.version.diff.group.domain-key.v1', {
      bucketKey: bucket.bucketKey,
      changeIds: bucket.nonCellChanges.map((change) => change.changeId),
    }),
  };
  return groupFromKey(context, filters, key, {
    kind,
    domain: bucket.domain,
    sheetId: bucket.sheetId,
    sheetName: bucket.display.sheetName,
    address: bucket.display.address,
    operation: bucket.operation,
    count: bucket.nonCellChanges.length,
    sampleChangeIds: bucket.nonCellChanges
      .slice(0, GROUP_SAMPLE_LIMIT)
      .map((change) => change.changeId),
    diagnostics: [],
    match: (change) =>
      change.sheetId === bucket.sheetId &&
      change.domain === bucket.domain &&
      change.operation === bucket.operation &&
      change.row === undefined &&
      change.column === undefined,
    sort: [
      bucket.sheetId ?? '',
      bucket.domain,
      bucket.operation,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      bucket.bucketKey,
    ],
  });
}

async function groupFromKey(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
  key: VersionDiffGroupKey,
  input: {
    readonly kind: VersionDiffGroup['kind'];
    readonly domain: string;
    readonly sheetId?: string;
    readonly sheetName?: VersionDiffGroup['sheetName'];
    readonly address?: VersionDiffGroup['address'];
    readonly operation: VersionDiffOperation;
    readonly count: number;
    readonly sampleChangeIds: readonly string[];
    readonly diagnostics: readonly PublicVersionStoreDiagnostic[];
    readonly match: BuiltGroup['match'];
    readonly sort: BuiltGroup['sort'];
  },
): Promise<BuiltGroup> {
  const groupDigest = await objectDigestFor('mog.version.diff.group-id.v1', {
    baseCommitId: context.baseCommitId,
    targetCommitId: context.targetCommitId,
    changeSetDigest: context.changeSetDigest,
    projectionVersion: DIFF_PROJECTION_VERSION,
    filters,
    groupBy: 'sheet-domain-range',
    key,
  });
  return {
    groupId: `vdg:sha256:${groupDigest.digest}` as VersionDiffGroupId,
    key,
    kind: input.kind,
    domain: input.domain,
    ...(input.sheetId ? { sheetId: input.sheetId } : {}),
    ...(input.sheetName ? { sheetName: input.sheetName } : {}),
    ...(input.address ? { address: input.address } : {}),
    operation: input.operation,
    changeCount: input.count,
    countPrecision: 'exact',
    sampleChangeIds: input.sampleChangeIds,
    hasDetail: input.count > 0,
    diagnostics: input.diagnostics,
    match: input.match,
    sort: input.sort,
  };
}

function compactCellRectangles(changes: readonly SemanticChange[]): readonly {
  readonly sheetId: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly changes: readonly SemanticChange[];
}[] {
  const rows = new Map<number, SemanticChange[]>();
  for (const change of changes) {
    if (change.row === undefined || change.column === undefined) continue;
    const row = rows.get(change.row) ?? [];
    row.push(change);
    rows.set(change.row, row);
  }

  const rectangles: {
    sheetId: string;
    rowStart: number;
    rowEnd: number;
    columnStart: number;
    columnEnd: number;
    changes: SemanticChange[];
  }[] = [];
  for (const [rowIndex, rowChanges] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    const runs = columnRuns(rowChanges);
    for (const run of runs) {
      const previous = rectangles.at(-1);
      if (
        previous &&
        previous.sheetId === run.sheetId &&
        previous.rowEnd + 1 === rowIndex &&
        previous.columnStart === run.columnStart &&
        previous.columnEnd === run.columnEnd
      ) {
        previous.rowEnd = rowIndex;
        previous.changes.push(...run.changes);
      } else {
        rectangles.push({
          sheetId: run.sheetId,
          rowStart: rowIndex,
          rowEnd: rowIndex,
          columnStart: run.columnStart,
          columnEnd: run.columnEnd,
          changes: [...run.changes],
        });
      }
    }
  }
  return rectangles;
}

function columnRuns(rowChanges: readonly SemanticChange[]): readonly {
  readonly sheetId: string;
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly changes: readonly SemanticChange[];
}[] {
  const sorted = [...rowChanges].sort(compareCellChanges);
  const runs: {
    sheetId: string;
    columnStart: number;
    columnEnd: number;
    changes: SemanticChange[];
  }[] = [];
  for (const change of sorted) {
    if (change.column === undefined || !change.sheetId) continue;
    const previous = runs.at(-1);
    if (
      previous &&
      previous.sheetId === change.sheetId &&
      previous.columnEnd + 1 === change.column
    ) {
      previous.columnEnd = change.column;
      previous.changes.push(change);
    } else {
      runs.push({
        sheetId: change.sheetId,
        columnStart: change.column,
        columnEnd: change.column,
        changes: [change],
      });
    }
  }
  return runs;
}

function projectSemanticChange(
  value: unknown,
  sourceIndex: number,
  displayContext: SemanticDiffDisplayContext,
): SemanticChange | null {
  if (!isRecord(value)) return null;
  const structural = isRecord(value.structural) ? value.structural : value;
  const domain = typeof structural.domain === 'string' ? structural.domain : 'unsupported';
  const changeId =
    typeof structural.changeId === 'string' ? structural.changeId : `unsupported:${sourceIndex}`;
  const redacted =
    isRedacted(value.before) ||
    isRedacted(value.after) ||
    isRedacted(value.structural) ||
    isRedacted(value.display);
  if (redacted) {
    return {
      raw: value,
      sourceIndex,
      changeId,
      domain,
      operation: diffOperation(value.before, value.after),
      display: {},
      unsupported: !RAW_PUBLIC_DIFF_DOMAINS.has(domain),
      redacted: true,
    };
  }
  const historical = isRecord(value.historical) ? value.historical : undefined;
  const cell = isRecord(historical?.cell) ? historical.cell : undefined;
  const range = isRecord(historical?.range) ? historical.range : undefined;
  const evidenceCell = cellCoordinateFromRecordEvidence(value);
  const sheetId =
    safeString(cell?.sheetId) ??
    safeString(range?.sheetId) ??
    evidenceCell?.sheetId ??
    sheetIdForCellSemanticChange(value) ??
    sheetIdFromSemanticValue(value);
  const row = safeCoordinate(cell?.row) ?? evidenceCell?.row;
  const column = safeCoordinate(cell?.column) ?? evidenceCell?.column;
  const display = semanticChangeDisplay(value, displayContext);
  return {
    raw: value,
    sourceIndex,
    changeId,
    domain,
    ...(sheetId ? { sheetId } : {}),
    operation: diffOperation(value.before, value.after),
    ...(row === undefined ? {} : { row }),
    ...(column === undefined ? {} : { column }),
    display,
    unsupported: !RAW_PUBLIC_DIFF_DOMAINS.has(domain),
    redacted,
  };
}

function semanticChanges(payload: unknown): readonly unknown[] | null {
  return semanticReviewChangesFromPayload(payload);
}

function changeMatchesFilters(change: SemanticChange, filters: VersionDiffFilters | undefined) {
  if (!filters) return true;
  if (filters.sheetIds && (!change.sheetId || !filters.sheetIds.includes(change.sheetId))) {
    return false;
  }
  if (filters.domains && !filters.domains.includes(change.domain)) return false;
  if (filters.operations && !filters.operations.includes(change.operation)) return false;
  return true;
}

function unsupportedFilterAvailability(
  filters: VersionDiffFilters | undefined,
): readonly VersionDiffUnsupportedFilter[] {
  return [
    unsupportedFilter(
      'address',
      'Address filters require a historical range index.',
      Boolean(filters?.address),
    ),
    unsupportedFilter(
      'search',
      'Formula and text search requires a redaction-aware search index.',
      Boolean(filters?.search),
    ),
  ];
}

function unsupportedFilter(
  filter: VersionDiffUnsupportedFilter['filter'],
  reason: string,
  includeDiagnostic: boolean,
): VersionDiffUnsupportedFilter {
  return {
    filter,
    reason,
    diagnostics: includeDiagnostic
      ? [
          diagnostic('VERSION_INVALID_OPTIONS', reason, {
            severity: 'warning',
            recoverability: 'unsupported',
            details: { filter },
          }),
        ]
      : [],
  };
}

function parseOverviewOptions(options: VersionDiffOverviewOptions):
  | {
      readonly ok: true;
      readonly groupLimit: number;
      readonly groupPageToken?: VersionDiffOverviewOptions['groupPageToken'];
      readonly filters?: VersionDiffFilters;
    }
  | { readonly ok: false; readonly diagnostics: readonly PublicVersionStoreDiagnostic[] } {
  const groupLimit = options.groupLimit ?? DEFAULT_GROUP_LIMIT;
  if (
    !Number.isInteger(groupLimit) ||
    groupLimit < 1 ||
    groupLimit > MAX_GROUP_LIMIT ||
    (options.groupBy !== undefined && options.groupBy !== 'sheet-domain-range')
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_OPTIONS', 'diff overview options are invalid.', {
          details: { groupLimit, groupBy: options.groupBy ?? null },
        }),
      ],
    };
  }
  return {
    ok: true,
    groupLimit,
    ...(options.groupPageToken ? { groupPageToken: options.groupPageToken } : {}),
    ...(options.filters ? { filters: options.filters } : {}),
  };
}

function parseGroupDetailOptions(options: VersionDiffGroupDetailOptions):
  | {
      readonly ok: true;
      readonly groupId: string;
      readonly pageSize: number;
      readonly pageToken?: VersionDiffGroupDetailOptions['pageToken'];
      readonly filters?: VersionDiffFilters;
    }
  | { readonly ok: false; readonly diagnostics: readonly PublicVersionStoreDiagnostic[] } {
  const pageSize = options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT;
  if (
    !options.groupId ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_DIFF_MAX_PAGE_LIMIT
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_OPTIONS', 'diff group detail options are invalid.', {
          details: { pageSize },
        }),
      ],
    };
  }
  return {
    ok: true,
    groupId: options.groupId,
    pageSize,
    ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    ...(options.filters ? { filters: options.filters } : {}),
  };
}

async function diffProjectionDigest(
  context: DiffSemanticContext,
  filters: VersionDiffFilters | undefined,
): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.diff.projection.v1', {
    baseCommitId: context.baseCommitId,
    targetCommitId: context.targetCommitId,
    changeSetDigest: context.changeSetDigest,
    projectionVersion: DIFF_PROJECTION_VERSION,
    groupBy: 'sheet-domain-range',
    filters,
  });
}

function diffOperation(
  before: unknown,
  after: unknown,
): Exclude<VersionDiffOperation, 'mixed'> {
  const beforeEmpty = isEmptyDiffValue(before);
  const afterEmpty = isEmptyDiffValue(after);
  if (beforeEmpty && !afterEmpty) return 'added';
  if (!beforeEmpty && afterEmpty) return 'removed';
  return 'changed';
}

function isEmptyDiffValue(value: unknown): boolean {
  if (isRedacted(value)) return false;
  const raw = isRecord(value) && value.kind === 'value' ? value.value : value;
  return raw === null || (isRecord(raw) && raw.kind === 'blank');
}

function semanticChangeDisplay(
  value: Readonly<Record<string, unknown>>,
  displayContext: SemanticDiffDisplayContext,
): SemanticChange['display'] {
  const display = displayMetadata(value.display);
  if (display.sheetName) return display;

  const sheetName = sheetNameForCellSemanticChange(value, displayContext);
  return sheetName ? { ...display, sheetName } : display;
}

function displayMetadata(value: unknown): SemanticChange['display'] {
  if (!isRecord(value)) return {};
  return {
    ...(isDisplayValue(value.sheetName) ? { sheetName: value.sheetName } : {}),
    ...(isDisplayValue(value.address) ? { address: value.address } : {}),
  };
}

function cellCoordinateFromRecordEvidence(
  value: Readonly<Record<string, unknown>>,
): { readonly sheetId: string; readonly row: number; readonly column: number } | undefined {
  for (const key of ['afterRecord', 'beforeRecord'] as const) {
    const evidence = value[key];
    if (!isRecord(evidence)) continue;
    const fromRecord = isRecord(evidence.record)
      ? cellCoordinateFromRecord(evidence.record)
      : undefined;
    const fromObjectId = cellCoordinateFromObjectId(evidence.objectId);
    const coordinate = fromRecord ?? fromObjectId;
    if (coordinate) return coordinate;
  }
  return undefined;
}

function cellCoordinateFromRecord(
  value: Readonly<Record<string, unknown>>,
): { readonly sheetId: string; readonly row: number; readonly column: number } | undefined {
  const sheetId = safeString(value.sheetId);
  const row = safeCoordinate(value.row);
  const column = safeCoordinate(value.column);
  return sheetId && row !== undefined && column !== undefined
    ? { sheetId, row, column }
    : undefined;
}

function cellCoordinateFromObjectId(
  value: unknown,
): { readonly sheetId: string; readonly row: number; readonly column: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const cellObjectId = stripObjectPrefix(
    stripObjectPrefix(stripObjectPrefix(value, 'direct-format:'), 'value:'),
    'formula:',
  );
  const match = /^cell:(.+):r([0-9]+):c([0-9]+)$/.exec(cellObjectId);
  if (!match) return undefined;
  const row = Number(match[2]);
  const column = Number(match[3]);
  return Number.isSafeInteger(row) && Number.isSafeInteger(column)
    ? { sheetId: match[1]!, row, column }
    : undefined;
}

function sheetIdFromSemanticValue(value: Readonly<Record<string, unknown>>): string | undefined {
  for (const source of [value.before, value.after]) {
    const sheetId = findSemanticFieldString(source, 'sheetId');
    if (sheetId) return sheetId;
  }
  return undefined;
}

function findSemanticFieldString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value.kind === 'value' ? value.value : value;
  if (!isRecord(raw) || raw.kind !== 'object' || !Array.isArray(raw.fields)) return undefined;
  for (const field of raw.fields) {
    if (isRecord(field) && field.key === key && typeof field.value === 'string') {
      return field.value;
    }
  }
  return undefined;
}

function countBy<T, K extends string>(
  values: readonly T[],
  keyFor: (value: T) => K,
): readonly (readonly [K, number])[] {
  const counts = new Map<K, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function compareBuiltGroups(left: BuiltGroup, right: BuiltGroup): number {
  for (let index = 0; index < left.sort.length; index++) {
    const leftValue = left.sort[index]!;
    const rightValue = right.sort[index]!;
    const comparison =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
    if (comparison !== 0) return comparison;
  }
  return left.groupId.localeCompare(right.groupId);
}

function compareCellChanges(left: SemanticChange, right: SemanticChange): number {
  return (
    (left.sheetId ?? '').localeCompare(right.sheetId ?? '') ||
    (left.row ?? 0) - (right.row ?? 0) ||
    (left.column ?? 0) - (right.column ?? 0) ||
    left.sourceIndex - right.sourceIndex
  );
}

function isDisplayValue(value: unknown): value is { readonly kind: 'value'; readonly value: string } {
  return isRecord(value) && value.kind === 'value' && typeof value.value === 'string';
}

function isRedacted(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'redacted') return true;
  return Object.values(value).some((entry) => isRecord(entry) && entry.kind === 'redacted');
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function stripObjectPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
