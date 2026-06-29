import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  VersionDiffOverview,
  VersionSemanticDiffPage,
  VersionWorkingTreeDiffPage,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { VersionHistoryDiffPreview, type VersionDiffPreview } from './VersionHistoryDiffPreview';
import { readVersionResult, type VersionHistoryWorkbook } from './version-history-panel-data';

const WORKING_TREE_DIFF_PAGE_SIZE = 50;

export function VersionHistoryWorkingTreeDiffPreview({
  page,
  workbook,
}: {
  readonly page: VersionWorkingTreeDiffPage;
  readonly workbook: VersionHistoryWorkbook;
}): React.JSX.Element {
  const [pages, setPages] = useState<readonly VersionWorkingTreeDiffPage[]>([page]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPages([page]);
    setLoading(false);
  }, [page.workingTreeDiffId]);

  const lastPage = pages[pages.length - 1] ?? page;
  const loadMore = useCallback(async () => {
    if (!lastPage.nextCursor || loading) return;
    setLoading(true);
    const result = await readVersionResult('VERSION_UI_WORKING_TREE_DIFF_FAILED', () =>
      workbook.version.diffWorkingTree({
        pageSize: WORKING_TREE_DIFF_PAGE_SIZE,
        pageToken: lastPage.nextCursor,
        includeDiagnostics: true,
      }),
    );
    setLoading(false);
    if (!result.ok) return;
    setPages((current) => [...current, result.value]);
  }, [lastPage.nextCursor, loading, workbook]);

  const preview = useMemo(
    () => workingTreeDiffPreviewFromPages(page, pages, lastPage, loading),
    [lastPage, loading, page, pages],
  );

  return (
    <div
      role="region"
      aria-label="Working tree diff"
      data-testid="version-history-working-tree-diff-viewer"
    >
      <VersionHistoryDiffPreview
        diffPreview={preview}
        onLoadMoreGroups={noop}
        onSelectGroup={noop}
        onLoadMoreDetail={loadMore}
      />
    </div>
  );
}

function workingTreeDiffPreviewFromPages(
  firstPage: VersionWorkingTreeDiffPage,
  pages: readonly VersionWorkingTreeDiffPage[],
  lastPage: VersionWorkingTreeDiffPage,
  loading: boolean,
): VersionDiffPreview {
  const items = pages.flatMap((candidate) => candidate.items);
  return {
    base: firstPage.baseCommitId,
    target: syntheticWorkingTreeTargetCommitId(firstPage.workingTreeDiffId),
    targetLabel: 'working tree',
    overview: workingTreeDiffOverview(firstPage),
    detailPages: pages.map(semanticPageFromWorkingTreePage),
    detailItems: items,
    loadedDetailCount: items.length,
    loadedDetailPageCount: pages.length,
    hasMoreDetail: Boolean(lastPage.nextCursor),
    loadingGroups: false,
    loadingDetail: loading,
    inlineDetailMode: true,
    inlineDetailItems: items,
    loadingInlineDetail: loading,
    inlineDetailHasMore: Boolean(lastPage.nextCursor),
  };
}

function semanticPageFromWorkingTreePage(
  page: VersionWorkingTreeDiffPage,
): VersionSemanticDiffPage {
  return {
    items: page.items,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    limit: page.limit,
    readRevision: page.readRevision,
    order: page.order,
    ...(page.resourceLimits ? { resourceLimits: page.resourceLimits } : {}),
  };
}

function workingTreeDiffOverview(page: VersionWorkingTreeDiffPage): VersionDiffOverview {
  if (page.overview) {
    return {
      ...page.overview,
      targetCommitId: syntheticWorkingTreeTargetCommitId(page.workingTreeDiffId),
    } as VersionDiffOverview;
  }
  return {
    baseCommitId: page.baseCommitId,
    targetCommitId: syntheticWorkingTreeTargetCommitId(page.workingTreeDiffId),
    readRevision: page.readRevision,
    order: page.order,
    summary: {
      minimumChangeCount: page.items.length,
      countPrecision: page.nextCursor ? 'lowerBound' : 'exact',
      domainCounts: [],
      operationCounts: [],
      incomplete: Boolean(page.nextCursor),
      diagnostics: [],
    },
    groups: {
      items: [],
      limit: 0,
      totalEstimate: 0,
    },
    unsupportedFilters: [],
    diagnostics: [],
    ...(page.resourceLimits ? { resourceLimits: page.resourceLimits } : {}),
  };
}

function syntheticWorkingTreeTargetCommitId(workingTreeDiffId: string): WorkbookCommitId {
  const digest = workingTreeDiffId.match(/[a-f0-9]{64}$/)?.[0] ?? '0'.repeat(64);
  return `commit:sha256:${digest}` as WorkbookCommitId;
}

function noop(): void {
  return undefined;
}
