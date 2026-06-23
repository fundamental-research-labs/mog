import { expect, it } from '@jest/globals';

import { COMMIT_A, createWorkbookVersionWithBranchService } from './version-refs-test-utils';

export function registerPublicRefListFilterScenario(): void {
  it('filters listRefs by namespace only without mutating state', async () => {
    const { version } = createWorkbookVersionWithBranchService();

    await version.createBranch({ name: 'scenario/budget' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'scenario/forecast/q1' as any, targetCommitId: COMMIT_A });
    await version.createBranch({ name: 'agent/run-1' as any, targetCommitId: COMMIT_A });

    const scenarioRefs = await version.listRefs({ prefix: 'scenario' as any });
    expect(scenarioRefs.ok).toBe(true);
    if (!scenarioRefs.ok) throw new Error(`expected listRefs success: ${scenarioRefs.error.code}`);
    expect(scenarioRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(scenarioRefs.value.items).toHaveLength(2);

    const fullNamespaceRefs = await version.listRefs({ prefix: 'refs/heads/scenario' as any });
    expect(fullNamespaceRefs).toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
          expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
        ],
        limit: 50,
      },
    });
    expect(fullNamespaceRefs.ok && fullNamespaceRefs.value.items).toHaveLength(2);

    await expect(
      version.listRefs({ prefix: 'refs/heads/scenario/forecast' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'prefix' }),
            }),
          }),
        ],
      },
    });

    const allRefs = await version.listRefs();
    expect(allRefs.ok).toBe(true);
    if (!allRefs.ok) throw new Error(`expected listRefs success: ${allRefs.error.code}`);
    expect(allRefs.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refs/heads/main' }),
        expect.objectContaining({ name: 'refs/heads/agent/run-1' }),
        expect.objectContaining({ name: 'refs/heads/scenario/budget' }),
        expect.objectContaining({ name: 'refs/heads/scenario/forecast/q1' }),
      ]),
    );
    expect(allRefs.value.items).toHaveLength(4);
    expect(allRefs.value.limit).toBe(50);
  });
}
