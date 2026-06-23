import { jest } from '@jest/globals';

import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';

import {
  createSemanticDiffCommitCapture,
  defaultSemanticChanges,
  escapeRegExp,
} from './version-diff-provider-fixtures';
import {
  createCommittedDiffWorkbook,
  createDiffProvider,
  createWorkbook,
  diffCommitted,
} from './version-diff-provider-test-utils';

describe('WorkbookVersion provider-backed diff facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes semantic diff through wb.version.diff when provider-backed versioning is configured', async () => {
    const context = await createCommittedDiffWorkbook({ commitLabel: 'child' });

    await expect(diffCommitted(context)).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: {
              kind: 'metadata',
              changeId: 'child-change-1',
              domain: 'cell',
              entityId: 'sheet-1!A1',
              propertyPath: ['value'],
            },
            before: { kind: 'value', value: 1 },
            after: { kind: 'value', value: 2 },
            display: {
              sheetName: { kind: 'value', value: 'Sheet1' },
              address: { kind: 'value', value: 'A1' },
            },
          },
        ],
        limit: 50,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
  });

  it('returns opaque public cursors and rejects stale public cursor handles through wb.version.diff', async () => {
    const changes = [
      ...defaultSemanticChanges('child'),
      {
        changeId: 'child-change-2',
        domain: 'cell',
        entityId: 'sheet-1!A2',
        propertyPath: ['value'],
        before: { kind: 'value', value: 3 },
        after: { kind: 'value', value: 4 },
        display: {
          sheetName: { kind: 'value', value: 'Sheet1' },
          address: { kind: 'value', value: 'A2' },
        },
      },
    ];
    const context = await createCommittedDiffWorkbook({
      commitLabel: 'child',
      changes,
    });

    const firstPage = await diffCommitted(context, { pageSize: 1 });
    if (!firstPage.ok) throw new Error(`expected diff success: ${firstPage.error.code}`);
    const cursor = firstPage.value.nextCursor;
    expect(cursor).toEqual(
      expect.stringMatching(new RegExp(`^${escapeRegExp(VERSION_DIFF_PUBLIC_CURSOR_PREFIX)}`)),
    );
    expect(cursor).not.toContain('vc04diff');
    expect(cursor).not.toContain(context.initialized.rootCommit.id);
    expect(cursor).not.toContain(context.committed.id);

    await expect(diffCommitted(context, { pageSize: 1, pageToken: cursor })).resolves.toMatchObject(
      {
        ok: true,
        value: {
          items: [expect.objectContaining({ after: { kind: 'value', value: 4 } })],
        },
      },
    );

    const stale = await diffCommitted(context, {
      pageSize: 1,
      pageToken: `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}stale-handle`,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_STALE_PAGE_CURSOR',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                category: 'staleCursor',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(stale)).not.toContain('stale-handle');
  });

  it('continues to degrade cleanly when a provider registry is unavailable', async () => {
    const provider = createDiffProvider();
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(createSemanticDiffCommitCapture('unused')),
      },
    });

    await expect(
      wb.version.diff(`commit:sha256:${'1'.repeat(64)}`, `commit:sha256:${'2'.repeat(64)}`),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });
});
