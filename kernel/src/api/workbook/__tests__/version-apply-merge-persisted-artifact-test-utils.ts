import type {
  VersionApplyMergeResolution,
  VersionHead,
  VersionMainRefName,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
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

const DOCUMENT_ID = 'vc07-apply-merge-persisted-artifact';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const PERSISTED_ARTIFACT_CREATED_AT = '2026-06-21T00:00:00.000Z';
export const PERSISTED_ARTIFACT_TARGET_REF = 'refs/heads/main' as VersionMainRefName;

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type CellEdit = {
  readonly cell: string;
  readonly value: string;
};

type PersistedMergeScenarioOptions = {
  readonly graphId: string;
  readonly branchName: string;
  readonly ours: readonly CellEdit[];
  readonly theirs: readonly CellEdit[];
  readonly applyMergeService?: unknown;
};

export type PersistedMergeScenario = {
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly namespace: VersionGraphNamespace;
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly sourceWb: Workbook;
  readonly branchWb: Workbook;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
  readonly expectedTargetHead: {
    readonly commitId: WorkbookCommitSummary['id'];
    readonly revision: NonNullable<VersionHead['refRevision']>;
  };
  readonly openMergedWorkbook: () => Promise<Workbook>;
  readonly cleanup: () => Promise<void>;
};

function createHeadlessDocumentHandle(documentScope: VersionDocumentScope) {
  return DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function createPersistedMergeScenario(
  options: PersistedMergeScenarioOptions,
): Promise<PersistedMergeScenario> {
  const { graphId } = options;
  const documentScope = documentScopeForGraph(graphId);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const sourceHandle = await createHeadlessDocumentHandle(documentScope);
  const branchHandle = await createHeadlessDocumentHandle(documentScope);
  const mergedHandle = await createHeadlessDocumentHandle(documentScope);
  installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);

  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;
  let mergedWb: Workbook | undefined;

  const cleanup = async () => {
    if (mergedWb) await mergedWb.close('skipSave');
    if (branchWb) await branchWb.close('skipSave');
    if (sourceWb) await sourceWb.close('skipSave');
    await mergedHandle.dispose();
    await branchHandle.dispose();
    await sourceHandle.dispose();
  };

  try {
    const sourceVersioning: Record<string, unknown> = { provider };
    if (options.applyMergeService !== undefined) {
      sourceVersioning.applyMergeService = options.applyMergeService;
    }
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest(sourceVersioning),
    });
    installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
    await sourceWb.activeSheet.setCell('A1', 'base');
    const baseCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      }),
    );
    const baseHead = await expectHead(sourceWb);

    const branch = await sourceWb.version.createBranch({
      name: options.branchName as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    for (const edit of options.ours) {
      await sourceWb.activeSheet.setCell(edit.cell, edit.value);
    }
    const oursCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(sourceWb);

    branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok) {
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    }
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    for (const edit of options.theirs) {
      await branchWb.activeSheet.setCell(edit.cell, edit.value);
    }
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: options.branchName as any,
        expectedHead: {
          commitId: baseCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    return {
      graphId,
      documentScope,
      namespace,
      provider,
      sourceWb,
      branchWb,
      baseCommit,
      oursCommit,
      theirsCommit,
      expectedTargetHead: {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      },
      openMergedWorkbook: async () => {
        if (mergedWb) return mergedWb;
        mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
        installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
        return mergedWb;
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
}

async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
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
      author: AUTHOR,
      createdAt: PERSISTED_ARTIFACT_CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
