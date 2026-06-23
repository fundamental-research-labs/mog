import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  VersionRefName,
  VersionSealedResolutionPayloadRef,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import type {
  ObjectDigest as VersionStoreObjectDigest,
  VersionObjectType,
} from '../../../document/version-store/object-digest';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
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
import { REVIEW_EXTENSION_OBJECT_TYPE } from '../version-merge-review-artifacts';

const DOCUMENT_ID = 'vc07-apply-merge-sealed-payload';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type PersistedConflictPreview = Extract<VersionMergeResult, { status: 'conflicted' }> & {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
};

export type SealedPayloadVersionStoreProvider = ReturnType<
  typeof createInMemoryVersionStoreProvider
>;

export async function readStoredResolutionSetResolution(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly resolutionSetDigest: ObjectDigest;
  readonly index?: number;
}): Promise<Record<string, unknown>> {
  const graph = await input.provider.openGraph(
    namespaceForDocumentScope(input.documentScope, input.graphId),
    input.provider.accessContext,
  );
  const record = await graph.getObjectRecord(
    mergeResolutionSetArtifactRef(input.resolutionSetDigest),
  );
  const resolution = (
    record.preimage.payload as { readonly resolutions: readonly Record<string, unknown>[] }
  ).resolutions[input.index ?? 0];
  if (!resolution) throw new Error('expected stored resolution set entry');
  return resolution;
}

export async function expectResolutionSetArtifactMissing(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly resolutions: readonly VersionApplyMergeResolution[];
}): Promise<void> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(
    namespace,
    input.resolutions,
  );
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  await expect(
    graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
  ).resolves.toBe(false);
}

export async function expectSealedApplyRejected(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resolution: VersionApplyMergeResolution | readonly VersionApplyMergeResolution[];
  readonly messages: readonly string[];
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): Promise<void> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const targetRef = input.targetRef ?? ('refs/heads/main' as VersionMainRefName);
  const resolutions = Array.isArray(input.resolution) ? input.resolution : [input.resolution];
  const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(
    namespace,
    resolutions,
  );
  const expectedResolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
    resultDigest: internalSha256Digest(input.preview.resultDigest),
    resolutionSetDigest: expectedResolutionSet.digest,
    targetRef,
    expectedTargetHead: input.expectedTargetHead,
  });

  const result = await input.sourceWb.version.applyMerge(
    {
      resultId: input.preview.resultId,
      resultDigest: input.preview.resultDigest,
      previewArtifactDigest: input.preview.previewArtifactDigest,
      resolutions,
    },
    { targetRef, expectedTargetHead: input.expectedTargetHead },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.applyMerge',
    },
  });
  if (result.ok) throw new Error('expected sealed apply to be rejected');
  expectStableResolutionMismatchDiagnostics({
    diagnostics: result.error.diagnostics,
    operation: 'applyMerge',
    messages: input.messages,
    expectPayloadOperation: input.expectPayloadOperation,
    leakCanaries: diagnosticLeakCanaries({
      preview: input.preview,
      resolutions,
      targetRef,
      expectedTargetHead: input.expectedTargetHead,
      extra: input.leakCanaries ?? [],
    }),
  });

  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  await expect(
    graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
  ).resolves.toBe(false);
  await expect(
    graph.hasObject(resolvedMergeAttemptArtifactRef(expectedResolvedAttempt.digest)),
  ).resolves.toBe(false);
}

export function expectStableResolutionMismatchDiagnostics(input: {
  readonly diagnostics: readonly unknown[];
  readonly operation: 'applyMerge' | 'saveMergeResolutions';
  readonly messages: readonly string[];
  readonly leakCanaries?: readonly string[];
  readonly expectPayloadOperation?: boolean;
}): void {
  expect(input.diagnostics).toStrictEqual(
    input.messages.map((message) => ({
      code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
      severity: 'error',
      message,
      owner: 'version-store',
      data: {
        ...(input.expectPayloadOperation === false ? {} : { operation: input.operation }),
        recoverability: 'none',
        messageTemplateId: `version.${input.operation}.VERSION_MERGE_RESOLUTION_MISMATCH`,
        redacted: true,
        ...(input.expectPayloadOperation === false
          ? {}
          : { payload: { operation: input.operation } }),
        mutationGuarantee: 'no-write-attempted',
      },
    })),
  );
  expectNoDiagnosticLeaks(input.diagnostics, input.leakCanaries ?? []);
}

function diagnosticLeakCanaries(input: {
  readonly preview: PersistedConflictPreview;
  readonly resolutions: readonly VersionApplyMergeResolution[];
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly extra: readonly string[];
}): readonly string[] {
  return compactStrings([
    input.preview.resultId,
    input.preview.resultDigest.digest,
    ...input.resolutions.flatMap((resolution) => [
      resolution.conflictId,
      resolution.expectedConflictDigest,
      resolution.optionId,
      resolution.sealedPayloadRef?.payloadId,
      resolution.sealedPayloadRef?.payloadDigest.digest,
    ]),
    input.targetRef,
    input.expectedTargetHead.commitId,
    input.expectedTargetHead.revision.value,
    ...input.extra,
  ]);
}

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

export async function putResolutionPayload(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly domainPayloadSchema?: string;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
}): Promise<VersionSealedResolutionPayloadRef> {
  const result = await input.sourceWb.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
    targetRef: input.targetRef ?? ('refs/heads/main' as VersionMainRefName),
    expectedTargetHead: input.expectedTargetHead,
    value: input.value,
    purpose: input.purpose,
  });
  if (!result.ok) throw new Error(`expected sealed payload put success: ${result.error.code}`);
  return result.value;
}

export async function putWrongPreviewArtifact(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
}): Promise<ObjectDigest> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const record = await objectRecord(namespace, MERGE_PREVIEW_OBJECT_TYPE, {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: input.preview.base,
    ours: input.preview.ours,
    theirs: input.preview.theirs,
    changes: [],
    conflicts: input.preview.conflicts,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return record.digest;
}

export async function putForgedResolutionPayload(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly dependencyResultDigest?: ObjectDigest;
  readonly value: any;
  readonly omitPayloadKeys?: readonly string[];
  readonly extraPayload?: Readonly<Record<string, unknown>>;
}): Promise<VersionSealedResolutionPayloadRef> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const dependencyDigest = internalSha256Digest(
    input.dependencyResultDigest ?? input.preview.resultDigest,
  );
  const payload = {
    schemaVersion: 1,
    recordKind: 'mergeResolutionPayload',
    attemptId: input.preview.resultId,
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    previewArtifactDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    conflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    expectedConflictDigest: input.conflict.conflictDigest,
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: 'refs/heads/main' as VersionMainRefName,
    expectedTargetHead: input.expectedTargetHead,
    authority: payloadAuthorityForNamespace(namespace),
    purpose: 'chooseValue',
    value: input.value,
    ...(input.extraPayload ?? {}),
  };
  for (const key of input.omitPayloadKeys ?? []) delete (payload as Record<string, unknown>)[key];
  const record = await createVersionObjectRecord(namespace, {
    objectType: REVIEW_EXTENSION_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(dependencyDigest)],
    payload,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return {
    schemaVersion: 1,
    kind: 'sealedResolutionPayload',
    payloadId: `merge-payload:${record.digest.digest}` as `merge-payload:${string}`,
    payloadDigest: record.digest,
    storageMode: 'serverEncrypted',
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    conflictId: input.conflict.conflictId,
    optionId: input.option.optionId,
    resolutionKind: input.option.kind,
  };
}

export async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: SealedPayloadVersionStoreProvider;
    readonly graphId: string;
    readonly documentScope: VersionDocumentScope;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
  versioning: Record<string, unknown> = {},
  conflictCells: readonly string[] = ['A1'],
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const sourceHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  const branchHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest({ provider, ...versioning }),
    });
    installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'base');
    }
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
      name: `scenario/${graphId}` as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    for (const cell of conflictCells) {
      await sourceWb.activeSheet.setCell(cell, 'ours');
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
    for (const cell of conflictCells) {
      await branchWb.activeSheet.setCell(cell, 'theirs');
    }
    const theirsCommit = await expectCommit(
      branchWb.version.commit({
        targetRef: `scenario/${graphId}` as any,
        expectedHead: {
          commitId: baseCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    const expectedTargetHead = {
      commitId: oursCommit.id,
      revision: requireRefRevision(oursHead),
    };
    const preview = await sourceWb.version.merge(
      {
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        persistReviewRecord: true,
      },
    );
    if (
      !preview.ok ||
      preview.value.status !== 'conflicted' ||
      !preview.value.resultId ||
      !preview.value.resultDigest ||
      !preview.value.previewArtifactDigest
    ) {
      throw new Error('expected persisted conflicted preview metadata');
    }
    await run({
      provider,
      graphId,
      documentScope,
      sourceWb,
      preview: preview.value as PersistedConflictPreview,
      expectedTargetHead,
    });
  } finally {
    if (branchWb) await branchWb.close('skipSave');
    if (sourceWb) await sourceWb.close('skipSave');
    await branchHandle.dispose();
    await sourceHandle.dispose();
  }
}

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = requireResolutionOption(conflict, kind);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function requireResolutionOption(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
) {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return option;
}

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function payloadAuthorityForNamespace(namespace: VersionGraphNamespace) {
  return {
    workspaceId: namespace.workspaceId ?? null,
    principalScope: namespace.principalScope ?? null,
  };
}

function internalSha256Digest(digest: ObjectDigest): VersionStoreObjectDigest {
  if (digest.algorithm !== 'sha256') {
    throw new Error(`expected sha256 object digest: ${digest.algorithm}`);
  }
  return { algorithm: 'sha256', digest: digest.digest };
}

export function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
}

function compactStrings(values: readonly unknown[]): readonly string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(
      `expected commit success: ${result.error.code}: ${JSON.stringify(result.error)}`,
    );
  }
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
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return {
    workspaceId: `workspace-${graphId}`,
    documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}`,
    principalScope: 'principal-user-1',
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
