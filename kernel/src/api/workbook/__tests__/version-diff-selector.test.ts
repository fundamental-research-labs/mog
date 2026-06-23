import { jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
} from '@mog-sdk/contracts/versioning';
import { WorkbookVersionImpl } from '../version';

const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const READ_REVISION = { kind: 'counter', value: '1' } as const;

describe('WorkbookVersion diff ref selectors', () => {
  it('passes public branch refs through to the attached diff service', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(
      ROOT_COMMIT_ID,
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        items: [],
        limit: 25,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    expect(diff).toHaveBeenCalledWith(
      { kind: 'commit', id: ROOT_COMMIT_ID },
      { kind: 'ref', name: 'refs/heads/scenario/branch' },
      { pageSize: 25 },
    );
  });

  it('rejects unsafe branch refs before calling the attached diff service', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for unsafe refs');
    });
    const version = createVersion(diff);

    const result = await version.diff(
      { kind: 'ref', name: 'refs/heads/private-review' as any },
      { kind: 'ref', name: 'HEAD' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              operation: 'diff',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector: 'base',
                refName: 'redacted',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-review');
    expect(diff).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported ref namespace', { kind: 'ref', name: 'refs/heads/private-review' }],
    ['tag ref', { kind: 'ref', name: 'refs/tags/v1' }],
    ['system ref', { kind: 'ref', name: 'refs/system/secret' }],
    ['malformed branch ref', { kind: 'ref', name: 'refs/heads/scenario/../secret' }],
  ])('rejects %s before diff service lookup', async (_label, ref) => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for unsafe refs');
    });
    const version = createVersion(diff);

    const result = await version.diff(ref as any, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector: 'base',
                refName: 'redacted',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(String(ref.name));
    expect(diff).not.toHaveBeenCalled();
  });

  it('preserves HEAD and main ref selector behavior', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    await expect(
      version.diff({ kind: 'ref', name: 'HEAD' }, { kind: 'ref', name: 'refs/heads/main' }),
    ).resolves.toMatchObject({ ok: true });

    expect(diff).toHaveBeenCalledWith(
      { kind: 'ref', name: 'HEAD' },
      { kind: 'ref', name: 'refs/heads/main' },
      {},
    );
  });

  it.each([
    ['base', 'HEAD'],
    ['target', 'refs/heads/main'],
  ] as const)('rejects stale %s ref selectors with redacted diagnostics', async (selector, refName) => {
    const hiddenCommit = `commit:sha256:${'9'.repeat(64)}`;
    const diff = jest.fn(async () => ({
      status: 'degraded',
      diagnostics: [
        {
          code: 'VERSION_DANGLING_REF',
          severity: 'error',
          selector,
          message: `${refName} points at ${hiddenCommit}`,
          details: { refName, commitId: hiddenCommit, rawRefDigest: 'sha256-secret' },
        },
      ],
    }));
    const version = createVersion(diff);

    const result = await version.diff(
      selector === 'base' ? { kind: 'ref', name: refName } : ROOT_COMMIT_ID,
      selector === 'target' ? { kind: 'ref', name: refName } : ROOT_COMMIT_ID,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_DANGLING_REF',
            message: 'The version graph could not validate the requested diff commit closure.',
            data: expect.objectContaining({
              recoverability: 'repair',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector,
                refName,
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenCommit);
    expect(serialized).not.toContain('sha256-secret');
    expect(diff).toHaveBeenCalledTimes(1);
  });

  it('returns structured diagnostics when no version diff provider is attached', async () => {
    const version = new WorkbookVersionImpl({} as any);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.diff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              operation: 'diff',
              recoverability: 'unsupported',
              redacted: true,
              payload: expect.objectContaining({ operation: 'diff' }),
            }),
          }),
        ],
      },
    });
  });

  it('rejects oversized public diff cursors before calling the attached diff service', async () => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for oversized cursors');
    });
    const version = createVersion(diff);
    const oversizedCursor =
      VERSION_DIFF_PUBLIC_CURSOR_PREFIX + 'x'.repeat(VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH + 1);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, {
      pageToken: oversizedCursor,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                option: 'pageToken',
                max: VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(oversizedCursor);
    expect(diff).not.toHaveBeenCalled();
  });

  it.each([
    ['empty public cursor handle', VERSION_DIFF_PUBLIC_CURSOR_PREFIX],
    ['cursor body with whitespace', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor handle`],
    ['cursor body with unsafe slash', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor/handle`],
    ['cursor body with unsafe percent', `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}cursor%2Fhandle`],
  ])(
    'rejects forged public diff cursor with %s before provider calls',
    async (_label, pageToken) => {
      const diff = jest.fn(async () => {
        throw new Error('diff service should not be called for forged cursors');
      });
      const version = createVersion(diff);

      const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, { pageToken });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  option: 'pageToken',
                }),
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(pageToken);
      expect(diff).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong diff order key', 'mog-vdiff-v1.topological-newest.cursor-handle'],
    ['wrong diff cursor schema version', 'mog-vdiff-v2.semantic-change-order.cursor-handle'],
    ['foreign pagination cursor', 'mog-vcommits-v1.topological-newest.cursor-handle'],
  ])('rejects %s before provider calls', async (_label, pageToken) => {
    const diff = jest.fn(async () => {
      throw new Error('diff service should not be called for wrong-order cursors');
    });
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID, { pageToken });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                option: 'pageToken',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(pageToken);
    expect(diff).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unsupported domain',
      {
        code: 'unsupportedDomain',
        severity: 'error',
        message: 'Unsupported authored domain omitted for principal-secret.',
        details: {
          category: 'unsupported',
          completenessCode: 'unsupportedDomain',
          completenessSeverity: 'error',
          path: 'domains.pivots',
          domain: 'pivots',
          deniedPrincipalId: 'principal-secret',
          omittedDomains: 'macros.vba',
          rawDomainDigest: 'sha256-secret',
        },
      },
      'unsupported',
      'The requested version diff includes unsupported semantic state.',
      ['principal-secret', 'omittedDomains', 'macros.vba', 'rawDomainDigest', 'sha256-secret'],
    ],
    [
      'subset-hidden domain',
      {
        code: 'indexKeyedRowVisibility',
        severity: 'error',
        message: 'Row hidden state exposes secret-row-ids.',
        details: {
          category: 'subset-hidden',
          completenessCode: 'indexKeyedRowVisibility',
          completenessSeverity: 'error',
          path: 'sheets.sheet-1.rows.visibility',
          domain: 'rows',
          hiddenRowIds: 'secret-row-ids',
          redactionBypassKey: 'secret-redaction-key',
        },
      },
      'subset-hidden',
      'The requested version diff includes subset-hidden semantic state.',
      ['secret-row-ids', 'hiddenRowIds', 'secret-redaction-key', 'redactionBypassKey'],
    ],
  ] as const)(
    'redacts provider-only fields from %s completeness diagnostics',
    async (_label, diagnostic, category, safeMessage, forbiddenTerms) => {
      const diff = jest.fn(async () => ({
        status: 'degraded',
        diagnostics: [diagnostic],
      }));
      const version = createVersion(diff);

      const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: diagnostic.code,
              message: safeMessage,
              data: expect.objectContaining({
                recoverability: 'unsupported',
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  category,
                  completenessCode: diagnostic.code,
                  completenessSeverity: diagnostic.severity,
                }),
              }),
            }),
          ],
        },
      });
      expect(diff).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(diagnostic.message);
      for (const term of forbiddenTerms) {
        expect(serialized).not.toContain(term);
      }
    },
  );

  it('preserves redacted diff entries without exposing hidden domain metadata', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        {
          structural: { kind: 'redacted', reason: 'redaction-policy' },
          before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
          after: { kind: 'redacted', reason: 'redaction-policy' },
          display: {
            entityLabel: { kind: 'redacted', reason: 'permission-denied' },
          },
        },
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: { kind: 'redacted', reason: 'redaction-policy' },
            before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
            after: { kind: 'redacted', reason: 'redaction-policy' },
            display: {
              entityLabel: { kind: 'redacted', reason: 'permission-denied' },
            },
          },
        ],
        limit: 50,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('domain');
  });

  it('redacts cell coordinates when provider redacts cell values', async () => {
    const hiddenSheet = 'Payroll FY27';
    const hiddenAddress = 'Payroll FY27!B9';
    const hiddenEntity = 'sheet-payroll-secret!B9';
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'payroll-secret-cell',
            domain: 'cell',
            entityId: hiddenEntity,
            propertyPath: ['value'],
          },
          before: { kind: 'redacted', reason: 'permission-denied' },
          after: { kind: 'redacted', reason: 'redaction-policy' },
          display: {
            sheetName: { kind: 'value', value: hiddenSheet },
            address: { kind: 'value', value: hiddenAddress },
          },
        },
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: { kind: 'redacted', reason: 'permission-denied' },
            before: { kind: 'redacted', reason: 'permission-denied' },
            after: { kind: 'redacted', reason: 'redaction-policy' },
            display: {
              sheetName: { kind: 'redacted', reason: 'permission-denied' },
              address: { kind: 'redacted', reason: 'permission-denied' },
            },
          },
        ],
        limit: 50,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheet);
    expect(serialized).not.toContain(hiddenAddress);
    expect(serialized).not.toContain(hiddenEntity);
    expect(serialized).not.toContain('payroll-secret-cell');
  });

  it('orders explicit semantic diff keys before returning a public page', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        orderedCellChange('third', 30),
        orderedCellChange('first', 10),
        orderedCellChange('second', 20),
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items.map((item) => item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it.each([
    [
      'missing object',
      {
        code: 'VERSION_OBJECT_NOT_FOUND',
        severity: 'error',
        selector: 'target',
        message: `missing object commit:sha256:${'a'.repeat(64)}`,
      },
      'VERSION_MISSING_OBJECT',
      'repair',
      { selector: 'target' },
      [`commit:sha256:${'a'.repeat(64)}`],
    ],
    [
      'provider unavailable',
      {
        code: 'VERSION_STORE_UNAVAILABLE',
        severity: 'warning',
        message: 'IndexedDB unavailable for secret-provider-token.',
        payload: { reason: 'provider-unavailable', source: 'secret-provider-token' },
      },
      'VERSION_STORE_UNAVAILABLE',
      'unsupported',
      { reason: 'provider-unavailable', source: 'redacted' },
      ['secret-provider-token'],
    ],
    [
      'stale selector handle',
      {
        code: 'VERSION_STALE_SELECTOR',
        severity: 'warning',
        selector: 'base',
        message: 'selector handle stale-public-branch is no longer valid.',
        details: {
          category: 'staleSelector',
          refName: 'refs/heads/scenario/secret-branch',
          reason: 'stale-selector',
          source: 'selector-secret-token',
        },
      },
      'VERSION_STALE_SELECTOR',
      'retry',
      { selector: 'base', category: 'staleSelector', reason: 'stale-selector', source: 'redacted' },
      ['stale-public-branch', 'refs/heads/scenario/secret-branch', 'selector-secret-token'],
    ],
  ] as const)('sanitizes %s diagnostics from arbitrary providers', async (_label, diagnostic, code, recoverability, payload, forbiddenTerms) => {
    const diff = jest.fn(async () => ({ status: 'degraded', diagnostics: [diagnostic] }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code,
            data: expect.objectContaining({
              recoverability,
              redacted: true,
              payload: expect.objectContaining({ operation: 'diff', ...payload }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    for (const term of forbiddenTerms) expect(serialized).not.toContain(term);
  });

  it.each([
    ['non-semantic order key', { order: 'topological-newest' }],
    ['missing order key', {}],
  ])('rejects diff service pages with %s', async (_label, orderPatch) => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [],
      readRevision: READ_REVISION,
      ...orderPatch,
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              redacted: true,
              recoverability: 'repair',
            }),
          }),
        ],
      },
    });
    expect(result).not.toHaveProperty('value');
  });
});

function createVersion(diff: jest.Mock) {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: { diff },
    },
  } as any);
}

function orderedCellChange(changeId: string, domainOrder: number) {
  return {
    pageCursorOrderKey: {
      domainOrder,
      hashPropertyPath: `/cells/${changeId}/value`,
      hashIdentity: `sheet-1!${changeId}`,
      valueClass: 'authored',
    },
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cell',
      entityId: `sheet-1!${changeId}`,
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: changeId },
    display: { address: { kind: 'value', value: changeId } },
  };
}
