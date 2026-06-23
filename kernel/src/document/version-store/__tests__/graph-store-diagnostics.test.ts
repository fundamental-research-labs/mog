import { InMemoryVersionObjectStore, VersionObjectMemoryBackend } from '../object-store';
import { createInMemoryRefStore } from '../ref-store';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph-store';
import {
  AUTHOR,
  NAMESPACE,
  OTHER_NAMESPACE,
  commit,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  expectListFailed,
  expectReadHeadDegraded,
  expectReadRefDegraded,
  graphInput,
  objectRecord,
  persistRootCommitForReadDiagnostics,
} from './graph-store-test-utils';

describe('InMemoryVersionGraphStore diagnostics and validation failures', () => {
  it('rejects a missing current parent before advancing main', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingParent = commit('ee');
    const main = refStore.initializeMain({ targetCommitId: missingParent, createdBy: AUTHOR });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error('expected fake main initialization');
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });

    const result = await graph.commit(
      commitInput(await graphInput('missing-parent'), missingParent, main.ref.refVersion),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_MISSING_PARENT' });
    expect(refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: missingParent, refVersion: main.ref.refVersion },
    });
  });

  it('returns dangling-ref diagnostics when main points at a missing commit', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingParent = commit('ed');
    const main = refStore.initializeMain({ targetCommitId: missingParent, createdBy: AUTHOR });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error('expected fake main initialization');
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });

    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.main).toMatchObject({ name: VERSION_GRAPH_MAIN_REF, commitId: missingParent });
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
    expect(head.diagnostics[0]).toMatchObject({
      operation: 'readHead',
      refName: VERSION_GRAPH_MAIN_REF,
      commitId: missingParent,
      objectKind: 'commit',
    });

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefDegraded(symbolic);
    expect(symbolic.ref).toEqual({
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: main.ref.refVersion,
    });
    expect(symbolic.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);

    const listed = await graph.listCommits();
    expectListFailed(listed);
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
  });

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

  it('rejects wrong-namespace dependency records before object writes', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const result = await graph.commit(
      commitInput(
        await graphInput('wrong-namespace', OTHER_NAMESPACE),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_WRONG_NAMESPACE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });

  it('returns object-store failure diagnostics without advancing main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const missingChunk = await objectRecord('workbook.snapshotChunk.v1', {
      chunkId: 'missing',
    });

    const result = await graph.commit(
      commitInput(
        await graphInput('object-store-failure', NAMESPACE, [
          {
            kind: 'object',
            objectType: 'workbook.snapshotChunk.v1',
            digest: missingChunk.digest,
          },
        ]),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_OBJECT_STORE_FAILURE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });
});
