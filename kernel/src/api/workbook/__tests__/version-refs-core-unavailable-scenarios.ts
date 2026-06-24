import { expect, it } from '@jest/globals';

import { createInMemoryRefStore } from '../../../document/version-store/refs/ref-store';
import { WorkbookVersionImpl } from '../version';
import { AUTHOR, COMMIT_A, refVersion } from './version-refs-test-utils';

export function registerPublicRefUnavailableScenarios(): void {
  it('fails closed when no branch service is attached', async () => {
    const version = new WorkbookVersionImpl({ versioning: {} } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });

    await expect(
      version.createBranch({ name: 'scenario/missing' as any, targetCommitId: COMMIT_A }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });

    await expect(
      version.deleteRef({
        name: 'scenario/missing' as any,
        expectedHead: COMMIT_A,
        expectedRefRevision: refVersion('0'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REF_WRITE_UNAVAILABLE',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
  });

  it('does not treat a raw ref store as a trusted public branch service', async () => {
    const refStore = createInMemoryRefStore({
      versionDocumentId: 'version-doc-1',
      now: () => '2026-06-20T00:00:00.000Z',
    });
    const main = refStore.initializeMain({ targetCommitId: COMMIT_A, createdBy: AUTHOR });
    expect(main.ok).toBe(true);

    const version = new WorkbookVersionImpl({
      versioning: { refStore },
    } as any);

    await expect(version.listRefs()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
      },
    });
  });
}
