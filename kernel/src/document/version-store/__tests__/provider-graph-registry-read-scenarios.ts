import { createInMemoryVersionStoreProvider } from '../provider';
import { DOCUMENT_SCOPE, expectRegistryAbsent } from './provider-test-utils';

export function registerProviderGraphRegistryReadScenarios(): void {
  it('returns structured uninitialized diagnostics before registry initialization', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    const result = await provider.readGraphRegistry();

    expectRegistryAbsent(result);
    expect(result.registry).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        issueCode: 'VERSION_GRAPH_UNINITIALIZED',
        messageTemplateId: 'version.graph.uninitialized',
        operation: 'readGraphRegistry',
        redacted: true,
        documentScope: DOCUMENT_SCOPE,
      }),
    ]);
  });
}
