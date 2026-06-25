import type {
  RedactedVersionAuthor,
  VersionCommitPage,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { VERSION_LIST_COMMITS_PAGE_ORDER } from './version-list-commits-constants';
import {
  degradedCommitPage,
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-list-commits-diagnostics';
import { toPageToken } from './version-list-commits-options';
import { isRecord, toCommitId, toRevision } from './version-list-commits-utils';
import { mapWorkbookCommitAnnotationSummary } from '../version-commit-summary-projection';

export function mapCommitPageResult(
  value: unknown,
  context: {
    readonly requestedRootCommitId?: WorkbookCommitId;
    readonly isFollowUpPage: boolean;
  },
): VersionCommitPage {
  if (!isRecord(value)) {
    return degradedCommitPage([providerErrorDiagnostic()]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedCommitPage(mapGraphDiagnostics(value.diagnostics));
  }

  if (value.status !== 'success') {
    return degradedCommitPage([providerErrorDiagnostic()]);
  }

  const readRevision = toRevision(value.readRevision);
  const order = value.order;
  const sourceItems = Array.isArray(value.commits)
    ? value.commits
    : Array.isArray(value.items)
      ? value.items
      : null;

  if (!readRevision || order !== VERSION_LIST_COMMITS_PAGE_ORDER || !sourceItems) {
    return degradedCommitPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version graph commit page did not contain a valid public page shape.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: {
            ...(order !== VERSION_LIST_COMMITS_PAGE_ORDER ? { orderMismatch: true } : {}),
          },
        },
      ),
    ]);
  }

  const { items, diagnostics } = mapCommitSummaries(sourceItems);
  if (diagnostics.length > 0) {
    return {
      status: 'degraded',
      items,
      readRevision,
      order: VERSION_LIST_COMMITS_PAGE_ORDER,
      diagnostics,
    };
  }

  const pageDiagnostics = validateCommitPageOrder(items, context);
  if (pageDiagnostics.length > 0) {
    return {
      status: 'degraded',
      items: [],
      readRevision,
      order: VERSION_LIST_COMMITS_PAGE_ORDER,
      diagnostics: pageDiagnostics,
    };
  }

  const nextPageToken =
    value.nextPageToken === undefined ? undefined : toPageToken(value.nextPageToken);
  if (value.nextPageToken !== undefined && !nextPageToken) {
    return {
      status: 'degraded',
      items: [],
      readRevision,
      order: VERSION_LIST_COMMITS_PAGE_ORDER,
      diagnostics: [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned a malformed listCommits page cursor.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { option: 'pageToken', cursorMalformed: true },
          },
        ),
      ],
    };
  }

  return {
    status: 'success',
    items,
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision,
    order: VERSION_LIST_COMMITS_PAGE_ORDER,
    diagnostics: [],
  };
}

function validateCommitPageOrder(
  items: readonly WorkbookCommitSummary[],
  context: {
    readonly requestedRootCommitId?: WorkbookCommitId;
    readonly isFollowUpPage: boolean;
  },
): readonly VersionStoreDiagnostic[] {
  if (items.length === 0) return [];

  if (
    context.requestedRootCommitId !== undefined &&
    !context.isFollowUpPage &&
    items[0]?.id !== context.requestedRootCommitId
  ) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version graph did not start listCommits at the requested commit root.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { rootMismatch: true },
        },
      ),
    ];
  }

  const indexByCommitId = new Map<WorkbookCommitId, number>();
  for (const [index, item] of items.entries()) {
    const previousIndex = indexByCommitId.get(item.id);
    if (previousIndex !== undefined) {
      return [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned duplicate commits in one listCommits page.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { itemIndex: index, duplicateOfItemIndex: previousIndex },
          },
        ),
      ];
    }
    indexByCommitId.set(item.id, index);
  }

  const reachableFromEarlierItems = new Set<WorkbookCommitId>();
  for (const [index, item] of items.entries()) {
    if (!context.isFollowUpPage && index > 0 && !reachableFromEarlierItems.has(item.id)) {
      return [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned a commit outside the first-page root traversal.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { itemIndex: index, rootTraversal: false },
          },
        ),
      ];
    }

    for (const parentId of item.parents) {
      const parentIndex = indexByCommitId.get(parentId);
      if (parentIndex !== undefined && parentIndex <= index) {
        return [
          publicDiagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'The version graph returned a parent before its reachable child.',
            {
              severity: 'error',
              recoverability: 'repair',
              payload: { itemIndex: index, parentItemIndex: parentIndex },
            },
          ),
        ];
      }
      reachableFromEarlierItems.add(parentId);
    }
  }

  const deterministicDiagnostics = validateDeterministicParentTieBreaks(items, indexByCommitId);
  if (deterministicDiagnostics.length > 0) return deterministicDiagnostics;

  return [];
}

function validateDeterministicParentTieBreaks(
  items: readonly WorkbookCommitSummary[],
  indexByCommitId: ReadonlyMap<WorkbookCommitId, number>,
): readonly VersionStoreDiagnostic[] {
  const itemByCommitId = new Map(items.map((item) => [item.id, item] as const));

  for (const item of items) {
    const visibleParents = item.parents.flatMap((parentId) => {
      const index = indexByCommitId.get(parentId);
      const parent = itemByCommitId.get(parentId);
      return index === undefined || !parent ? [] : [{ index, parent }];
    });
    if (visibleParents.length < 2) continue;

    const expected = [...visibleParents].sort((left, right) =>
      compareVisibleMergeParentsForPageOrder(left.parent, right.parent, itemByCommitId),
    );
    for (let index = 1; index < expected.length; index += 1) {
      const previous = expected[index - 1]!;
      const current = expected[index]!;
      if (previous.index < current.index) continue;
      return [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned commits without deterministic listCommits tie-break order.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: {
              itemIndex: current.index,
              parentItemIndex: previous.index,
              deterministicOrder: false,
            },
          },
        ),
      ];
    }
  }

  return [];
}

function compareVisibleMergeParentsForPageOrder(
  left: WorkbookCommitSummary,
  right: WorkbookCommitSummary,
  itemByCommitId: ReadonlyMap<WorkbookCommitId, WorkbookCommitSummary>,
): number {
  if (isCommitReachableFrom(left.id, right.id, itemByCommitId)) return 1;
  if (isCommitReachableFrom(right.id, left.id, itemByCommitId)) return -1;
  return compareCommitSummariesForPageOrder(left, right);
}

function isCommitReachableFrom(
  targetId: WorkbookCommitId,
  sourceId: WorkbookCommitId,
  itemByCommitId: ReadonlyMap<WorkbookCommitId, WorkbookCommitSummary>,
): boolean {
  const pending = [...(itemByCommitId.get(sourceId)?.parents ?? [])];
  const visited = new Set<WorkbookCommitId>();

  while (pending.length > 0) {
    const commitId = pending.pop()!;
    if (commitId === targetId) return true;
    if (visited.has(commitId)) continue;
    visited.add(commitId);
    pending.push(...(itemByCommitId.get(commitId)?.parents ?? []));
  }

  return false;
}

function compareCommitSummariesForPageOrder(
  left: WorkbookCommitSummary,
  right: WorkbookCommitSummary,
): number {
  const createdAt = compareStrings(right.createdAt, left.createdAt);
  return createdAt === 0 ? compareStrings(left.id, right.id) : createdAt;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function mapCommitSummaries(values: readonly unknown[]): {
  readonly items: readonly WorkbookCommitSummary[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: WorkbookCommitSummary[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];

  values.forEach((value, index) => {
    const summary = mapCommitSummary(value);
    if (summary) {
      items.push(summary);
      return;
    }

    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'A version graph commit summary could not be safely projected.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { itemIndex: index },
        },
      ),
    );
  });

  return { items, diagnostics };
}

function mapCommitSummary(value: unknown): WorkbookCommitSummary | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.payload) ? value.payload : null;

  const id = toCommitId(value.id);
  const createdAt =
    typeof value.createdAt === 'string'
      ? value.createdAt
      : typeof payload?.createdAt === 'string'
        ? payload.createdAt
        : null;
  if (!id || !createdAt) return null;

  const parentsValue = Array.isArray(value.parents)
    ? value.parents
    : Array.isArray(value.parentCommitIds)
      ? value.parentCommitIds
      : Array.isArray(payload?.parentCommitIds)
        ? payload.parentCommitIds
        : null;
  if (!parentsValue) return null;

  const parents = parentsValue
    .map(toCommitId)
    .filter((parent): parent is WorkbookCommitId => Boolean(parent));
  if (parents.length !== parentsValue.length) return null;

  const annotation = mapWorkbookCommitAnnotationSummary(value.annotation ?? payload?.annotation);

  return {
    id,
    parents,
    createdAt,
    author: redactAuthor(value.author ?? payload?.author),
    ...(annotation ? { annotation } : {}),
  };
}

function redactAuthor(value: unknown): RedactedVersionAuthor {
  if (!isRecord(value)) return { redacted: true };
  return {
    ...(typeof value.actorKind === 'string' ? { actorKind: value.actorKind } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    redacted: true,
  };
}
