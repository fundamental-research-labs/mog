import { expect, it, jest } from '@jest/globals';

import {
  createVersion,
  orderedCellChange,
  READ_REVISION,
  ROOT_COMMIT_ID,
} from './version-diff-selector-test-utils';

export function registerSelectorPageScenarios(): void {
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
    expect(
      result.value.items.map((item) =>
        item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind,
      ),
    ).toEqual(['first', 'second', 'third']);
  });

  it('assigns strict order ids to duplicate merge no-op semantic entries', async () => {
    const changes = Array.from({ length: 12 }, () => duplicateMergeNoopChange());
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        changes[11]!,
        changes[1]!,
        changes[10]!,
        changes[0]!,
        changes[9]!,
        changes[2]!,
        changes[8]!,
        changes[3]!,
        changes[7]!,
        changes[4]!,
        changes[6]!,
        changes[5]!,
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    const ids = result.value.items.map((item) =>
      item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind,
    );
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toEqual([...ids].sort());
    expect(ids.every((id) => id.startsWith('merge-noop-cell~'))).toBe(true);
    expect(
      result.value.items.every(
        (item) => JSON.stringify(item.before) === JSON.stringify(item.after),
      ),
    ).toBe(true);
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
      {
        selector: 'base',
        category: 'staleSelector',
        reason: 'stale-selector',
        source: 'redacted',
      },
      ['stale-public-branch', 'refs/heads/scenario/secret-branch', 'selector-secret-token'],
    ],
  ] as const)(
    'sanitizes %s diagnostics from arbitrary providers',
    async (_label, diagnostic, code, recoverability, payload, forbiddenTerms) => {
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
    },
  );

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
}

function duplicateMergeNoopChange() {
  return {
    pageCursorOrderKey: {
      domainOrder: 20,
      hashPropertyPath: '/sheets/sheet-1/cells/A1/value',
      canonicalEventKey: 'merge-result:no-op',
      hashIdentity: 'sheet-1!A1',
      valueClass: 'noop',
    },
    structural: {
      kind: 'metadata',
      changeId: 'merge-noop-cell',
      domain: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: 'unchanged' },
    after: { kind: 'value', value: 'unchanged' },
    display: {
      sheetName: { kind: 'value', value: 'Sheet1' },
      address: { kind: 'value', value: 'A1' },
    },
  };
}
