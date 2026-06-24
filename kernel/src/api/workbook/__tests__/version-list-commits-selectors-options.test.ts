import {
  DIFF_PAGE_TOKEN,
  PAGE_TOKEN,
  ROOT_COMMIT_ID,
  createFakeGraphStore,
  createVersion,
} from './version-list-commits-selectors-test-utils';

describe('WorkbookVersion listCommits selector option validation', () => {
  it('validates listCommits options before calling the graph service', async () => {
    const cases: readonly [string, unknown, string, string | undefined][] = [
      ['non-object options', null, 'VERSION_INVALID_OPTIONS', 'options'],
      ['unknown option', { unexpected: true }, 'VERSION_INVALID_OPTIONS', 'unexpected'],
      ['bad page size', { pageSize: 0 }, 'VERSION_INVALID_OPTIONS', 'pageSize'],
      [
        'ref and from together',
        { ref: 'refs/heads/main', from: ROOT_COMMIT_ID },
        'VERSION_INVALID_OPTIONS',
        'ref',
      ],
      ['malformed commit id', { from: 'commit:sha256:bad' }, 'VERSION_INVALID_COMMIT_ID', 'from'],
      [
        'unsafe branch ref',
        { ref: 'refs/heads/private-review.lock' },
        'VERSION_INVALID_OPTIONS',
        'ref',
      ],
      ['uppercase ref', { ref: 'refs/heads/scenario/Bad' }, 'VERSION_INVALID_OPTIONS', 'ref'],
      ['non-heads ref', { ref: 'refs/tags/not-public' }, 'VERSION_INVALID_OPTIONS', 'ref'],
      [
        'non-boolean includeOrphans',
        { includeOrphans: 'yes' },
        'VERSION_INVALID_OPTIONS',
        'includeOrphans',
      ],
      [
        'unsupported includeOrphans',
        { includeOrphans: true },
        'VERSION_PERMISSION_DENIED',
        'includeOrphans',
      ],
      [
        'non-boolean includeDiagnostics',
        { includeDiagnostics: 'yes' },
        'VERSION_INVALID_OPTIONS',
        'includeDiagnostics',
      ],
      ['malformed pageToken', { pageToken: 'bad-token' }, 'VERSION_INVALID_OPTIONS', 'pageToken'],
      [
        'wrong-operation pageToken',
        { pageToken: DIFF_PAGE_TOKEN },
        'VERSION_STALE_PAGE_CURSOR',
        'pageToken',
      ],
      [
        'wrong-order list pageToken',
        { pageToken: 'mog-vcommits-v1.semantic-change-order.cursor-handle' },
        'VERSION_STALE_PAGE_CURSOR',
        'pageToken',
      ],
      [
        'pageToken with ref scope',
        { pageToken: PAGE_TOKEN, ref: 'refs/heads/main' },
        'VERSION_STALE_PAGE_CURSOR',
        'pageToken',
      ],
    ];

    for (const [_name, options, code, option] of cases) {
      const graphStore = createFakeGraphStore();
      const version = createVersion(graphStore);
      const result = await version.listCommits(options as never);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.listCommits',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code,
              data: expect.objectContaining({
                redacted: true,
                ...(option ? { payload: expect.objectContaining({ option }) } : {}),
              }),
            }),
          ]),
        },
      });
      expect(JSON.stringify(result)).not.toContain(
        typeof options === 'object' && options && 'ref' in options
          ? String((options as { ref?: unknown }).ref)
          : 'refs/heads/private-review.lock',
      );
      expect(graphStore.listCommits).not.toHaveBeenCalled();
    }
  });
});
