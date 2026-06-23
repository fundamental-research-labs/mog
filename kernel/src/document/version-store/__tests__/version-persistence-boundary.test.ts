import { jest } from '@jest/globals';

import { createVersionPersistence } from '../version-persistence';
import {
  createVersionPersistenceTestProvider,
  initializeGraphRoot,
  objectRecord,
  versionPersistenceNamespace,
} from './version-persistence-test-utils';

describe('VersionPersistence', () => {
  it('diagnoses object-written ref-not-advanced boundaries without mutating the visible graph', async () => {
    const namespace = versionPersistenceNamespace('graph-1');
    const provider = createVersionPersistenceTestProvider();
    const initialized = await initializeGraphRoot({
      provider,
      graphId: namespace.graphId,
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
    });
    const before = await provider.readGraphRegistry();
    expect(before.status).toBe('ok');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
    });
    const after = await provider.readGraphRegistry();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected boundary success: ${result.error.code}`);
    expect(result).toMatchObject({
      status: 'diagnosed',
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
      graphId: 'graph-1',
      recoveryAction: 'reload-visible-graph',
      mutationGuarantee: 'ref-not-mutated',
      retryable: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED',
          severity: 'warning',
          recoveryAction: 'reload-visible-graph',
        }),
      ],
    });
    expect(after).toEqual(before);
  });

  it('fails persistence-boundary diagnostics closed without a provider', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.retryable).toBe(false);
  });

  it('rejects unsupported persistence-boundary requests before provider reads', async () => {
    const provider = createVersionPersistenceTestProvider();
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'unsupported-boundary',
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(readGraphRegistry).not.toHaveBeenCalled();
  });
});
