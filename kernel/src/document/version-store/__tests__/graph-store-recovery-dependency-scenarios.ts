import { createInMemoryVersionGraphStore } from '../graph';
import { InMemoryVersionObjectStore, VersionObjectMemoryBackend } from '../object-store';
import { createInMemoryRefStore } from '../refs/ref-store';
import {
  NAMESPACE,
  expectClosureFailed,
  expectMappedRecoverability,
  expectNoRawNamespaceLeak,
  expectReadHeadDegraded,
  initializeMainAt,
  persistRootCommitWithSemanticDependencyGap,
} from './graph-store-recovery-test-helpers';

export function registerGraphStoreRecoveryDependencyTests(): void {
  it.each([
    { mode: 'missing', code: 'VERSION_MISSING_DEPENDENCY' },
    { mode: 'corrupt', code: 'VERSION_OBJECT_STORE_FAILURE' },
  ] as const)(
    'reports $mode dependency closure reads as repairable without mutating refs',
    async ({ mode, code }) => {
      const backend = new VersionObjectMemoryBackend();
      const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
      const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
      const graph = createInMemoryVersionGraphStore({
        namespace: NAMESPACE,
        objectStore,
        refStore,
      });
      const persisted = await persistRootCommitWithSemanticDependencyGap(
        backend,
        objectStore,
        mode,
      );
      initializeMainAt(refStore, persisted.commitId);
      const refsBefore = refStore.exportSnapshot();

      const closure = await graph.readCommitClosure(persisted.commitId);
      const repeatedClosure = await graph.readCommitClosure(persisted.commitId);
      expectClosureFailed(closure);
      expectClosureFailed(repeatedClosure);

      expect(closure.diagnostics).toEqual(repeatedClosure.diagnostics);
      expect(closure.diagnostics).toEqual([
        expect.objectContaining({
          code,
          operation: 'readCommitClosure',
          commitId: persisted.commitId,
          objectDigest: persisted.semanticDependency.digest,
          dependency: persisted.semanticDependency,
        }),
      ]);
      expectMappedRecoverability(closure.diagnostics, 'repair');
      expectNoRawNamespaceLeak(closure.diagnostics);

      const head = await graph.readHead();
      expectReadHeadDegraded(head);
      expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'VERSION_DANGLING_REF',
        code,
      ]);
      expectMappedRecoverability(head.diagnostics, 'repair');
      expectNoRawNamespaceLeak(head.diagnostics);
      expect(refStore.exportSnapshot()).toEqual(refsBefore);
    },
  );
}
