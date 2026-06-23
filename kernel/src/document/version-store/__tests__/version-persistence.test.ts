import { createVersionPersistence } from '../version-persistence';

describe('VersionPersistence', () => {
  it('fails closed when no materialization service or provider is attached', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.reload({
      target: 'commit',
      commitId: 'commit:sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE',
        severity: 'error',
      }),
    ]);
  });
});
