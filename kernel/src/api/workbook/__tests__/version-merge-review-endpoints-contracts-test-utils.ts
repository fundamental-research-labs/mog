import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeResultId,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  mergeResultIdForPreviewDigest,
  type MergePreviewArtifactStatus,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'w8-05-merge-review-contracts';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const TARGET_REF = 'refs/heads/main' as const;

export async function withReviewArtifact(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
  options: { readonly status?: MergePreviewArtifactStatus } = {},
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflicts = [basicConflict()];
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: options.status ?? 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts,
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    provider,
    version: new WorkbookVersionImpl({ versioning: { provider } } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts,
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}

export type ReviewFixture = {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly version: WorkbookVersionImpl;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
};

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
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflict['resolutionOptions'][number] {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected ${kind} option`);
  return option;
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

export function mutateDigest(digest: ObjectDigest): ObjectDigest {
  return {
    algorithm: 'sha256',
    digest: `${digest.digest === `${'f'.repeat(64)}` ? 'e' : 'f'}${digest.digest.slice(1)}`,
  };
}

export function expectMergeReviewFailure(value: unknown, operation: string, code: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ]),
    },
  });
}

export function expectInvalidMergeReviewOptions(
  value: unknown,
  operation: string,
  options: readonly string[],
): void {
  expectMergeReviewFailure(value, operation, 'VERSION_INVALID_OPTIONS');
  expectPublicRedactedDiagnostics(value, operation);
  expect(diagnosticOptions(value)).toEqual(expect.arrayContaining(options));
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

function basicConflict(): VersionMergeConflict {
  const structural = metadata('w8-05-cell-conflict', 'sheet-1!A1', 'cells.values', ['value']);
  return conflictRecord('8', structural, diffValue('base'), diffValue('ours'), diffValue('theirs'));
}

function expectPublicRedactedDiagnostics(value: unknown, operation: string): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: expect.any(String),
          severity: 'error',
          message: expect.any(String),
          owner: 'version-store',
          data: expect.objectContaining({
            operation,
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ]),
    },
  });
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('"issueCode"');
  expect(serialized).not.toContain('"safeMessage"');
  expect(serialized).not.toContain('"redacted":false');
}

function diagnosticOptions(value: unknown): string[] {
  const diagnostics =
    (value as { readonly error?: { readonly diagnostics?: readonly PublicDiagnostic[] } }).error
      ?.diagnostics ?? [];
  return diagnostics
    .map((diagnostic) => diagnostic.data?.payload?.option)
    .filter((option): option is string => typeof option === 'string');
}

type PublicDiagnostic = {
  readonly data?: {
    readonly payload?: {
      readonly option?: unknown;
    };
  };
};

function conflictRecord(
  digit: string,
  structural: VersionDiffStructuralMetadata,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): VersionMergeConflict {
  const conflictId = `conflict:w8-05:${digit}`;
  const conflictDigest = `sha256:${digit.repeat(64)}`;
  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours, digit),
      resolutionOption(conflictId, 'acceptTheirs', theirs, digit),
      resolutionOption(conflictId, 'acceptBase', base, digit),
    ],
  };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflictResolutionOptionKind,
  value: VersionDiffValue,
  digit: string,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w8-05:${kind}:${digit}`,
    conflictId,
    kind,
    value,
    recalcRequired: true,
  };
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
): VersionDiffStructuralMetadata {
  return { kind: 'metadata', changeId, domain, entityId, propertyPath };
}

function diffValue(value: VersionSemanticValue): VersionDiffValue {
  return { kind: 'value', value };
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
