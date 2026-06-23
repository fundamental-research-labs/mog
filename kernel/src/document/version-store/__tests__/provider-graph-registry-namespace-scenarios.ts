import { createInMemoryVersionStoreProvider, namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  OTHER_DOCUMENT_SCOPE,
  expectInitializeFailed,
  expectInitializeSuccess,
  expectRegistryAbsent,
  initializeInput,
  rootWrite,
} from './provider-test-utils';

export function registerProviderGraphRegistryNamespaceScenarios(): void {
  it('fails initialization for root object records outside the requested namespace', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const wrongNamespace = namespaceForDocumentScope(OTHER_DOCUMENT_SCOPE, 'graph-1');

    const result = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
      rootWrite: await rootWrite('wrong-namespace', wrongNamespace),
    });

    expectInitializeFailed(result);
    expect(result).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_WRONG_NAMESPACE',
          messageTemplateId: 'version.integrity.wrong-namespace',
          operation: 'initializeGraph',
        }),
      ]),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_WRONG_NAMESPACE',
      'VERSION_WRONG_NAMESPACE',
    ]);
    expectRegistryAbsent(await provider.readGraphRegistry());
  });

  it('fails openGraph when the requested namespace does not match the visible registry', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
    expectInitializeSuccess(initialized);

    await expect(
      provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-2')),
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_WRONG_NAMESPACE',
        operation: 'openGraph',
      }),
    });
  });
}
