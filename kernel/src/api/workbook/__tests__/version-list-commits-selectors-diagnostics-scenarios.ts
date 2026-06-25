import { createFakeGraphStore, createVersion } from './version-list-commits-selectors-test-utils';
import {
  expectInvalidRefDiagnostic,
  expectMalformedNextPageTokenDiagnostic,
  expectMissingIndexDiagnostic,
  expectMissingParentDiagnostic,
  expectMissingRootDiagnostic,
  expectPublicNextPageTokenPassthrough,
  expectStaleCursorDiagnostic,
} from './version-list-commits-selectors-diagnostics-assertions';
import { enqueueListCommitsDiagnosticProviderResults } from './version-list-commits-selectors-diagnostics-provider-results';

export function registerListCommitsSelectorDiagnosticScenarios() {
  it('maps provider selector diagnostics and next page tokens through the public envelope', async () => {
    const graphStore = createFakeGraphStore();
    enqueueListCommitsDiagnosticProviderResults(graphStore);
    const version = createVersion(graphStore);

    await expectInvalidRefDiagnostic(version, graphStore);
    await expectMissingRootDiagnostic(version, graphStore);
    await expectStaleCursorDiagnostic(version, graphStore);
    await expectMissingIndexDiagnostic(version, graphStore);
    await expectMissingParentDiagnostic(version, graphStore);
    await expectMalformedNextPageTokenDiagnostic(version, graphStore);
    await expectPublicNextPageTokenPassthrough(version, graphStore);
  });
}
