import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import { InMemoryVersionObjectStore } from '../object-store';
import { createInMemoryRefStore } from '../refs/ref-store';
import {
  NAMESPACE,
  commit,
  expectClosureFailed,
  expectMappedRecoverability,
  expectNoRawNamespaceLeak,
  expectReadHeadDegraded,
  initializeMainAt,
} from './graph-store-recovery-test-helpers';

export function registerGraphStoreRecoveryDanglingRefTests(): void {
  it('reports dangling missing-commit reads as repairable without mutating refs', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingCommit = commit('ed');
    initializeMainAt(refStore, missingCommit);
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });
    const refsBefore = refStore.exportSnapshot();

    const head = await graph.readHead();
    const repeatedHead = await graph.readHead();
    expectReadHeadDegraded(head);
    expectReadHeadDegraded(repeatedHead);

    expect(head.diagnostics).toEqual(repeatedHead.diagnostics);
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
    expect(head.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_DANGLING_REF',
        operation: 'readHead',
        refName: VERSION_GRAPH_MAIN_REF,
        commitId: missingCommit,
        objectKind: 'commit',
      }),
      expect.objectContaining({
        code: 'VERSION_MISSING_OBJECT',
        operation: 'readHead',
        commitId: missingCommit,
        objectKind: 'commit',
      }),
    ]);
    expectMappedRecoverability(head.diagnostics, 'repair');
    expectNoRawNamespaceLeak(head.diagnostics);
    expect(refStore.exportSnapshot()).toEqual(refsBefore);

    const closure = await graph.readCommitClosure(missingCommit);
    const repeatedClosure = await graph.readCommitClosure(missingCommit);
    expectClosureFailed(closure);
    expectClosureFailed(repeatedClosure);
    expect(closure.diagnostics).toEqual(repeatedClosure.diagnostics);
    expect(closure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_MISSING_OBJECT',
        operation: 'readCommitClosure',
        commitId: missingCommit,
        objectKind: 'commit',
      }),
    ]);
    expectMappedRecoverability(closure.diagnostics, 'repair');
    expectNoRawNamespaceLeak(closure.diagnostics);
    expect(refStore.exportSnapshot()).toEqual(refsBefore);
  });
}
