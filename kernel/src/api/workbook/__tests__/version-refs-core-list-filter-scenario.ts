import { expect, it } from '@jest/globals';

import { COMMIT_A, createWorkbookVersionWithBranchService } from './version-refs-test-utils';

export function registerPublicRefListFilterScenario(): void {
  it('filters listRefs by branch-name prefix without mutating state', async () => {
    const { version } = createWorkbookVersionWithBranchService();

    await version.createBranch({ name: 'budget' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'budget/forecast/q1' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'analysis/run-1' as any, targetCommitId: COMMIT_A });

    const budgetRefs = await version.listRefs({ prefix: 'budget' as any });
    expect(budgetRefs.ok).toBe(true);
    if (!budgetRefs.ok) throw new Error(`expected listRefs success: ${budgetRefs.error.code}`);
    expect(budgetRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/budget' }),
        expect.objectContaining({ name: 'refs/heads/budget/forecast/q1' }),
      ]),
    );
    expect(budgetRefs.value.items).toHaveLength(2);

    const fullPrefixRefs = await version.listRefs({ prefix: 'refs/heads/budget/forecast' as any });
    expect(fullPrefixRefs).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ name: 'refs/heads/budget/forecast/q1' })],
        limit: 50,
      },
    });
    expect(fullPrefixRefs.ok && fullPrefixRefs.value.items).toHaveLength(1);

    await expect(
      version.listRefs({ prefix: 'refs/heads/budget//forecast' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'prefix' }),
            }),
          }),
        ]),
      },
    });

    await expect(version.listRefs({ prefix: 'main' as any })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ name: 'refs/heads/main' })],
        limit: 50,
      },
    });

    const allRefs = await version.listRefs();
    expect(allRefs.ok).toBe(true);
    if (!allRefs.ok) throw new Error(`expected listRefs success: ${allRefs.error.code}`);
    expect(allRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/main' }),
        expect.objectContaining({ name: 'refs/heads/analysis/run-1' }),
        expect.objectContaining({ name: 'refs/heads/budget' }),
        expect.objectContaining({ name: 'refs/heads/budget/forecast/q1' }),
      ]),
    );
    expect(allRefs.value.items).toHaveLength(4);
    expect(allRefs.value.limit).toBe(50);
  });
}
