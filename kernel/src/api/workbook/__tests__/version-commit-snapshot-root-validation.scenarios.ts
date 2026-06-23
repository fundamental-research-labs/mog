import { jest } from '@jest/globals';

import { createWorkbookVersion } from './version-commit-snapshot-root.helpers';

export function registerSnapshotRootValidationScenarios(): void {
  it.each([
    ['root', 'root-materialization-secret'],
    ['import-root', 'import-root-materialization-secret'],
  ])(
    'rejects public %s materialization inputs before the write service runs',
    async (kind, secret) => {
      const commit = jest.fn(async () => ({ status: 'success' }));
      const version = createWorkbookVersion({ writeService: { commit } as any });

      const result = await version.commit({
        mode: { kind, materializationEvidence: secret },
        snapshotRootDigest: secret,
      } as any);

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' }),
            expect.objectContaining({
              code: 'VERSION_INVALID_OPTIONS',
              data: expect.objectContaining({
                payload: expect.objectContaining({ option: 'snapshotRootDigest' }),
              }),
            }),
          ]),
        },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('rejects direct annotation and redaction digest binding before delegation', async () => {
    const commit = jest.fn(async () => ({ status: 'success' }));
    const secret = 'redaction-digest-binding-secret';
    const version = createWorkbookVersion({ writeService: { commit } as any });

    const result = await version.commit({
      message: 'Safe message',
      annotationDigest: secret,
      redactionPolicyDigest: { algorithm: 'sha256', digest: secret },
    } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'annotationDigest' }),
            }),
          }),
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({ option: 'redactionPolicyDigest' }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(commit).not.toHaveBeenCalled();
  });

  it('maps missing and corrupt snapshot-root diagnostics to public VC-04 payloads', async () => {
    const secret = 'raw-snapshot-root-digest-secret';
    const commit = jest.fn(async () => ({
      status: 'failed',
      diagnostics: [
        {
          issueCode: 'VERSION_MISSING_DEPENDENCY',
          severity: 'error',
          mutationGuarantee: 'ref-not-mutated',
          sourceDiagnostics: [
            {
              dependency: {
                kind: 'object',
                objectType: 'workbook.snapshotRoot.v1',
                digest: { algorithm: 'sha256', digest: secret },
              },
            },
          ],
        },
        {
          issueCode: 'VERSION_DIGEST_MISMATCH',
          severity: 'corruption',
          mutationGuarantee: 'ref-not-mutated',
          objectType: 'workbook.snapshotRoot.v1',
          objectDigest: { algorithm: 'sha256', digest: secret },
        },
      ],
      mutationGuarantee: 'ref-not-mutated',
    }));
    const version = createWorkbookVersion({ writeService: { commit } as any });

    const result = await version.commit();

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_MISSING_SNAPSHOT_ROOT',
            message: 'The version commit is missing its materializable snapshot root.',
            data: expect.objectContaining({
              mutationGuarantee: 'ref-not-mutated',
              payload: expect.objectContaining({
                operation: 'validateCommitClosure',
                objectKind: 'snapshot-root',
              }),
            }),
          }),
          expect.objectContaining({
            code: 'VERSION_DIGEST_MISMATCH',
            message: 'A version commit object digest does not match its canonical bytes.',
            data: expect.objectContaining({
              payload: expect.objectContaining({ objectKind: 'snapshot-root' }),
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
}
