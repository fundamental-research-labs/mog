import {
  DOCUMENT_SCOPE,
  deleteFirstObjectByType,
  expectInitializeSuccess,
  initializeInput,
  namespaceCounts,
  openGraphDiagnostic,
} from './provider-indexeddb-recovery-test-utils';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { OBJECTS_STORE } from '../provider-indexeddb-schema';
import { namespaceForDocumentScope } from '../provider';

describe('IndexedDB provider recovery hardening: dependencies', () => {
  it('fails closed on missing dependency records across provider reopen without repair writes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('missing-dependency'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-dependency');
    await provider.close('test-teardown');

    await deleteFirstObjectByType(namespace, 'workbook.semanticChangeSet.v1');
    const countsBefore = await namespaceCounts(namespace);

    const diagnostic = await openGraphDiagnostic(DOCUMENT_SCOPE, namespace);
    expect(diagnostic).toMatchObject({
      code: 'VERSION_MISSING_DEPENDENCY',
      issueCode: 'VERSION_MISSING_DEPENDENCY',
      recoverability: 'repair',
      operation: 'openGraph',
      redacted: true,
      details: {
        reloadIssue: 'missing-dependency',
        store: OBJECTS_STORE,
        sourceIssue: 'VERSION_MISSING_DEPENDENCY',
      },
    });
    expect(await namespaceCounts(namespace)).toEqual(countsBefore);
  });
});
