import { InMemoryVersionObjectStore } from '../object-store';
import { createInMemoryRefStore } from '../refs/ref-store';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commit,
  commitInput,
  expectGraphFailed,
  expectListFailed,
  expectReadHeadDegraded,
  expectReadRefDegraded,
  graphInput,
} from './graph-store-test-utils';

export function registerGraphStoreRefDiagnosticsScenarios(): void {
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
}
