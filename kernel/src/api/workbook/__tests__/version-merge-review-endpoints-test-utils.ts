import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionHead,
  VersionMergeConflict,
  VersionMergeResult,
  VersionMergeResultId,
  VersionSemanticValue,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { WorkbookVersionImpl } from '../version';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

export const MERGE_REVIEW_DOCUMENT_ID = 'vc07-merge-review-endpoints';

const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type PersistedConflictPreview = VersionMergeResult & {
  readonly status: 'conflicted';
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
};

export type ConflictDetailSuccess = Extract<
  Awaited<ReturnType<Workbook['version']['getMergeConflictDetail']>>,
  { ok: true }
>;

export async function withPersistedConflictPreview(
  graphId: string,
  run: (fixture: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly graphId: string;
    readonly documentScope: VersionDocumentScope;
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => Promise<void>,
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
    const versioning = withVersionManifest({ provider });
    sourceWb = await sourceHandle.workbook({ versioning });
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
      name: `scenario/${graphId}` as any,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await sourceWb.activeSheet.setCell('A1', 'ours');
    const oursCommit = await expectCommit(
      sourceWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(sourceWb);

    branchWb = await branchHandle.workbook({ versioning });
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
    if (!checkoutBase.ok)
      throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
    installVersionDomainDetectorNoopsOnWorkbook(branchWb);
    await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
    await branchWb.activeSheet.setCell('A1', 'theirs');
    await expect(branchWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });
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
      !preview.value.resultDigest
    ) {
      throw new Error(`expected persisted conflicted preview metadata: ${JSON.stringify(preview)}`);
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

export async function readSyntheticConflictDetail(
  graphId: string,
  conflict: VersionMergeConflict,
): Promise<ConflictDetailSuccess> {
  let detail: ConflictDetailSuccess | undefined;
  await withSyntheticConflictPreview(graphId, conflict, async ({ sourceWb, preview }) => {
    const previewConflict = preview.conflicts[0];
    const result = await sourceWb.version.getMergeConflictDetail({
      resultId: preview.resultId,
      resultDigest: preview.resultDigest,
      redactionPolicyDigest: preview.resultDigest,
      conflictId: previewConflict.conflictId,
      expectedConflictDigest: conflictDigestObject(previewConflict.conflictDigest),
      valueRole: 'ours',
      purpose: 'review',
    });
    if (!result.ok) throw new Error(`expected synthetic conflict detail: ${result.error.code}`);
    detail = result;
  });
  if (!detail) throw new Error('expected synthetic conflict detail callback to run');
  return detail;
}

export async function withSyntheticConflictPreview(
  graphId: string,
  conflict: VersionMergeConflict,
  run: (fixture: {
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
  }) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts: [conflict],
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  const put = await graph.putObjects([previewRecord]);
  expect(put).toMatchObject({ status: 'success' });

  const sourceHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  try {
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest({ provider }),
    });
    await run({
      sourceWb,
      preview: {
        status: 'conflicted',
        base: initialized.rootCommit.id,
        ours: initialized.rootCommit.id,
        theirs: initialized.rootCommit.id,
        changes: [],
        conflicts: [conflict],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
        resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
        resultDigest: previewRecord.digest,
      },
    });
  } finally {
    if (sourceWb) await sourceWb.close('skipSave');
    await sourceHandle.dispose();
  }
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
  if (!conflictDigest.startsWith('sha256:'))
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

// prettier-ignore
export function expectPublicDiagnostic(value: unknown, operation: string, code: string, message?: string): void {
  const diagnostic = { code, ...(message ? { message } : {}), data: expect.objectContaining({ redacted: true, payload: expect.objectContaining({ operation }) }) };
  expect(value).toMatchObject({ ok: false, error: { diagnostics: [expect.objectContaining(diagnostic)] } });
}

// prettier-ignore
export async function accessDeniedPreviewArtifactResult() {
  const graphId = 'access-denied-preview-artifact', documentScope = documentScopeForGraph(graphId);
  const baseProvider = createInMemoryVersionStoreProvider({ documentScope });
  expectInitializeSuccess(await baseProvider.initializeGraph(await initializeInput(graphId, 'root', documentScope)));
  const digest = { algorithm: 'sha256', digest: '8'.repeat(64) } as const, rawCommitId = `commit:sha256:${'7'.repeat(64)}`;
  const provider = { readGraphRegistry: () => baseProvider.readGraphRegistry(), openGraph: async () => ({ getObjectRecord: async () => {
    throw Object.assign(new Error(rawCommitId), { diagnostics: [{ issueCode: 'VERSION_PERMISSION_DENIED', safeMessage: `Cannot read ${rawCommitId} or sha256:${digest.digest}.` }] });
  } }) };
  const version = new WorkbookVersionImpl({ versioning: { provider } } as any);
  const result = await version.getMergeConflictDetail({ resultId: mergeResultIdForPreviewDigest(digest), resultDigest: digest, redactionPolicyDigest: digest, conflictId: 'conflict:legacy:access-denied', expectedConflictDigest: { algorithm: 'sha256', digest: '9'.repeat(64) }, valueRole: 'base', purpose: 'review' });
  return { result, canaries: [rawCommitId, digest.digest, `sha256:${digest.digest}`, `merge-result:${digest.digest}`] };
}

export function stableOptionIds(
  options: readonly {
    readonly conflictId: string;
    readonly optionId: string;
    readonly kind: string;
  }[],
): readonly string[] {
  return options
    .map((option) => `${option.kind}\u0000${option.conflictId}\u0000${option.optionId}`)
    .sort();
}

export function expectStableConflictOptions(
  left: ConflictDetailSuccess,
  right: ConflictDetailSuccess,
) {
  expect(left.value.conflictId).toBe(right.value.conflictId);
  expect(left.value.conflictDigest).toBe(right.value.conflictDigest);
  expect(stableOptionIds(left.value.resolutionOptions)).toEqual(
    stableOptionIds(right.value.resolutionOptions),
  );
}

export function formulaConflict(input: {
  readonly result: number;
  readonly conflictIdDigit: string;
}): VersionMergeConflict {
  const structural = metadata('legacy-formula-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  const base = diffValue(null);
  const ours = diffValue({ kind: 'formula', formula: '=1+1', result: input.result });
  const theirs = diffValue('literal');
  return conflictRecord(input.conflictIdDigit, structural, base, ours, theirs);
}

// prettier-ignore
export function rowColumnConflict(input: { readonly conflictIdDigit: string; readonly fields: readonly { readonly key: string; readonly value: VersionSemanticValue }[] }): VersionMergeConflict {
  const structural = metadata('legacy-row-column-conflict', 'sheet-1!row:4', 'rows-columns', ['order']);
  return conflictRecord(input.conflictIdDigit, structural, diffValue(null), diffValue({ kind: 'object', fields: input.fields }), diffValue('manual-order'));
}

export function redactedStructuralConflict(): VersionMergeConflict {
  return {
    ...rowColumnConflict({ conflictIdDigit: '6', fields: rowColumnFields('row', 4) }),
    structural: { kind: 'redacted', reason: 'redaction-policy' } as any,
  };
}

// prettier-ignore
export function rowColumnFields(axis: 'row' | 'column', index: number): readonly { readonly key: string; readonly value: VersionSemanticValue }[] {
  return [
    { key: 'axis', value: axis },
    { key: 'displayRef', value: axis === 'row' ? '5:5' : 'E:E' },
    { key: 'index', value: index },
    { key: 'sheetId', value: 'sheet-1' },
  ];
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok)
    throw new Error(
      `expected commit success: ${result.error.code} ${JSON.stringify(result.error)}`,
    );
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

// prettier-ignore
function conflictRecord(digit: string, structural: VersionDiffStructuralMetadata, base: VersionDiffValue, ours: VersionDiffValue, theirs: VersionDiffValue): VersionMergeConflict {
  const conflictId = `conflict:legacy:${digit}`;
  const conflictDigest = `sha256:${digit.repeat(64)}`;
  return {
    conflictId, conflictDigest, conflictKind: 'same-property', structural, base, ours, theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours, digit),
      resolutionOption(conflictId, 'acceptTheirs', theirs, digit),
      resolutionOption(conflictId, 'acceptBase', base, digit),
    ],
  };
}

// prettier-ignore
function resolutionOption(conflictId: string, kind: VersionMergeConflict['resolutionOptions'][number]['kind'], value: VersionDiffValue, digit: string): VersionMergeConflict['resolutionOptions'][number] {
  return { optionId: `option:legacy:${kind}:${digit}`, conflictId, kind, value, recalcRequired: true };
}

// prettier-ignore
function metadata(changeId: string, entityId: string, domain: string, propertyPath: readonly string[]): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
}

// prettier-ignore
async function initializeInput(graphId: string, label: string, documentScope: VersionDocumentScope): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', { label, sheets: [] }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', { label, changes: [] }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${MERGE_REVIEW_DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
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
