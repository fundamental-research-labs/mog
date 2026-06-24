import {
  SECRET_DOCUMENT_SCOPE,
  asRecord,
  expectInitializeSuccess,
  expectNoSecretLeak,
  initializeInput,
  openGraphDiagnostic,
  updateFirstObjectByType,
} from './provider-indexeddb-recovery-test-utils';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { OBJECTS_STORE } from '../provider-indexeddb-schema';
import { namespaceForDocumentScope } from '../provider';

describe('IndexedDB provider recovery hardening: diagnostics', () => {
  it('fails closed with redacted diagnostics when canonical object sidecar metadata is corrupt', async () => {
    const provider = createIndexedDbVersionStoreProvider({
      documentScope: SECRET_DOCUMENT_SCOPE,
    });
    const initialized = await provider.initializeGraph(
      await initializeInput('corrupt-object-sidecar', SECRET_DOCUMENT_SCOPE),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(SECRET_DOCUMENT_SCOPE, 'corrupt-object-sidecar');
    await provider.close('test-teardown');

    await updateFirstObjectByType(namespace, 'workbook.snapshotRoot.v1', (row) => {
      const record = asRecord(row.record);
      return {
        ...row,
        record: {
          ...record,
          payloadByteLength: Number(record.payloadByteLength) + 1,
        },
      };
    });

    const diagnostic = await openGraphDiagnostic(SECRET_DOCUMENT_SCOPE, namespace);
    expect(diagnostic).toMatchObject({
      code: 'VERSION_OBJECT_STORE_FAILURE',
      issueCode: 'VERSION_OBJECT_STORE_FAILURE',
      recoverability: 'repair',
      operation: 'openGraph',
      redacted: true,
      details: {
        reloadIssue: 'corrupt',
        store: OBJECTS_STORE,
        sourceIssue: 'VERSION_BYTE_LENGTH_MISMATCH',
      },
    });
    expect(diagnostic).not.toHaveProperty('namespace');
    expect(diagnostic.sourceDiagnostics?.[0]).not.toHaveProperty('namespace');
    expectNoSecretLeak(diagnostic, SECRET_DOCUMENT_SCOPE, namespace);
  });
});
