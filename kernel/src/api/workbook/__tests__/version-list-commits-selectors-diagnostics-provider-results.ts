import {
  CHILD_COMMIT_ID,
  MISSING_COMMIT_ID,
  PARENT_A_COMMIT_ID,
  PUBLIC_LIST_PAGE_TOKEN,
  successPage,
  type FakeGraphStore,
} from './version-list-commits-selectors-test-utils';

export function enqueueListCommitsDiagnosticProviderResults(graphStore: FakeGraphStore) {
  graphStore.listCommits
    .mockResolvedValueOnce({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_INVALID_OPTIONS',
          severity: 'error',
          message: 'Branch ref is not present.',
          operation: 'listCommits',
          option: 'ref',
          details: { refMissing: true },
        },
      ],
    })
    .mockResolvedValueOnce({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_MISSING_OBJECT',
          severity: 'error',
          message: 'Commit object is missing.',
          operation: 'listCommits',
          commitId: MISSING_COMMIT_ID,
          objectKind: 'commit',
          details: { rootKind: 'commit', rootMissing: true },
        },
      ],
    })
    .mockResolvedValueOnce({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_STALE_PAGE_CURSOR',
          severity: 'error',
          message: 'Page cursor is stale.',
          operation: 'listCommits',
          option: 'pageToken',
        },
      ],
    })
    .mockResolvedValueOnce({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_INDEX_REBUILD_REQUIRED',
          severity: 'error',
          message: 'missing index manifest at /private/path/raw-ref-secret',
          operation: 'listCommits:/private/path/raw-ref-secret',
          option: 'pageToken',
          refName: 'refs/heads/scenario/raw-ref-secret',
          objectKind: 'index',
          details: {
            indexManifestMissing: true,
            indexRebuildRequired: true,
            objectKind: 'index',
            category: 'raw-ref-secret',
            cursor: 'cursor-secret',
            path: '/private/path/raw-ref-secret',
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_MISSING_PARENT',
          severity: 'corruption',
          message: `missing parent ${PARENT_A_COMMIT_ID} from child ${CHILD_COMMIT_ID}`,
          operation: 'listCommits:/private/path/raw-ref-secret',
          commitId: PARENT_A_COMMIT_ID,
          objectKind: 'commit',
          details: {
            completenessMarker: 'diagnostic-read',
            completenessScope: 'graph-metadata',
            completenessCondition: 'history-gap',
            accessFiltered: true,
            missingCommitRole: 'parent',
            childCommitId: CHILD_COMMIT_ID,
            refName: 'refs/heads/scenario/raw-ref-secret',
            path: '/private/path/raw-ref-secret',
            category: 'raw-ref-secret',
          },
        },
      ],
    })
    .mockResolvedValueOnce(successPage({ nextPageToken: 'bad-token' }))
    .mockResolvedValueOnce(successPage({ nextPageToken: 'vpt_next_page' }))
    .mockResolvedValueOnce(successPage({ nextPageToken: PUBLIC_LIST_PAGE_TOKEN }));
}
