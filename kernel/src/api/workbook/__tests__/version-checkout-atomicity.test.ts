import { jest } from '@jest/globals';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import type { CheckoutSnapshotMaterializer } from '../../../document/version-store/checkout-apply';
import type { DocumentContext } from '../../../context';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-atomicity-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion checkout atomicity', () => {
  it('keeps the active workbook unchanged and reports rollback-safe diagnostics when checkout materialization fails before publish', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;
    const checkoutSnapshotMaterializer: CheckoutSnapshotMaterializer = {
      applySnapshot: jest.fn(async (input) => ({
        status: 'failed' as const,
        diagnostics: [
          {
            code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED' as const,
            severity: 'error' as const,
            message: 'Injected rollback-safe checkout materialization gap.',
            commitId: input.commitId,
            details: { cause: 'rollbackSafeGap' },
          },
        ],
        mutationGuarantee: 'no-workbook-mutation' as const,
      })),
    };

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-commit');
      await sourceWb.activeSheet.setCell('B1', '=6*7');
      const commitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
      const committed = commitResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({
          provider,
          checkoutSnapshotMaterializer,
        }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-checkout');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      checkoutWb.markClean();

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  commitId: 'redacted',
                  cause: 'rollbackSafeGap',
                  mutationGuarantee: 'no-workbook-mutation',
                  rollbackSafe: true,
                }),
              }),
            }),
          ],
        },
      });
      expect(checkoutSnapshotMaterializer.applySnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          commitId: committed.id,
        }),
      );
      expect(JSON.stringify(result)).not.toContain(committed.id);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-checkout',
      });
      await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 15 });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('does not publish a partial workbook when the target snapshot root cannot be reloaded', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(checkoutHandle);
    let checkoutWb: Workbook | undefined;

    try {
      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-invalid-root');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      const localOnly = await checkoutWb.sheets.add('LocalOnly');
      await localOnly.setCell('C1', 'local-only-before-invalid-root');
      checkoutWb.markClean();
      const beforeState = await readActiveDocumentState(checkoutWb);

      const result = await checkoutWb.version.checkout({
        kind: 'commit',
        id: initialized.rootCommit.id,
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  commitId: 'redacted',
                  cause: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
                  mutationGuarantee: 'no-workbook-mutation',
                  rollbackSafe: true,
                }),
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(initialized.rootCommit.id);
      await expectActiveDocumentState(checkoutWb, beforeState);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      await checkoutHandle.dispose();
    }
  });

  it('keeps the active workbook unchanged when production publish fails after fresh materialization', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, checkoutHandle);
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-after-publish-failure');
      await sourceWb.activeSheet.setCell('B1', '=6*7');
      const targetOnly = await sourceWb.sheets.add('TargetOnly');
      await targetOnly.setCell('C1', 'target-only-after-publish-failure');
      const commitResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
      const committed = commitResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-publish-failure');
      await checkoutWb.activeSheet.setCell('B1', '=10+5');
      const localOnly = await checkoutWb.sheets.add('LocalOnly');
      await localOnly.setCell('C1', 'local-only-before-publish-failure');
      checkoutWb.markClean();
      const beforeState = await readActiveDocumentState(checkoutWb);

      versioningRuntimeForHandle(checkoutHandle).provider = createInMemoryVersionStoreProvider({
        documentScope: {
          ...DOCUMENT_SCOPE,
          documentId: 'checkout-atomicity-rebound-doc',
        },
      });

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                recoverability: 'repair',
                redacted: true,
                payload: expect.objectContaining({
                  commitId: 'redacted',
                  cause: 'VersionCheckoutRebindProviderIdentityError',
                  identityFenceReason: 'providerDocumentMismatch',
                  providerIdentityClass: 'document',
                  mutationGuarantee: 'unknown-after-partial-mutation',
                  rollbackSafe: false,
                  partialSnapshot: true,
                }),
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(committed.id);
      expect(JSON.stringify(result)).not.toContain('checkout-atomicity-rebound-doc');
      await expectActiveDocumentState(checkoutWb, beforeState);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });
});

type ActiveDocumentState = {
  readonly sheetNames: readonly string[];
  readonly activeSheetName: string;
  readonly sheet1A1: unknown;
  readonly sheet1B1: unknown;
  readonly hasLocalOnly: boolean;
  readonly localOnlyC1: unknown;
  readonly hasTargetOnly: boolean;
  readonly dirtyStatusRevision: string;
};

async function readActiveDocumentState(wb: Workbook): Promise<ActiveDocumentState> {
  const sheetNames = [...wb.sheetNames];
  const sheet1 = await wb.getSheet('Sheet1');
  const [sheet1A1, sheet1B1] = await Promise.all([
    sheet1.getCell('A1'),
    sheet1.getCell('B1'),
  ]);
  const hasLocalOnly = sheetNames.includes('LocalOnly');
  const localOnlyC1 = hasLocalOnly
    ? (await (await wb.getSheet('LocalOnly')).getCell('C1')).value
    : null;
  const surface = await wb.version.getSurfaceStatus();

  return {
    sheetNames,
    activeSheetName: wb.activeSheet.name,
    sheet1A1: sheet1A1.value,
    sheet1B1: sheet1B1.value,
    hasLocalOnly,
    localOnlyC1,
    hasTargetOnly: sheetNames.includes('TargetOnly'),
    dirtyStatusRevision: surface.dirty.statusRevision,
  };
}

async function expectActiveDocumentState(
  wb: Workbook,
  expected: ActiveDocumentState,
): Promise<void> {
  const actual = await readActiveDocumentState(wb);
  expect(documentContentState(actual)).toEqual(documentContentState(expected));
  expect(actual.dirtyStatusRevision).toEqual(expect.stringContaining('dirty:no'));
  expect(actual.dirtyStatusRevision).toEqual(expect.stringContaining('checkout:idle'));
}

function documentContentState(state: ActiveDocumentState): Omit<ActiveDocumentState, 'dirtyStatusRevision'> {
  const { dirtyStatusRevision: _dirtyStatusRevision, ...contentState } = state;
  return contentState;
}

function versioningRuntimeForHandle(handle: Awaited<ReturnType<typeof DocumentFactory.create>>) {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  if (!isMutableRecord(context.versioning)) {
    throw new Error('expected attached versioning runtime');
  }
  return context.versioning;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeVersionGraph(): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
