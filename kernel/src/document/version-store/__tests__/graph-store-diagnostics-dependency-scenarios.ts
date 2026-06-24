import { InMemoryVersionObjectStore, VersionObjectMemoryBackend } from '../object-store';
import { createInMemoryVersionGraphStore } from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  expectListFailed,
  expectReadHeadDegraded,
  objectRecord,
  persistRootCommitForReadDiagnostics,
} from './graph-store-test-utils';

export function registerGraphStoreDependencyDiagnosticsScenarios(): void {
  it.each([
    { label: 'missing-dependency', code: 'VERSION_MISSING_DEPENDENCY' },
    { label: 'corrupt-dependency', code: 'VERSION_OBJECT_STORE_FAILURE' },
  ] as const)('returns structured graph read diagnostics for $label', async ({ label, code }) => {
    const backend = new VersionObjectMemoryBackend();
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore });
    const persisted = await persistRootCommitForReadDiagnostics(backend, objectStore, label);
    if (code === 'VERSION_OBJECT_STORE_FAILURE') {
      const corrupt = await objectRecord('workbook.semanticChangeSet.v1', {
        changes: ['corrupt'],
      });
      backend.putCorruptRecordForTesting(NAMESPACE, persisted.semanticChangeSet.digest, {
        ...corrupt,
        digest: persisted.semanticChangeSet.digest,
      });
    }
    expect(
      graph.refStore.initializeMain({ targetCommitId: persisted.commitId, createdBy: AUTHOR }),
    ).toMatchObject({ ok: true });

    const dependency = {
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: persisted.semanticChangeSet.digest,
    };
    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      code,
    ]);
    expect(head.diagnostics[1]).toMatchObject({
      code,
      operation: 'readHead',
      commitId: persisted.commitId,
      objectDigest: persisted.semanticChangeSet.digest,
      dependency,
    });
    expect(JSON.stringify(head.diagnostics)).not.toContain('"path"');

    const closure = await graph.readCommitClosure(persisted.commitId);
    expect(closure.status).toBe('failed');
    if (closure.status !== 'failed') throw new Error('expected closure failure');
    expect(closure.diagnostics).toEqual([
      expect.objectContaining({
        code,
        operation: 'readCommitClosure',
        commitId: persisted.commitId,
        objectDigest: persisted.semanticChangeSet.digest,
      }),
    ]);

    const listed = await graph.listCommits();
    expectListFailed(listed);
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      code,
    ]);
  });
}
