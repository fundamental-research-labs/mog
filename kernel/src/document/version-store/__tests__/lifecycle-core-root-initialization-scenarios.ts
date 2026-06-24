import { jest } from '@jest/globals';
import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionCommitService } from '../commit-service';
import { resolveDocumentWorkbookVersioningLifecycle } from '../lifecycle';
import { namespaceForDocumentScope } from '../provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../provider-indexeddb/backend';
import {
  DOCUMENT_ID,
  GRAPH_ID,
  emptyAuthoredCapture,
  rootWrite,
  versioningConfig,
} from './lifecycle-core-test-helpers';

export function registerLifecycleCoreRootInitializationScenarios(): void {
  describe('version-store lifecycle root initialization', () => {
    it('initializes the blank workbook graph once and rejects an empty authored commit', async () => {
      const namespace = namespaceForDocumentScope({ documentId: DOCUMENT_ID }, GRAPH_ID);
      const firstRootBuilder = jest.fn(() => rootWrite('root-one', namespace));
      const secondRootBuilder = jest.fn(() => rootWrite('root-two', namespace));

      const first = await resolveDocumentWorkbookVersioningLifecycle({
        documentId: DOCUMENT_ID,
        versioning: versioningConfig(firstRootBuilder),
      });
      expect(first.diagnostics).toEqual([]);
      expect(firstRootBuilder).toHaveBeenCalledTimes(1);

      const provider = first.versioning?.provider;
      if (!provider) throw new Error('expected lifecycle to attach a provider');
      const writeService = createWorkbookVersionCommitService({
        provider,
        captureNormalCommit: emptyAuthoredCapture,
      });

      const firstHead = await writeService.readHead();
      expect(firstHead).toMatchObject({
        status: 'success',
        head: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });

      const second = await resolveDocumentWorkbookVersioningLifecycle({
        documentId: DOCUMENT_ID,
        versioning: versioningConfig(secondRootBuilder),
      });
      expect(second.diagnostics).toEqual([]);
      expect(secondRootBuilder).not.toHaveBeenCalled();

      const emptyCommit = await writeService.commit({ message: 'empty' });
      expect(emptyCommit).toMatchObject({
        status: 'failed',
        diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
      });

      const commits = await writeService.listCommits();
      expect(commits).toMatchObject({
        status: 'success',
        commits: [expect.objectContaining({ parents: [] })],
      });
      if (commits.status !== 'success') {
        throw new Error(`expected commit list success: ${commits.diagnostics[0]?.code}`);
      }
      expect(commits.commits).toHaveLength(1);

      await first.versioning?.provider?.dispose('test-teardown');
      await second.versioning?.provider?.dispose('test-teardown');
    });

    it('can lazily materialize deferred missing root initialization on first version read', async () => {
      const documentId = `${DOCUMENT_ID}-deferred-root`;
      const namespace = namespaceForDocumentScope({ documentId }, GRAPH_ID);
      const rootBuilder = jest.fn(() => rootWrite('deferred-root', namespace));
      const baseVersioningConfig = versioningConfig(rootBuilder);

      const result = await resolveDocumentWorkbookVersioningLifecycle({
        documentId,
        versioning: {
          ...baseVersioningConfig,
          providerSelection: {
            ...baseVersioningConfig.providerSelection!,
            initializeTiming: 'deferred',
          },
        },
      });

      expect(result.diagnostics).toEqual([]);
      const provider = result.versioning?.provider;
      if (!provider) throw new Error('expected lifecycle to attach a provider');
      expect(rootBuilder).not.toHaveBeenCalled();
      const writeService = createWorkbookVersionCommitService({
        provider,
        ensureInitialized: result.versioning?.ensureProviderInitialized,
        captureNormalCommit: emptyAuthoredCapture,
      });
      await expect(writeService.readHead()).resolves.toMatchObject({ status: 'success' });
      expect(rootBuilder).toHaveBeenCalledTimes(1);

      await provider.dispose('test-teardown');
    });

    it('fails closed before materializing existing-no-history roots rejected by policy', async () => {
      const namespace = namespaceForDocumentScope({ documentId: DOCUMENT_ID }, GRAPH_ID);
      const rootBuilder = jest.fn(() => rootWrite('policy-blocked-root', namespace));

      const result = await resolveDocumentWorkbookVersioningLifecycle({
        documentId: DOCUMENT_ID,
        versioning: {
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            initialize: {
              graphId: GRAPH_ID,
              buildRootWrite: rootBuilder,
              historyRootKind: 'existing-no-history',
              historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
            },
          },
          captureNormalCommit: emptyAuthoredCapture,
        },
      });

      expect(rootBuilder).not.toHaveBeenCalled();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
          safeMessage: 'Version history root policy rejects roots that would create a history gap.',
          operation: 'initializeGraph',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          details: expect.objectContaining({
            rootKind: 'existing-no-history',
            reason: 'history-gap-rejected',
            allowDetachedRoots: false,
            gapPolicy: 'reject',
            redacted: true,
          }),
        }),
      ]);
      expect(JSON.stringify(result.diagnostics)).not.toContain(DOCUMENT_ID);
    });
  });
}
